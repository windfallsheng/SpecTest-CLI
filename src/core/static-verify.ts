import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { TestCaseSchema } from './schemas/test-case.schema.js';
import { queryACCoverage } from './predicates.js';
import { loadAllMatrices, getUnitSuitesDir } from './trace-matrix.js';

/**
 * static-verify.ts —— 文档静态验证引擎（gate 的第一道闸，零成本内置）
 *
 * 检查项（error 级阻塞 / warning 级提示）：
 * 1. AC 格式完整性：骨架单元报缺（error）
 * 2. 每条 AC 有证：矩阵 traces.caseIds 非空（error）
 * 3. 用例四段齐全：preconditions/steps(expected)/testData（error）
 * 4. 端级专项：backend 缺幂等/并发字段、h5 缺选择器/视口、app 缺机型/弱网（warning）
 * 5. API_CONTRACT 与 TECH.md 接口一致性（warning）
 */

export interface VerifyCheck {
  name: string;
  level: 'error' | 'warning';
  passed: boolean;
  message: string;
  details: string[];
}

export interface VerifyResult {
  checks: VerifyCheck[];
  errorCount: number;
  warningCount: number;
  passed: boolean;
}

const BACKEND_SUFFIX = /(service|backend|api)$/;

/** 执行静态验证 */
export function runStaticVerify(
  projectRoot: string,
  iteration: string,
  filter: { platform?: string; unit?: string } = {}
): VerifyResult {
  const checks: VerifyCheck[] = [];

  // 1. AC 格式完整性（骨架缺口）
  checks.push(checkSpecCompleteness(projectRoot, iteration, filter));

  // 2. AC 覆盖（矩阵谓词）
  checks.push(checkACCoverage(projectRoot, iteration, filter));

  // 3. 用例四段齐全
  checks.push(checkCaseCompleteness(projectRoot, iteration, filter));

  // 4. 端级专项
  checks.push(checkPlatformSpecifics(projectRoot, iteration, filter));

  // 5. 契约与 TECH.md 一致性
  checks.push(checkContractConsistency(projectRoot, iteration, filter));

  const errorCount = checks.filter((c) => c.level === 'error' && !c.passed).length;
  const warningCount = checks.filter((c) => c.level === 'warning' && !c.passed).length;

  return { checks, errorCount, warningCount, passed: errorCount === 0 };
}

/** 1. 骨架缺口 = error（Spec 面没有真实 AC，一切无从谈起） */
function checkSpecCompleteness(
  projectRoot: string, iteration: string, filter: { platform?: string; unit?: string }
): VerifyCheck {
  const gaps = queryACCoverage(projectRoot, iteration, filter).specGaps;
  return {
    name: 'AC 格式完整性',
    level: 'error',
    passed: gaps.length === 0,
    message: gaps.length === 0
      ? '所有单元的 TEST.md 均已产出真实 AC'
      : `${gaps.length} 个单元仍是 SPEC-SKELETON 骨架`,
    details: gaps.map((g) => `[${g.platform}/${g.unit}] ${g.reason}`),
  };
}

/** 2. 每条 AC 有证 = error（矩阵 traces.caseIds 非空） */
function checkACCoverage(
  projectRoot: string, iteration: string, filter: { platform?: string; unit?: string }
): VerifyCheck {
  const { uncovered } = queryACCoverage(projectRoot, iteration, filter);
  return {
    name: 'AC 用例证明',
    level: 'error',
    passed: uncovered.length === 0,
    message: uncovered.length === 0
      ? '所有 AC 均有用例证明'
      : `${uncovered.length} 条 AC 无用例证明`,
    details: uncovered.map((u) => `[${u.platform}/${u.unit}] ${u.acId} ${u.acDesc.slice(0, 50)}`),
  };
}

/** 3. 用例四段齐全 = error（前置/步骤/数据/断言，缺一即不合格） */
function checkCaseCompleteness(
  projectRoot: string, iteration: string, filter: { platform?: string; unit?: string }
): VerifyCheck {
  const matrices = loadAllMatrices(projectRoot, iteration);
  const problems: string[] = [];

  for (const m of matrices) {
    if (filter.platform && m.platform !== filter.platform) continue;
    if (filter.unit && m.unitSlug !== filter.unit && m.unit !== filter.unit) continue;

    const suitesDir = getUnitSuitesDir(projectRoot, m.platform, m.unitSlug, iteration);
    if (!fs.existsSync(suitesDir)) continue;

    for (const sd of fs.readdirSync(suitesDir, { withFileTypes: true })) {
      if (!sd.isDirectory()) continue;
      const casesDir = path.join(suitesDir, sd.name, 'cases');
      if (!fs.existsSync(casesDir)) continue;

      for (const f of fs.readdirSync(casesDir)) {
        if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
        const content = fs.readFileSync(path.join(casesDir, f), 'utf-8');
        let doc: unknown;
        try {
          doc = yaml.load(content, { schema: yaml.CORE_SCHEMA });
        } catch {
          problems.push(`${f}: YAML 解析失败`);
          continue;
        }
        const parsed = TestCaseSchema.safeParse(doc);
        if (!parsed.success) {
          problems.push(`${f}: 结构校验失败`);
          continue;
        }
        const tc = parsed.data;
        if (tc.preconditions.length === 0) problems.push(`${tc.id}: 缺前置条件`);
        if (tc.steps.length === 0) problems.push(`${tc.id}: 缺测试步骤`);
        if (tc.steps.some((s) => !s.expected)) problems.push(`${tc.id}: 步骤缺 expected 断言`);
        if (tc.steps.length > 0 && tc.steps.some((s) => !s.action)) problems.push(`${tc.id}: 步骤缺 action 动作`);
      }
    }
  }

  return {
    name: '用例四段齐全',
    level: 'error',
    passed: problems.length === 0,
    message: problems.length === 0
      ? '所有用例前置/步骤/数据/断言齐全'
      : `${problems.length} 个用例缺段`,
    details: problems,
  };
}

/** 4. 端级专项 = warning（提示端特点覆盖，不阻塞） */
function checkPlatformSpecifics(
  projectRoot: string, iteration: string, filter: { platform?: string; unit?: string }
): VerifyCheck {
  const matrices = loadAllMatrices(projectRoot, iteration);
  const hints: string[] = [];

  const EXPECTED_BY_PLATFORM: Record<string, { fields: string[]; label: string }> = {
    backend: { fields: ['idempotency', 'concurrency', 'transactionBoundary'], label: '事务/幂等/并发专项' },
    h5: { fields: ['selector', 'viewport', 'stateFlow'], label: '选择器/视口/状态流转' },
    app: { fields: ['deviceMatrix', 'network'], label: '机型矩阵/弱网' },
  };

  for (const m of matrices) {
    if (filter.platform && m.platform !== filter.platform) continue;
    if (filter.unit && m.unitSlug !== filter.unit && m.unit !== filter.unit) continue;

    // 端名归一：h5-mobile→h5，xx-service→backend，xx-app→app
    const norm = m.platform.includes('h5') || m.platform.includes('mobile') && !m.platform.includes('app')
      ? 'h5'
      : BACKEND_SUFFIX.test(m.platform) ? 'backend'
      : m.platform.endsWith('app') ? 'app'
      : null;
    if (!norm) continue;
    const spec = EXPECTED_BY_PLATFORM[norm];

    const suitesDir = getUnitSuitesDir(projectRoot, m.platform, m.unitSlug, iteration);
    if (!fs.existsSync(suitesDir)) continue;

    let checked = 0;
    let withSpecials = 0;
    for (const sd of fs.readdirSync(suitesDir, { withFileTypes: true })) {
      if (!sd.isDirectory()) continue;
      const casesDir = path.join(suitesDir, sd.name, 'cases');
      if (!fs.existsSync(casesDir)) continue;
      for (const f of fs.readdirSync(casesDir)) {
        if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
        const content = fs.readFileSync(path.join(casesDir, f), 'utf-8');
        // 端级字段出现在用例中即视为有专项覆盖
        if (spec.fields.some((field) => content.includes(`${field}:`))) withSpecials++;
        checked++;
      }
    }
    if (checked > 0 && withSpecials === 0) {
      hints.push(`[${m.platform}/${m.unit}] ${checked} 个用例均未覆盖${spec.label}`);
    }
  }

  return {
    name: '端级专项覆盖',
    level: 'warning',
    passed: hints.length === 0,
    message: hints.length === 0 ? '端级专项检查项均有覆盖' : `${hints.length} 个单元缺端级专项`,
    details: hints,
  };
}

/** 5. TECH.md 接口列表 vs API_CONTRACT 端点 = warning（不一致提示，不阻塞） */
function checkContractConsistency(
  projectRoot: string, iteration: string, filter: { platform?: string; unit?: string }
): VerifyCheck {
  const matrix = loadAllMatrices(projectRoot, iteration);
  const hasContract = matrix.some((m) => m.unitSlug === 'api-contract');
  if (!hasContract) {
    return {
      name: '契约一致性',
      level: 'warning',
      passed: true,
      message: '无 API_CONTRACT 契约面，跳过一致性检查',
      details: [],
    };
  }

  // 端级 TECH.md 中声明的接口（GET /xxx 等行）与契约端点对齐
  const details: string[] = [];
  let mismatch = 0;

  for (const m of matrix) {
    if (filter.platform && m.platform !== filter.platform) continue;
    const suitesDir = getUnitSuitesDir(projectRoot, m.platform, m.unitSlug, iteration);
    if (!fs.existsSync(suitesDir)) continue;
    // 契约端点集合（从契约套件的用例 testData 提取）
    const endpoints = new Set<string>();
    for (const sd of fs.readdirSync(suitesDir, { withFileTypes: true })) {
      if (!sd.isDirectory()) continue;
      const casesDir = path.join(suitesDir, sd.name, 'cases');
      if (!fs.existsSync(casesDir)) continue;
      for (const f of fs.readdirSync(casesDir)) {
        if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
        try {
          const doc = yaml.load(fs.readFileSync(path.join(casesDir, f), 'utf-8'), { schema: yaml.CORE_SCHEMA }) as {
            testData?: { method?: string; path?: string };
          } | null;
          if (doc?.testData?.method && doc?.testData?.path) {
            endpoints.add(`${doc.testData.method} ${doc.testData.path}`);
          }
        } catch { /* skip */ }
      }
    }
    if (endpoints.size === 0) continue;

    // TECH.md 里的接口声明行
    const techPath = findTechMd(projectRoot, iteration, m);
    if (!techPath) continue;
    const techContent = fs.readFileSync(techPath, 'utf-8');
    const declared = new Set<string>();
    for (const line of techContent.split('\n')) {
      const mm = line.match(/(GET|POST|PUT|DELETE|PATCH)\s+\/[^\s`|]+/);
      if (mm) declared.add(`${mm[1]} ${mm[2]}`);
    }

    for (const d of declared) {
      if (!endpoints.has(d)) {
        mismatch++;
        details.push(`[${m.platform}/${m.unit}] TECH.md 声明 ${d} 未出现在契约端点中`);
      }
    }
  }

  return {
    name: '契约一致性',
    level: 'warning',
    passed: mismatch === 0,
    message: mismatch === 0 ? 'TECH.md 接口声明与契约端点一致' : `${mismatch} 处接口声明与契约不一致`,
    details,
  };
}

function findTechMd(
  projectRoot: string, iteration: string, m: { platform: string; unitSlug: string }
): string | null {
  const candidates = [
    path.join(projectRoot, iteration, '020-specs', m.unitSlug, m.platform, 'TECH.md'),
  ];
  // 单元名可能是中文或 slug，尝试目录内模糊匹配
  const specsDir = path.join(projectRoot, iteration, '020-specs');
  if (fs.existsSync(specsDir)) {
    for (const unitDir of fs.readdirSync(specsDir, { withFileTypes: true })) {
      if (!unitDir.isDirectory()) continue;
      const p = path.join(specsDir, unitDir.name, m.platform, 'TECH.md');
      if (fs.existsSync(p)) return p;
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
