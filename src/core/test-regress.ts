import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { queryImpact, queryAffectedByTask, type AffectedCase } from './predicates.js';
import { loadAllMatrices, getIterationDir, getUnitSuitesDir } from './trace-matrix.js';

/**
 * 变更影响分析选项
 */
export interface ImpactAnalysisOptions {
  projectRoot: string;
  iteration: string;
  changedTaskId?: string;
  platform?: string;
  unit?: string;
}

/**
 * 变更影响分析结果（Step 4 收敛版：判定全部来自矩阵谓词）
 */
export interface ImpactResult {
  changedTaskId: string;
  affectedTestCases: AffectedTestCase[];
  newlyRequiredTests: string[];
  summary: string;
  generatedAt: string;
}

export interface AffectedTestCase {
  caseId: string;
  caseName: string;
  suiteId: string;
  platform: string;
  unit: string;
  impact: 'need-update' | 'new-required';
  reason: string;
}

/**
 * 回归测试选项
 */
export interface RegressOptions {
  projectRoot: string;
  iteration: string;
  changedTaskId?: string;
  suiteId?: string;
  platform?: string;
}

/**
 * 回归测试结果
 */
export interface RegressResult {
  totalAffected: number;
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  /** 无法执行的用例（执行器未接入，报缺不脑补） */
  notRunnable: number;
  changes: string[];
  generatedAt: string;
}

/**
 * 影响分析：AC 漂移（版本锚）+ Task 关联（契约标签）+ 未覆盖 AC 建议
 *
 * 铁律「判定收敛于矩阵」：不再扫描旧目录、不做描述字符串匹配。
 */
export function analyzeImpact(options: ImpactAnalysisOptions): ImpactResult {
  const { projectRoot, iteration, changedTaskId, platform, unit } = options;

  const affected = new Map<string, AffectedTestCase>();
  const add = (a: AffectedCase) => {
    if (!affected.has(a.caseId)) {
      affected.set(a.caseId, {
        caseId: a.caseId,
        caseName: resolveCaseName(projectRoot, iteration, a),
        suiteId: a.suiteId,
        platform: a.platform,
        unit: a.unit,
        impact: a.impact,
        reason: a.reason,
      });
    }
  };

  /** 读用例文件真实 name（解析失败回退 caseId） */
  function resolveCaseName(root: string, iter: string, a: AffectedCase): string {
    const casePath = path.join(
      getUnitSuitesDir(root, a.platform, a.unitSlug, iter), a.suiteId, 'cases', `${a.caseId}.yaml`
    );
    if (!fs.existsSync(casePath)) return a.caseId;
    try {
      const doc = yaml.load(fs.readFileSync(casePath, 'utf-8'), { schema: yaml.CORE_SCHEMA }) as { name?: string } | null;
      return doc?.name ?? a.caseId;
    } catch {
      return a.caseId;
    }
  }

  // 1. AC 漂移波及面（specSource 版本锚对比）
  for (const a of queryImpact(projectRoot, iteration, { platform, unit }).affected) {
    add(a);
  }

  // 2. Task 变更关联（契约面用例的 taskId 标签）
  if (changedTaskId) {
    for (const a of queryAffectedByTask(projectRoot, iteration, changedTaskId)) {
      add(a);
    }
  }

  // 3. 建议新增（未覆盖 AC + 骨架缺口）
  const newlyRequiredTests = queryImpact(projectRoot, iteration, { platform, unit }).newlyRequired;

  return {
    changedTaskId: changedTaskId || '全部',
    affectedTestCases: [...affected.values()],
    newlyRequiredTests,
    summary: `变更影响 ${affected.size} 个用例，建议新增 ${newlyRequiredTests.length} 项测试`,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 回归执行：受影响用例的「已登记事实」汇总
 *
 * 说明：真实执行由 Step 5 的三层链（verify/contract-runner/framework-run）完成，
 * 本函数只做两件确定性的事：
 * 1. 圈定受影响用例（谓词）
 * 2. 汇总矩阵中已登记的执行状态（updateCaseResult 回填的事实）
 *
 * 未接入执行器的用例如实计 notRunnable——报缺不脑补，绝不随机造假。
 */
export function runRegress(options: RegressOptions): RegressResult {
  const { projectRoot, iteration, changedTaskId, suiteId } = options;

  const impact = analyzeImpact({ projectRoot, iteration, changedTaskId });
  let scope = impact.affectedTestCases;

  if (suiteId) {
    scope = scope.filter((tc) => tc.suiteId === suiteId);
  }

  const matrices = loadAllMatrices(projectRoot, iteration);
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let notRunnable = 0;

  for (const tc of scope) {
    // 矩阵中登记的最近一次执行事实
    const m = matrices.find((x) => x.platform === tc.platform && x.unitSlug === tc.unit);
    const entry = m?.cases.find((c) => c.caseId === tc.caseId);

    if (!entry || !entry.lastRun) {
      notRunnable++; // 从未执行过：执行器未接入或未跑，如实报告
      continue;
    }
    switch (entry.status) {
      case 'passed': passed++; break;
      case 'failed':
      case 'blocked': failed++; break;
      case 'skipped': skipped++; break;
      default: notRunnable++;
    }
  }

  return {
    totalAffected: scope.length,
    executed: passed + failed + skipped,
    passed,
    failed,
    skipped,
    notRunnable,
    changes: scope.slice(0, 5).map((tc) => `${tc.caseId}: ${tc.reason}`),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 保存影响分析报告
 */
export function saveImpactReport(projectRoot: string, result: ImpactResult): string {
  const reportsDir = path.join(projectRoot, '.spectest', 'reports');
  fs.ensureDirSync(reportsDir);

  const reportPath = path.join(reportsDir, `impact-${result.changedTaskId}-${Date.now()}.md`);
  const md = generateImpactMarkdown(result);
  fs.writeFileSync(reportPath, md, 'utf-8');

  return reportPath;
}

function generateImpactMarkdown(result: ImpactResult): string {
  let md = `# 变更影响分析报告\n\n`;
  md += `> 变更 Task：${result.changedTaskId}\n`;
  md += `> 生成时间：${result.generatedAt}\n\n`;
  md += `## 摘要\n\n${result.summary}\n\n`;

  if (result.affectedTestCases.length > 0) {
    md += `## 受影响的测试用例 (${result.affectedTestCases.length})\n\n`;
    md += `| 用例 ID | 套件 | 影响 | 原因 |\n`;
    md += `|---------|------|------|------|\n`;
    for (const tc of result.affectedTestCases) {
      md += `| ${tc.caseId} | ${tc.suiteId} | ${tc.impact} | ${tc.reason} |\n`;
    }
    md += '\n';
  } else {
    md += `## ✅ 无受影响用例\n\n当前 spec 版本锚无漂移，无可关联的 Task 变更。\n\n`;
  }

  if (result.newlyRequiredTests.length > 0) {
    md += `## 建议新增测试\n\n`;
    for (const t of result.newlyRequiredTests) {
      md += `- [ ] ${t}\n`;
    }
    md += '\n';
  }

  return md;
}
