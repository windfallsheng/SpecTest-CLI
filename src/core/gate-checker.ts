import path from 'path';
import fs from 'fs-extra';
import {
  queryACCoverage, querySpecGaps, detectACDrift, queryAffectedByTask,
} from './predicates.js';
import { loadAllMatrices } from './trace-matrix.js';

/**
 * gate-checker.ts —— 质量门禁判定引擎（commands/gate.ts 的展示层之外）
 *
 * 铁律「报缺不脑补」：所有数值都来自矩阵/谓词的执行事实，
 * 没有任何 `return 100` 式的默认通过。未执行就是未执行，阻塞放行。
 *
 * 四元组 + 两项谓词增强：
 *   1. 覆盖率    —— queryACCoverage（矩阵 traces 事实）
 *   2. 规格完备性 —— querySpecGaps（SpecCore analyze 骨架缺口）
 *   3. 执行完备性 —— 全部用例均有执行事实（未执行的测试 = 质量未知 = 阻塞）
 *   4. 通过率    —— 已执行用例的通过率（无执行事实 → 阻塞）
 *   5. P0 通过率  —— 矩阵 cases.priority=high 的执行事实
 *   6. 规格漂移  —— detectACDrift（warning 级，提示复核不阻塞）
 *   7. 未修复缺陷 —— .spectest/bugs/ 中 open 状态
 */

// ============================================================
// 类型
// ============================================================

export interface GateCheckerOptions {
  /** 覆盖率阈值（默认 80，CLI/config 可覆盖） */
  coverageThreshold: number;
  /** 通过率阈值（默认 90） */
  passRateThreshold: number;
  /** 按 Task 限定检查范围（契约面用例标签关联） */
  taskId?: string;
}

export interface GateCheck {
  name: string;
  level: 'error' | 'warning';
  passed: boolean;
  /** 实测值（"-" 表示无执行事实） */
  value: string;
  /** 达标要求 */
  threshold: string;
  message: string;
  /** 具体问题清单 */
  details: string[];
}

export interface GateResult {
  iteration: string;
  /** 检查范围：全局或 Task 名 */
  scope: string;
  checks: GateCheck[];
  /** error 级全部通过才为 true（门禁放行唯一依据） */
  passed: boolean;
  errorCount: number;
  warningCount: number;
}

// ============================================================
// 判定主体
// ============================================================

/** 执行事实状态：updateCaseResult 写过 = 已执行 */
const EXECUTED_STATUSES = new Set(['passed', 'failed', 'skipped', 'blocked']);

export function runGateChecks(
  projectRoot: string,
  iteration: string,
  options: GateCheckerOptions
): GateResult {
  const checks: GateCheck[] = [];

  // Task 过滤：受影响用例集合 + 单元集合
  let taskCaseIds: Set<string> | null = null;
  let unitSet: Set<string> | null = null;
  if (options.taskId) {
    const affected = queryAffectedByTask(projectRoot, iteration, options.taskId);
    taskCaseIds = new Set(affected.map((a) => a.caseId));
    unitSet = new Set(affected.map((a) => `${a.platform}/${a.unitSlug}`));
    if (affected.length === 0) {
      checks.push({
        name: 'Task 关联',
        level: 'error',
        passed: false,
        value: '0 个用例',
        threshold: '≥ 1',
        message: '该 Task 未关联任何契约用例，无法判定',
        details: ['契约用例 tags 中未发现该 Task ID，请确认契约生成时已关联'],
      });
      return buildResult(iteration, options.taskId, checks);
    }
  }

  const inScope = (platform: string, unitSlug: string): boolean =>
    !unitSet || unitSet.has(`${platform}/${unitSlug}`);

  // ── 1. 覆盖率（矩阵 traces 事实） ──
  const { covered, uncovered } = queryACCoverage(projectRoot, iteration);
  const coveredInScope = covered.filter((c) => inScope(c.platform, c.unitSlug));
  const uncoveredInScope = uncovered.filter((c) => inScope(c.platform, c.unitSlug));
  const totalAC = coveredInScope.length + uncoveredInScope.length;
  if (totalAC === 0) {
    checks.push({
      name: '覆盖率',
      level: 'error',
      passed: false,
      value: '-',
      threshold: `≥ ${options.coverageThreshold}%`,
      message: '矩阵中无任何 AC 覆盖事实（请先 spectest gen/apply）',
      details: [],
    });
  } else {
    const rate = Math.round((coveredInScope.length / totalAC) * 1000) / 10;
    checks.push({
      name: '覆盖率',
      level: 'error',
      passed: rate >= options.coverageThreshold,
      value: `${rate}%（${coveredInScope.length}/${totalAC}）`,
      threshold: `≥ ${options.coverageThreshold}%`,
      message: rate >= options.coverageThreshold
        ? `覆盖率达标（${rate}% ≥ ${options.coverageThreshold}%）`
        : `覆盖率不足（${rate}% < ${options.coverageThreshold}%）`,
      details: uncoveredInScope.slice(0, 10).map(
        (u) => `[${u.platform}/${u.unit}] ${u.acId} ${u.acDesc.slice(0, 36)}（${u.scenario}）无证明用例`
      ),
    });
  }

  // ── 2. 规格完备性（SpecCore analyze 骨架缺口） ──
  const specGaps = querySpecGaps(projectRoot, iteration).filter((g) => inScope(g.platform, g.unit));
  checks.push({
    name: '规格完备性',
    level: 'error',
    passed: specGaps.length === 0,
    value: specGaps.length === 0 ? '完备' : `${specGaps.length} 个骨架缺口`,
    threshold: '0 个',
    message: specGaps.length === 0
      ? '所有单元规格已产出真实 AC'
      : `存在 ${specGaps.length} 个规格骨架缺口（SpecCore analyze 未完成）`,
    details: specGaps.map((g) => `[${g.platform}/${g.unit}] ${g.reason}`),
  });

  // ── 用例池：矩阵 cases 全集（Task 过滤时限定关联用例） ──
  const matrices = loadAllMatrices(projectRoot, iteration)
    .filter((m) => inScope(m.platform, m.unitSlug));
  const casesInScope = matrices.flatMap((m) =>
    m.cases.map((c) => ({ ...c, platform: m.platform, unit: m.unitSlug }))
  );
  const casePool = taskCaseIds
    ? casesInScope.filter((c) => taskCaseIds!.has(c.caseId))
    : casesInScope;

  // ── 3. 执行完备性（全部用例均有执行事实，未执行 = 质量未知） ──
  const executedPool = casePool.filter((c) => EXECUTED_STATUSES.has(c.status));
  const pendingPool = casePool.filter((c) => !EXECUTED_STATUSES.has(c.status));
  checks.push({
    name: '执行完备性',
    level: 'error',
    passed: casePool.length > 0 && pendingPool.length === 0,
    value: casePool.length === 0
      ? '-（范围内无用例）'
      : `${executedPool.length}/${casePool.length} 已执行`,
    threshold: '全部执行',
    message: pendingPool.length === 0
      ? `全部 ${casePool.length} 个用例均有执行事实`
      : `${pendingPool.length} 个用例尚未执行——测试没跑完禁止放行`,
    details: pendingPool.slice(0, 10).map((c) => `${c.caseId}（${c.status}）`),
  });

  // ── 4. 通过率（矩阵执行事实，无事实即阻塞） ──
  const executed = casePool.filter((c) => EXECUTED_STATUSES.has(c.status));
  if (executed.length === 0) {
    const drafted = casePool.filter((c) => c.status === 'draft' || c.status === 'ready').length;
    checks.push({
      name: '通过率',
      level: 'error',
      passed: false,
      value: '-（无执行事实）',
      threshold: `≥ ${options.passRateThreshold}%`,
      message: drafted > 0
        ? `尚未执行任何用例（${drafted} 个用例待执行）——未跑过测试禁止放行`
        : '范围内无用例，无法判定通过率',
      details: drafted > 0 ? ['请先 spectest run（或 contract-run）产生执行事实'] : [],
    });
  } else {
    const passedCount = executed.filter((c) => c.status === 'passed').length;
    const rate = Math.round((passedCount / executed.length) * 1000) / 10;
    const failed = executed.filter((c) => c.status !== 'passed');
    checks.push({
      name: '通过率',
      level: 'error',
      passed: rate >= options.passRateThreshold,
      value: `${rate}%（${passedCount}/${executed.length} 已执行）`,
      threshold: `≥ ${options.passRateThreshold}%`,
      message: rate >= options.passRateThreshold
        ? `通过率达标（${rate}% ≥ ${options.passRateThreshold}%）`
        : `通过率不足（${rate}% < ${options.passRateThreshold}%）`,
      details: failed.slice(0, 10).map((c) => `${c.caseId}（${c.status}）${c.lastResult ? `：${c.lastResult.slice(0, 40)}` : ''}`),
    });
  }

  // ── 4. P0 通过率（priority=high 的执行事实） ──
  const hasPriorityInfo = casePool.some((c) => c.priority !== undefined);
  const p0Cases = casePool.filter((c) => c.priority === 'high');
  if (!hasPriorityInfo && casePool.length > 0) {
    checks.push({
      name: 'P0 用例',
      level: 'warning',
      passed: true,
      value: '优先级未回填',
      threshold: '100%',
      message: '矩阵用例未登记优先级（旧数据），请重跑 spectest apply 回填',
      details: [],
    });
  } else if (p0Cases.length === 0) {
    checks.push({
      name: 'P0 用例',
      level: 'error',
      passed: true,
      value: '0 个（无 P0 用例）',
      threshold: '100%',
      message: '范围内无 P0（high）用例，如实跳过',
      details: [],
    });
  } else {
    const p0Passed = p0Cases.filter((c) => c.status === 'passed');
    const p0Pending = p0Cases.filter((c) => !EXECUTED_STATUSES.has(c.status));
    const allPassed = p0Passed.length === p0Cases.length;
    checks.push({
      name: 'P0 用例',
      level: 'error',
      passed: allPassed,
      value: `${p0Passed.length}/${p0Cases.length} 通过`,
      threshold: '100%',
      message: allPassed
        ? '所有 P0 用例通过'
        : `存在 ${p0Cases.length - p0Passed.length} 个未通过的 P0 用例`,
      details: [
        ...p0Cases.filter((c) => c.status !== 'passed').map((c) =>
          `${c.caseId}（${p0Pending.includes(c) ? '未执行' : c.status}）`),
      ],
    });
  }

  // ── 5. 规格漂移（warning：用例需复核，不阻塞但必须提示） ──
  const drift = detectACDrift(projectRoot, iteration)
    .filter((d) => inScope(d.platform, d.unitSlug));
  checks.push({
    name: '规格漂移',
    level: 'warning',
    passed: drift.length === 0,
    value: drift.length === 0 ? '无' : `${drift.length} 个套件`,
    threshold: '0 个',
    message: drift.length === 0
      ? 'Spec 版本锚一致，无漂移'
      : `${drift.length} 个套件的 Spec AC 已漂移，用例需复核`,
    details: drift.map((d) =>
      `[${d.platform}/${d.unit}] ${d.suiteId}（AC ${d.prevAcCount}→${d.currAcCount}）请重新 gen 接力`
    ),
  });

  // ── 6. 未修复缺陷 ──
  const openBugs = countOpenBugs(projectRoot, iteration, taskCaseIds);
  checks.push({
    name: '未修复缺陷',
    level: 'error',
    passed: openBugs.length === 0,
    value: `${openBugs.length} 个`,
    threshold: '0 个',
    message: openBugs.length === 0 ? '无未修复缺陷' : `存在 ${openBugs.length} 个未修复缺陷`,
    details: openBugs.slice(0, 10).map((b) => `${b.id}（${b.severity}）${b.title.slice(0, 36)}`),
  });

  return buildResult(iteration, options.taskId, checks);
}

function buildResult(iteration: string, taskId: string | undefined, checks: GateCheck[]): GateResult {
  const errors = checks.filter((c) => c.level === 'error');
  return {
    iteration,
    scope: taskId ?? '全局',
    checks,
    passed: errors.every((c) => c.passed),
    errorCount: errors.filter((c) => !c.passed).length,
    warningCount: checks.filter((c) => c.level === 'warning' && !c.passed).length,
  };
}

// ============================================================
// 缺陷事实源（.spectest/bugs/，bug 命令写入）
// ============================================================

export interface OpenBug {
  id: string;
  caseId: string;
  severity: string;
  title: string;
}

export function countOpenBugs(
  projectRoot: string,
  iteration: string,
  caseFilter: Set<string> | null = null
): OpenBug[] {
  const bugsDir = path.join(projectRoot, '.spectest', 'bugs');
  if (!fs.existsSync(bugsDir)) return [];

  const bugs: OpenBug[] = [];
  for (const f of fs.readdirSync(bugsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const bug = fs.readJsonSync(path.join(bugsDir, f));
      if (bug.status !== 'open') continue;
      if (bug.iteration && bug.iteration !== iteration) continue;
      if (caseFilter && !caseFilter.has(bug.caseId)) continue;
      bugs.push({
        id: bug.id ?? f.replace(/\.json$/, ''),
        caseId: bug.caseId ?? '',
        severity: bug.severity ?? 'medium',
        title: bug.title ?? '',
      });
    } catch { /* 忽略损坏记录 */ }
  }
  return bugs;
}
