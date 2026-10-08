import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { aggregateIterationMetrics, listIterationsWithData } from '../../src/core/metrics.js';
import { ensureUnitMatrix, registerCase, updateCaseResult } from '../../src/core/trace-matrix.js';
import { bugCommand, closeBugCommand, listBugsCommand } from '../../src/commands/bug.js';
import { summaryCommand } from '../../src/commands/summary.js';
import { reportCommand } from '../../src/commands/report.js';
import { archiveCommand } from '../../src/commands/archive.js';
import { countOpenBugs } from '../../src/core/gate-checker.js';

/** 构建 mock 项目：矩阵 + 2 用例（1 high + 1 medium）+ 2 AC（只登记 1 个） */
function setupMock() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-metrics-'));
  const iteration = 'Iteration-001-mock';
  const iterDir = path.join(root, iteration);
  const specsDir = path.join(iterDir, '020-specs');

  fs.ensureDirSync(path.join(specsDir, 'booking', 'h5-mobile'));
  fs.writeFileSync(
    path.join(specsDir, 'booking', 'h5-mobile', 'TEST.md'),
    `# 测试规格\n- [ ] AC-001: 当用户提交预订时，系统应创建订单\n- [ ] AC-002: 当余额不足时，系统应拒绝\n`,
    'utf-8'
  );

  ensureUnitMatrix(root, iteration, 'h5-mobile', 'booking', 'booking', [
    { id: 'AC-001', description: '创建订单', scenario: 'happy' },
    { id: 'AC-002', description: '余额不足拒绝', scenario: 'error' },
  ]);
  registerCase(root, iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-001', ['AC-001'], 'high');
  // AC-002 有意不登记：覆盖率 50% 的事实基础；执行回填时 updateCaseResult 补登记

  // context（bug/summary/report/archive 依赖 ensureProjectRoot + loadContext）
  fs.ensureDirSync(path.join(root, '.spectest', 'local'));
  fs.writeJsonSync(path.join(root, '.spectest', 'local', 'context.json'), {
    currentIteration: iteration,
    currentSuite: '',
    projectRoot: root,
  });

  return { root, iteration, iterDir };
}

describe('metrics 聚合层（收敛于矩阵）', () => {
  let env: ReturnType<typeof setupMock>;

  beforeEach(() => {
    env = setupMock();
  });

  it('无执行事实：passRate/coverageRate 为 null（报缺不脑补，不伪造 100%）', () => {
    const m = aggregateIterationMetrics(env.root, env.iteration);
    expect(m.totalCases).toBe(1);
    expect(m.totalAC).toBe(2);
    expect(m.executedCases).toBe(0);
    expect(m.passRate).toBeNull(); // 无执行事实 → 报缺
    expect(m.coverageRate).toBe(50); // 覆盖事实存在（1/2 AC）→ 如实计算
  });

  it('执行事实聚合：1 过 1 败 → passRate 50，pending 归零', () => {
    updateCaseResult(env.root, env.iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-001', 'passed');
    updateCaseResult(env.root, env.iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-002', 'failed', '断言失败');

    const m = aggregateIterationMetrics(env.root, env.iteration);
    expect(m.executedCases).toBe(2);
    expect(m.passedCases).toBe(1);
    expect(m.failedCases).toBe(1);
    expect(m.pendingCases).toBe(0);
    expect(m.passRate).toBe(50);
    expect(m.coverageRate).toBe(100); // 执行回填补登记 AC-002 → 2/2 全覆盖
  });

  it('覆盖聚合：执行回填补登记 AC-002 → coverageRate 100', () => {
    updateCaseResult(env.root, env.iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-002', 'failed', '断言失败');
    const m = aggregateIterationMetrics(env.root, env.iteration);
    expect(m.coveredAC).toBe(2);
    expect(m.totalAC).toBe(2);
    expect(m.coverageRate).toBe(100);
  });

  it('P0 聚合：high 用例计数（passed/pending）', () => {
    updateCaseResult(env.root, env.iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-001', 'passed');
    const m = aggregateIterationMetrics(env.root, env.iteration);
    expect(m.p0).toEqual({ total: 1, passed: 1, pending: 0 });
  });

  it('缺陷聚合：open/closed 生命周期 + 跨期次过滤', () => {
    const bugsDir = path.join(env.root, '.spectest', 'bugs');
    fs.ensureDirSync(bugsDir);
    fs.writeJsonSync(path.join(bugsDir, 'BUG-001.json'), { id: 'BUG-001', status: 'open', iteration: env.iteration, severity: 'high', caseId: 'TS-x' });
    fs.writeJsonSync(path.join(bugsDir, 'BUG-002.json'), { id: 'BUG-002', status: 'closed', iteration: env.iteration, severity: 'low', caseId: 'TS-y' });
    fs.writeJsonSync(path.join(bugsDir, 'BUG-003.json'), { id: 'BUG-003', status: 'open', iteration: 'Iteration-999-other', severity: 'low', caseId: 'TS-z' });

    const m = aggregateIterationMetrics(env.root, env.iteration);
    expect(m.bugs).toEqual({ total: 2, open: 1, closed: 1 });
  });

  it('listIterationsWithData：只列出有迭代目录的期次并排序', () => {
    // 独立 root：setupMock 的 ensureUnitMatrix 会在 .spectest/iterations 下建期次目录
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-trend-'));
    fs.ensureDirSync(path.join(r, '.spectest', 'iterations', 'Iteration-003-c'));
    fs.ensureDirSync(path.join(r, '.spectest', 'iterations', 'Iteration-001-a'));
    fs.ensureDirSync(path.join(r, '.spectest', 'iterations', 'Iteration-002-b'));
    const list = listIterationsWithData(r);
    expect(list).toEqual(['Iteration-001-a', 'Iteration-002-b', 'Iteration-003-c']);
  });
});

describe('bug 双类生命周期（open → closed 闭环）', () => {
  let env: ReturnType<typeof setupMock>;
  let cwd: string;

  beforeEach(() => {
    env = setupMock();
    cwd = process.cwd();
    process.chdir(env.root);
  });

  afterEach(() => {
    process.chdir(cwd);
  });

  it('bugCommand 创建 → open 落盘 + INDEX.md 幂等重建', async () => {
    await bugCommand({ iteration: env.iteration, caseId: 'TS-h5-mobile-booking-unit-AC-001', severity: 'high', title: '金额精度丢失' });
    await new Promise((r) => setTimeout(r, 5)); // 避开同毫秒 ID 碰撞
    await bugCommand({ iteration: env.iteration, caseId: 'TS-h5-mobile-booking-unit-AC-002', severity: 'low', title: '余额校验绕过' });

    const bugsDir = path.join(env.root, '.spectest', 'bugs');
    const jsons = fs.readdirSync(bugsDir).filter((f) => f.endsWith('.json'));
    expect(jsons.length).toBe(2);
    for (const f of jsons) {
      const bug = fs.readJsonSync(path.join(bugsDir, f));
      expect(bug.status).toBe('open');
    }
    // INDEX.md 幂等：行数与 json 事实一致，无幽灵行
    const index = fs.readFileSync(path.join(bugsDir, 'INDEX.md'), 'utf-8');
    expect(index.split('\n').filter((l) => l.startsWith('| BUG-')).length).toBe(2);
    expect(countOpenBugs(env.root, env.iteration)).toHaveLength(2);
  });

  it('closeBugCommand 关闭 → gate 缺陷检查放行（修复闭环联动）', async () => {
    await bugCommand({ iteration: env.iteration, caseId: 'TS-h5-mobile-booking-unit-AC-001', severity: 'high', title: '金额精度丢失' });
    const bugsDir = path.join(env.root, '.spectest', 'bugs');
    const bugId = fs.readdirSync(bugsDir).find((f) => f.endsWith('.json'))!.replace(/\.json$/, '');

    expect(countOpenBugs(env.root, env.iteration)).toHaveLength(1);
    await closeBugCommand({ bugId });
    expect(countOpenBugs(env.root, env.iteration)).toHaveLength(0);

    const bug = fs.readJsonSync(path.join(bugsDir, `${bugId}.json`));
    expect(bug.status).toBe('closed');
  });

  it('listBugsCommand 状态过滤：默认 open，all 显示全部', async () => {
    await bugCommand({ iteration: env.iteration, caseId: 'TS-h5-mobile-booking-unit-AC-001', severity: 'high', title: '金额精度丢失' });
    const bugsDir = path.join(env.root, '.spectest', 'bugs');
    const bugId = fs.readdirSync(bugsDir).find((f) => f.endsWith('.json'))!.replace(/\.json$/, '');
    await closeBugCommand({ bugId });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await listBugsCommand({ status: 'open' });
    const openLines = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(openLines).not.toContain(bugId);
    expect(openLines).toContain('无匹配缺陷');

    logSpy.mockClear();
    await listBugsCommand({ status: 'all' });
    const allLines = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allLines).toContain(bugId);
    logSpy.mockRestore();
  });
});

describe('summary/report/archive 落盘产物（数据源 = metrics）', () => {
  let env: ReturnType<typeof setupMock>;
  let cwd: string;

  beforeEach(() => {
    env = setupMock();
    cwd = process.cwd();
    process.chdir(env.root);
  });

  afterEach(() => {
    process.chdir(cwd);
  });

  it('summary 报告：无执行事实如实显示「-」，落盘 summary-*.md', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await summaryCommand({ iteration: env.iteration });
    logSpy.mockRestore();

    const reportsDir = path.join(env.root, '.spectest', 'reports');
    const files = fs.readdirSync(reportsDir).filter((f) => f.startsWith('summary-'));
    expect(files.length).toBe(1);
    const md = fs.readFileSync(path.join(reportsDir, files[0]), 'utf-8');
    expect(md).toContain(`# 测试总结报告 - ${env.iteration}`);
    expect(md).toContain('| 通过率 | - |'); // 报缺不脑补
    expect(md).toContain('| 测试用例 | 1 |');
  });

  it('report 报告：AC 覆盖矩阵来自矩阵 traces + 用例状态回填', async () => {
    updateCaseResult(env.root, env.iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-001', 'passed');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await reportCommand({ iteration: env.iteration });
    logSpy.mockRestore();

    const reportsDir = path.join(env.root, '.spectest', 'reports');
    const files = fs.readdirSync(reportsDir).filter((f) => f.startsWith('test-report-'));
    expect(files.length).toBe(1);
    const md = fs.readFileSync(path.join(reportsDir, files[0]), 'utf-8');
    expect(md).toContain('## AC 覆盖矩阵');
    expect(md).toContain('AC-001');
    expect(md).toContain('AC-002');
    expect(md).toContain('通过'); // AC-001 用例状态
    expect(md).toContain('TS-h5-mobile-booking-unit-AC-001');
  });

  it('archive 归档：快照目录 + ARCHIVE_METRICS.json 度量随附', async () => {
    updateCaseResult(env.root, env.iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-001', 'passed');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await archiveCommand({ iteration: env.iteration });
    logSpy.mockRestore();

    const archiveDir = path.join(env.root, '.spectest', 'archive', env.iteration);
    expect(fs.existsSync(path.join(archiveDir, 'h5-mobile', 'booking', 'matrix', 'trace.yaml'))).toBe(true);
    const snap = fs.readJsonSync(path.join(archiveDir, 'ARCHIVE_METRICS.json'));
    expect(snap.metrics.iteration).toBe(env.iteration);
    expect(snap.metrics.passedCases).toBe(1);
    expect(snap.metrics.totalCases).toBe(1);
    expect(snap.archivedAt).toBeTruthy();
  });
});
