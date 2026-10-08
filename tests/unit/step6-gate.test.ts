import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { runGateChecks } from '../../src/core/gate-checker.js';
import { ensureUnitMatrix, registerCase, updateCaseResult } from '../../src/core/trace-matrix.js';
import {
  loadConfig, saveConfig, setConfigValue, getConfigPath,
} from '../../src/core/config.js';

/** 构建最小 mock 项目：矩阵 + 用例登记 + 可选执行事实 */
function setupMock() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-gate-'));
  const iteration = 'Iteration-001-mock';
  const iterDir = path.join(root, iteration);
  const specsDir = path.join(iterDir, '020-specs');

  fs.ensureDirSync(path.join(specsDir, 'booking', 'h5-mobile'));
  fs.writeFileSync(
    path.join(specsDir, 'booking', 'h5-mobile', 'TEST.md'),
    `# 测试规格\n- [ ] AC-1: 当用户提交预订时，系统应创建订单\n- [ ] AC-2: 当余额不足时，系统应拒绝\n`,
    'utf-8'
  );

  ensureUnitMatrix(root, iteration, 'h5-mobile', 'booking', 'booking', [
    { id: 'AC-001', description: '创建订单', scenario: 'happy' },
    { id: 'AC-002', description: '余额不足拒绝', scenario: 'error' },
  ]);
  registerCase(root, iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-001', ['AC-001'], 'high');
  // AC-002 有意不登记：覆盖率 50% 的事实基础；执行回填时 updateCaseResult 会补充登记

  return { root, iteration, iterDir };
}

const GATE_OPTS = { coverageThreshold: 50, passRateThreshold: 90 };

describe('gate-checker 判定引擎', () => {
  let env: ReturnType<typeof setupMock>;

  beforeEach(() => {
    env = setupMock();
  });

  it('覆盖率：矩阵 traces 事实（AC-001 覆盖/AC-002 无）→ 50% 达标、80% 不达标', () => {
    const low = runGateChecks(env.root, env.iteration, { ...GATE_OPTS, coverageThreshold: 50 });
    const cov = low.checks.find((c) => c.name === '覆盖率')!;
    expect(cov.passed).toBe(true);
    expect(cov.value).toContain('50%');

    const high = runGateChecks(env.root, env.iteration, { ...GATE_OPTS, coverageThreshold: 80 });
    const covHigh = high.checks.find((c) => c.name === '覆盖率')!;
    expect(covHigh.passed).toBe(false);
    expect(covHigh.details.join('')).toContain('AC-002');
  });

  it('通过率：无执行事实必须阻塞（铲除旧版「无记录默认 100」假数据）', () => {
    const result = runGateChecks(env.root, env.iteration, GATE_OPTS);
    const pass = result.checks.find((c) => c.name === '通过率')!;
    expect(pass.passed).toBe(false);
    expect(pass.value).toBe('-（无执行事实）');
    expect(result.passed).toBe(false);
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('通过率：执行事实驱动（1 过 1 败 → 50% < 90 → 阻塞）', () => {
    updateCaseResult(env.root, env.iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-001', 'passed');
    updateCaseResult(env.root, env.iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-002', 'failed', '断言失败');

    const result = runGateChecks(env.root, env.iteration, GATE_OPTS);
    const pass = result.checks.find((c) => c.name === '通过率')!;
    expect(pass.passed).toBe(false);
    expect(pass.value).toBe('50%（1/2 已执行）');
    expect(pass.details.join('')).toContain('TS-h5-mobile-booking-unit-AC-002');
  });

  it('P0 用例：high 未执行 → 阻塞；全过 → 放行（priority 收敛于矩阵）', () => {
    // 未执行
    const pending = runGateChecks(env.root, env.iteration, GATE_OPTS);
    const p0Pending = pending.checks.find((c) => c.name === 'P0 用例')!;
    expect(p0Pending.passed).toBe(false);
    expect(p0Pending.details.join('')).toContain('未执行');

    // high 通过、medium 失败 → P0 仍放行
    updateCaseResult(env.root, env.iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-001', 'passed');
    updateCaseResult(env.root, env.iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-002', 'failed');
    const after = runGateChecks(env.root, env.iteration, GATE_OPTS);
    const p0After = after.checks.find((c) => c.name === 'P0 用例')!;
    expect(p0After.passed).toBe(true);
    expect(p0After.value).toBe('1/1 通过');
  });

  it('P0 用例：无 high 用例 → 如实跳过（不造假为「全过」）', () => {
    // 独立项目：仅 low 用例（当前 mock 含 high 用例，须隔离验证）
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-p0low-'));
    const iteration = 'Iteration-001-mock';
    ensureUnitMatrix(root, iteration, 'h5-mobile', 'extra', 'extra', [
      { id: 'AC-010', description: '低频功能', scenario: 'edge' },
    ]);
    registerCase(root, iteration, 'h5-mobile', 'extra', 'TS-h5-mobile-extra-unit-AC-010', ['AC-010'], 'low');
    const result = runGateChecks(root, iteration, GATE_OPTS);
    const p0 = result.checks.find((c) => c.name === 'P0 用例')!;
    expect(p0.passed).toBe(true);
    expect(p0.value).toBe('0 个（无 P0 用例）');
  });

  it('规格漂移：warning 级提示复核（不阻塞）', () => {
    // 落 SUITE.yaml 版本锚（模拟 gen 预建），随后 TEST.md 变更 → 漂移
    const testPath = path.join(env.iterDir, '020-specs', 'booking', 'h5-mobile', 'TEST.md');
    const sha = (c: string) =>
      `sha256:${require('crypto').createHash('sha256').update(c, 'utf-8').digest('hex').slice(0, 16)}`;
    const fullSuiteDir = path.join(
      env.iterDir, '..', '.spectest', 'iterations', env.iteration,
      'h5-mobile', 'booking', 'suites', 'TS-h5-mobile-booking-unit'
    );
    fs.ensureDirSync(fullSuiteDir);
    fs.writeFileSync(
      path.join(fullSuiteDir, 'SUITE.yaml'),
      require('js-yaml').dump({
        id: 'TS-h5-mobile-booking-unit', name: 'x', description: '',
        iteration: env.iteration, platform: 'h5-mobile', unit: 'booking',
        testCaseIds: ['TS-h5-mobile-booking-unit-AC-001'], type: 'unit', tags: [], passRate: 0,
        specSource: { testPath, contentHash: sha('old'), acCount: 2 },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
      'utf-8'
    );

    // 全部执行通过 → error 全过，但 TEST.md 变更 → 漂移 warning
    updateCaseResult(env.root, env.iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-001', 'passed');
    updateCaseResult(env.root, env.iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-002', 'passed');
    fs.writeFileSync(
      path.join(env.iterDir, '020-specs', 'booking', 'h5-mobile', 'TEST.md'),
      `# 测试规格\n- [ ] AC-1: 当用户提交预订时，系统应创建订单\n- [ ] AC-2: 当余额不足时，系统应拒绝\n- [ ] AC-3: 新增 AC\n`,
      'utf-8'
    );

    const result = runGateChecks(env.root, env.iteration, GATE_OPTS);
    const drift = result.checks.find((c) => c.name === '规格漂移')!;
    expect(drift.level).toBe('warning');
    expect(drift.passed).toBe(false);
    expect(drift.details.join('')).toContain('AC 2→3');
    // warning 不阻塞：error 级全过 → 整体放行
    expect(result.passed).toBe(true);
    expect(result.warningCount).toBeGreaterThan(0);
  });

  it('未修复缺陷：open 计数阻塞，跨期次缺陷不计', () => {
    const bugsDir = path.join(env.root, '.spectest', 'bugs');
    fs.ensureDirSync(bugsDir);
    fs.writeJsonSync(path.join(bugsDir, 'BUG-1.json'), {
      id: 'BUG-1', caseId: 'TS-h5-mobile-booking-unit-AC-001',
      severity: 'high', title: '订单金额精度丢失', status: 'open', iteration: env.iteration,
    });
    fs.writeJsonSync(path.join(bugsDir, 'BUG-2.json'), {
      id: 'BUG-2', caseId: 'TS-x', severity: 'low', title: '其他期次',
      status: 'open', iteration: 'Iteration-999-other',
    });

    const result = runGateChecks(env.root, env.iteration, GATE_OPTS);
    const bug = result.checks.find((c) => c.name === '未修复缺陷')!;
    expect(bug.passed).toBe(false);
    expect(bug.value).toBe('1 个');
    expect(bug.details.join('')).toContain('BUG-1');
    expect(bug.details.join('')).not.toContain('BUG-2');
  });

  it('Task 过滤：无关联用例 → 直接 FAIL 且提示', () => {
    const result = runGateChecks(env.root, env.iteration, { ...GATE_OPTS, taskId: 'Task-404' });
    expect(result.scope).toBe('Task-404');
    const rel = result.checks.find((c) => c.name === 'Task 关联')!;
    expect(rel.passed).toBe(false);
  });
});

describe('config 配置标准', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-config-'));
    fs.ensureDirSync(path.join(root, '.spectest'));
  });

  it('loadConfig：无文件回落内置默认值', () => {
    const c = loadConfig(root);
    expect(c.gate.coverageThreshold).toBe(80);
    expect(c.gate.passRateThreshold).toBe(90);
    expect(c.pipeline.interactive).toBe(false);
  });

  it('setConfigValue：类型解析（数字/布尔）并落盘', () => {
    setConfigValue(root, 'gate.coverageThreshold', '85');
    setConfigValue(root, 'pipeline.interactive', 'true');
    const c = loadConfig(root);
    expect(c.gate.coverageThreshold).toBe(85);
    expect(c.pipeline.interactive).toBe(true);
    expect(fs.existsSync(getConfigPath(root))).toBe(true);
  });

  it('setConfigValue：未知键报错、损坏文件回落默认', () => {
    expect(() => setConfigValue(root, 'gate.unknown', '1')).toThrow(/未知配置项/);
    fs.writeFileSync(getConfigPath(root), 'gate: [损坏', 'utf-8');
    expect(loadConfig(root).gate.coverageThreshold).toBe(80);
  });

  it('saveConfig 后 set 值保留（幂等读写）', () => {
    saveConfig(root, { gate: { coverageThreshold: 70, passRateThreshold: 95 }, pipeline: { interactive: false, defaultEnv: 'staging' } });
    const c = loadConfig(root);
    expect(c.gate.coverageThreshold).toBe(70);
    expect(c.pipeline.defaultEnv).toBe('staging');
  });
});
