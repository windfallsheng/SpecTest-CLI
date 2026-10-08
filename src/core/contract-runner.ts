import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { TestCaseSchema } from './schemas/test-case.schema.js';
import { loadAllMatrices, updateCaseResult, getUnitSuitesDir } from './trace-matrix.js';
import { loadEnvironment, unresolvedVars, type TestEnvironment } from './environment.js';

/**
 * contract-runner.ts —— 契约执行器（SpecTest 唯一「真能自己跑」的层）
 *
 * 边界哲学：执行力止于契约面。契约断言的是规格（接口长什么样是规格定的），
 * 所以契约执行器亲自执行；实现面（业务逻辑怎么算）只能借宿主框架之手。
 *
 * 执行：读契约用例的 testData（生成器写入的可执行请求）→ 真实 HTTP →
 * 状态码断言 → 结果归一 → updateCaseResult 回填矩阵。
 * 无服务器/无环境配置时如实报 failed（连接失败），绝不造假。
 */

export interface ContractRunOptions {
  projectRoot: string;
  iteration: string;
  /** 环境名（dev/test/staging/prod） */
  env: string;
  /** 端过滤（服务端名） */
  platform?: string;
  /** 只跑指定套件 */
  suiteId?: string;
  /** 优先级过滤（high = P0，与 gate 的 P0 定义一致） */
  priority?: 'high' | 'medium' | 'low';
  /** 用例级过滤（幂等 caseId，逗号分隔的多个） */
  caseIds?: string[];
  /** 失败重试次数（0 = 不重试，共执行 1+retry 次） */
  retry?: number;
}

export interface ContractRunResult {
  env: string;
  total: number;
  passed: number;
  failed: number;
  /** 失败明细（caseId + 原因） */
  failures: { caseId: string; reason: string }[];
  /** 未执行（无可执行 testData / 无环境配置） */
  skipped: number;
  skippedReasons: string[];
  /** 经历重试的用例数（失败后重试成功/仍失败都计入） */
  retried: number;
}

interface ExecutableCase {
  caseId: string;
  suiteId: string;
  platform: string;
  unit: string;
  unitSlug: string;
  testData: {
    method: string;
    path: string;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    expectStatus: number;
  };
}

/**
 * 执行契约测试（真实 HTTP 请求）
 */
export async function runContractTests(options: ContractRunOptions): Promise<ContractRunResult> {
  const { projectRoot, iteration, env, platform, suiteId, priority } = options;

  const environment = loadEnvironment(projectRoot, env);
  const result: ContractRunResult = {
    env,
    total: 0,
    passed: 0,
    failed: 0,
    failures: [],
    skipped: 0,
    skippedReasons: [],
    retried: 0,
  };

  if (!environment) {
    result.skippedReasons.push(
      `环境配置 ${env} 不存在：请在 ${path.join(projectRoot, '.spectest', 'environments', `${env}.yaml`)} 声明 baseUrl`
    );
    return result;
  }

  const unresolved = unresolvedVars(environment.headers);
  if (unresolved.length > 0) {
    result.skippedReasons.push(`环境变量未设置：${unresolved.join('、')}（headers 中的 \${VAR} 未解析）`);
    return result;
  }

  // 收集可执行契约用例（api 契约面，testData 携带请求信息；priority/caseIds 过滤在此层收窄）
  const cases = collectExecutableCases(projectRoot, iteration, {
    platform, suiteId, priority, caseIds: options.caseIds,
  });
  result.total = cases.length;

  const maxAttempts = Math.max(1, 1 + (options.retry ?? 0));
  for (const tc of cases) {
    // 失败重试：最终结果以最后一次执行判定为准，重试期间不写中间态（矩阵只记终局）
    let outcome = await executeOne(tc, environment);
    for (let attempt = 2; attempt <= maxAttempts && !outcome.passed; attempt++) {
      result.retried++;
      const retryOutcome = await executeOne(tc, environment);
      if (retryOutcome.passed) {
        outcome = { passed: true, reason: `重试第 ${attempt} 次通过：${retryOutcome.reason}` };
      } else {
        outcome = { passed: false, reason: `重试 ${maxAttempts - 1} 次后仍失败：${retryOutcome.reason}` };
      }
    }
    if (outcome.passed) {
      result.passed++;
    } else {
      result.failed++;
      result.failures.push({ caseId: tc.caseId, reason: outcome.reason });
    }
    // 结果归一回填矩阵（矩阵是唯一事实）
    updateCaseResult(
      projectRoot, iteration, tc.platform, tc.unitSlug, tc.caseId,
      outcome.passed ? 'passed' : 'failed', outcome.reason
    );
  }

  return result;
}

/** 收集过滤条件（套件/端/优先级/用例级，任一不匹配即剔除） */
interface CollectFilter {
  platform?: string;
  suiteId?: string;
  /** high = P0（与 gate 的 P0 定义一致） */
  priority?: 'high' | 'medium' | 'low';
  /** 幂等 caseId 白名单 */
  caseIds?: string[];
}

/** 从矩阵登记 + 用例文件收集可执行契约用例（按过滤条件收窄） */
function collectExecutableCases(
  projectRoot: string, iteration: string, filter: CollectFilter = {}
): ExecutableCase[] {
  const { platform, suiteId, priority, caseIds } = filter;
  const matrices = loadAllMatrices(projectRoot, iteration);
  const out: ExecutableCase[] = [];

  for (const m of matrices) {
    if (platform && m.platform !== platform) continue;
    if (m.unitSlug !== 'api-contract') continue; // 契约面专属（套件过滤在 suites 目录循环内）

    const suitesDir = getUnitSuitesDir(projectRoot, m.platform, m.unitSlug, iteration);
    if (!fs.existsSync(suitesDir)) continue;

    for (const sd of fs.readdirSync(suitesDir, { withFileTypes: true })) {
      if (!sd.isDirectory()) continue;
      if (suiteId && sd.name !== suiteId) continue;
      const casesDir = path.join(suitesDir, sd.name, 'cases');
      if (!fs.existsSync(casesDir)) continue;

      for (const f of fs.readdirSync(casesDir)) {
        if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
        const casePath = path.join(casesDir, f);
        let doc: unknown;
        try {
          doc = yaml.load(fs.readFileSync(casePath, 'utf-8'), { schema: yaml.CORE_SCHEMA });
        } catch {
          continue;
        }
        const parsed = TestCaseSchema.safeParse(doc);
        if (!parsed.success) continue;
        // 优先级过滤 / 用例级过滤（zod 已保证 priority 与 id 字段存在）
        if (priority && parsed.data.priority !== priority) continue;
        if (caseIds && caseIds.length > 0 && !caseIds.includes(parsed.data.id)) continue;
        const td = parsed.data.testData as Record<string, unknown> | undefined;
        if (!td || typeof td.method !== 'string' || typeof td.path !== 'string') continue;

        out.push({
          caseId: parsed.data.id,
          suiteId: sd.name,
          platform: m.platform,
          unit: m.unit,
          unitSlug: m.unitSlug,
          testData: {
            method: td.method,
            path: td.path,
            query: (td.query as Record<string, unknown>) ?? undefined,
            body: (td.body as Record<string, unknown>) ?? undefined,
            expectStatus: typeof td.expectStatus === 'number' ? td.expectStatus : 200,
          },
        });
      }
    }
  }

  return out;
}

/**
 * 环境矩阵编排：同一批用例跨环境执行（SIT/UAT 对比回归）
 *
 * 单环境原子性：逐环境调用 runContractTests，某环境缺配置只影响该环境行（报缺不脑补），
 * 其余环境照常执行。命令层据此逐行展示。
 */
export interface ContractMatrixEntry {
  env: string;
  result: ContractRunResult;
}

export async function runContractMatrix(
  options: Omit<ContractRunOptions, 'env'> & { envs: string[] }
): Promise<ContractMatrixEntry[]> {
  const entries: ContractMatrixEntry[] = [];
  for (const env of options.envs) {
    entries.push({ env, result: await runContractTests({ ...options, env }) });
  }
  return entries;
}

/** 执行单个契约用例：组装请求 → fetch → 状态码断言 */
async function executeOne(
  tc: ExecutableCase,
  environment: TestEnvironment
): Promise<{ passed: boolean; reason: string }> {
  const url = `${environment.baseUrl.replace(/\/+$/, '')}${tc.testData.path}`;
  const started = Date.now();

  let response: { status: number };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), environment.timeoutMs);

    const isBodyMethod = ['POST', 'PUT', 'PATCH'].includes(tc.testData.method.toUpperCase());
    const res = await fetch(url, {
      method: tc.testData.method,
      headers: { 'Content-Type': 'application/json', ...environment.headers },
      ...(isBodyMethod && tc.testData.body ? { body: JSON.stringify(tc.testData.body) } : {}),
      signal: controller.signal,
    });
    clearTimeout(timer);
    response = { status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      passed: false,
      reason: `请求失败（${url}）：${msg}`,
    };
  }

  const durationMs = Date.now() - started;
  if (response.status === tc.testData.expectStatus) {
    return { passed: true, reason: `HTTP ${response.status}（${durationMs}ms）符合契约期望` };
  }
  return {
    passed: false,
    reason: `HTTP ${response.status} ≠ 契约期望 ${tc.testData.expectStatus}（${url}）`,
  };
}
