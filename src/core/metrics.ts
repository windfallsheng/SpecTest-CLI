import path from 'path';
import fs from 'fs-extra';
import { loadAllMatrices, getIterationDir, getUnitSuitesDir } from './trace-matrix.js';
import { queryACCoverage, querySpecGaps, detectACDrift } from './predicates.js';
import { countOpenBugs } from './gate-checker.js';

/**
 * metrics.ts —— 度量聚合层（report/summary/trend/status 的唯一数据源）
 *
 * 铁律「判定收敛于矩阵」的最后一环：所有度量从矩阵 cases 的执行事实、
 * 谓词层的覆盖/缺口/漂移事实与缺陷目录计算，禁止扫描平铺目录、
 * 禁止解析历史报告 markdown（那是下游产物，不是事实源）。
 *
 * 报缺不脑补：无执行事实时 passRate 为 null（展示层如实显示「-」），
 * 绝不回退为 100%。
 */

export interface IterationMetrics {
  iteration: string;
  // ── 用例面（矩阵 cases 执行事实） ──
  totalUnits: number;
  totalSuites: number;
  totalCases: number;
  executedCases: number;
  passedCases: number;
  failedCases: number;
  skippedCases: number;
  /** draft/ready 未执行 */
  pendingCases: number;
  /** 无执行事实为 null（报缺） */
  passRate: number | null;
  // ── 覆盖面（谓词层） ──
  totalAC: number;
  coveredAC: number;
  /** 无 AC 事实为 null（报缺） */
  coverageRate: number | null;
  specGaps: number;
  driftSuites: number;
  // ── 优先级面 ──
  p0: { total: number; passed: number; pending: number };
  // ── 缺陷面 ──
  bugs: { total: number; open: number; closed: number };
}

const EXECUTED = new Set(['passed', 'failed', 'skipped', 'blocked']);

export function aggregateIterationMetrics(
  projectRoot: string,
  iteration: string
): IterationMetrics {
  const matrices = loadAllMatrices(projectRoot, iteration);
  const cases = matrices.flatMap((m) => m.cases);

  const executed = cases.filter((c) => EXECUTED.has(c.status));
  const passed = cases.filter((c) => c.status === 'passed');
  const failed = cases.filter((c) => c.status === 'failed');
  const skipped = cases.filter((c) => c.status === 'skipped');
  const pending = cases.filter((c) => !EXECUTED.has(c.status));

  // 覆盖事实（谓词层）
  const { covered, uncovered } = queryACCoverage(projectRoot, iteration);
  const totalAC = covered.length + uncovered.length;

  // 缺陷事实
  const allBugs = readAllBugs(projectRoot, iteration);
  const openBugs = countOpenBugs(projectRoot, iteration);

  // P0 事实（矩阵 priority=high）
  const p0 = cases.filter((c) => c.priority === 'high');
  const p0Passed = p0.filter((c) => c.status === 'passed');
  const p0Pending = p0.filter((c) => !EXECUTED.has(c.status));

  return {
    iteration,
    totalUnits: matrices.length,
    totalSuites: countSuites(projectRoot, iteration),
    totalCases: cases.length,
    executedCases: executed.length,
    passedCases: passed.length,
    failedCases: failed.length,
    skippedCases: skipped.length,
    pendingCases: pending.length,
    passRate: executed.length > 0
      ? Math.round((passed.length / executed.length) * 1000) / 10
      : null,
    totalAC,
    coveredAC: covered.length,
    coverageRate: totalAC > 0
      ? Math.round((covered.length / totalAC) * 1000) / 10
      : null,
    specGaps: querySpecGaps(projectRoot, iteration).length,
    driftSuites: detectACDrift(projectRoot, iteration).length,
    p0: { total: p0.length, passed: p0Passed.length, pending: p0Pending.length },
    bugs: {
      total: allBugs.length,
      open: openBugs.length,
      closed: allBugs.length - openBugs.length,
    },
  };
}

/** 套件数：期次矩阵涉及单元的套件（SUITE.yaml 是套件存在的唯一事实，落全量层） */
function countSuites(projectRoot: string, iteration: string): number {
  const matrices = loadAllMatrices(projectRoot, iteration);
  const seen = new Set<string>();
  let n = 0;
  for (const m of matrices) {
    const key = `${m.platform}/${m.unitSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const suitesDir = getUnitSuitesDir(projectRoot, m.platform, m.unitSlug, iteration);
    if (!fs.existsSync(suitesDir)) continue;
    for (const sd of fs.readdirSync(suitesDir, { withFileTypes: true })) {
      if (sd.isDirectory() && fs.existsSync(path.join(suitesDir, sd.name, 'SUITE.yaml'))) n++;
    }
  }
  return n;
}

/** 迭代全部缺陷（open/closed 生命周期） */
export function readAllBugs(
  projectRoot: string,
  iteration: string
): { id: string; status: string }[] {
  const bugsDir = path.join(projectRoot, '.spectest', 'bugs');
  if (!fs.existsSync(bugsDir)) return [];
  const bugs: { id: string; status: string }[] = [];
  for (const f of fs.readdirSync(bugsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const bug = fs.readJsonSync(path.join(bugsDir, f));
      if (bug.iteration && bug.iteration !== iteration) continue;
      bugs.push({ id: bug.id ?? f.replace(/\.json$/, ''), status: bug.status ?? 'open' });
    } catch { /* 忽略损坏记录 */ }
  }
  return bugs;
}

/** 跨迭代趋势点（trend 的数据源）：仅统计有矩阵事实的迭代 */
export function listIterationsWithData(projectRoot: string): string[] {
  const iterRoot = path.join(projectRoot, '.spectest', 'iterations');
  if (!fs.existsSync(iterRoot)) return [];
  return fs.readdirSync(iterRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}
