import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { runGateChecks } from '../../src/core/gate-checker';

/**
 * 质量门禁（gate 七检查）集成测试：临时项目树驱动
 * 门禁放行唯一依据：error 级全部通过。
 */
describe('runGateChecks 门禁判定', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-gate-'));
    fs.ensureDirSync(path.join(root, '.spectest'));
  });

  afterEach(() => {
    fs.removeSync(root);
  });

  function writeSpec(unit: string, platform: string, content: string): void {
    const dir = path.join(root, 'Iteration-001-Q1', '020-specs', unit, platform);
    fs.ensureDirSync(dir);
    fs.writeFileSync(path.join(dir, 'TEST.md'), content, 'utf-8');
  }

  function writeMatrix(platform: string, unitSlug: string, yaml: string): void {
    const dir = path.join(root, '.spectest', 'iterations', 'Q1', platform, unitSlug, 'matrix');
    fs.ensureDirSync(dir);
    fs.writeFileSync(path.join(dir, 'trace.yaml'), yaml, 'utf-8');
  }

  it('空项目：矩阵无任何 AC 事实 → 覆盖率 error，门禁不放行', () => {
    const result = runGateChecks(root, 'Q1', { coverageThreshold: 80, passRateThreshold: 90 });
    expect(result.passed).toBe(false);
    const coverage = result.checks.find((c) => c.name === '覆盖率');
    expect(coverage?.passed).toBe(false);
    expect(coverage?.message).toContain('无任何 AC 覆盖事实');
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('全绿树：全覆盖 + 全执行通过 + 无缺陷 → 门禁放行', () => {
    writeSpec('yudingguanli', 'h5-mobile', '- [ ] AC-1: 用户正常下单\n');
    writeMatrix('h5-mobile', 'yudingguanli', `unit: yudingguanli
unitSlug: yudingguanli
platform: h5-mobile
updatedAt: 2026-01-01T00:00:00.000Z
traces:
  - acId: AC-001
    acDesc: 用户正常下单
    scenario: happy
    caseIds: [TS-h5-mobile-yudingguanli-unit-AC-001]
cases:
  - caseId: TS-h5-mobile-yudingguanli-unit-AC-001
    status: passed
    priority: high
`);

    const result = runGateChecks(root, 'Q1', { coverageThreshold: 80, passRateThreshold: 90 });
    for (const c of result.checks) {
      if (c.level === 'error' && !c.passed) {
        console.log(`[FAIL] ${c.name}: ${c.message} ${c.details.join(';')}`);
      }
    }
    expect(result.passed).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('未执行用例：执行完备性 error，禁止放行', () => {
    writeSpec('yudingguanli', 'h5-mobile', '- [ ] AC-1: 用户正常下单\n');
    writeMatrix('h5-mobile', 'yudingguanli', `unit: yudingguanli
unitSlug: yudingguanli
platform: h5-mobile
updatedAt: 2026-01-01T00:00:00.000Z
traces:
  - acId: AC-001
    acDesc: 用户正常下单
    scenario: happy
    caseIds: [TS-h5-mobile-yudingguanli-unit-AC-001]
cases:
  - caseId: TS-h5-mobile-yudingguanli-unit-AC-001
    status: ready
    priority: high
`);

    const result = runGateChecks(root, 'Q1', { coverageThreshold: 80, passRateThreshold: 90 });
    const exec = result.checks.find((c) => c.name === '执行完备性');
    expect(exec?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('通过率不足：failed 用例拉低通过率 → 门禁拦截', () => {
    writeSpec('yudingguanli', 'h5-mobile', '- [ ] AC-1: 正常\n- [ ] AC-2: 异常\n');
    writeMatrix('h5-mobile', 'yudingguanli', `unit: yudingguanli
unitSlug: yudingguanli
platform: h5-mobile
updatedAt: 2026-01-01T00:00:00.000Z
traces:
  - acId: AC-001
    acDesc: 正常
    scenario: happy
    caseIds: [TS-h5-mobile-yudingguanli-unit-AC-001]
  - acId: AC-002
    acDesc: 异常
    scenario: error
    caseIds: [TS-h5-mobile-yudingguanli-unit-AC-002]
cases:
  - caseId: TS-h5-mobile-yudingguanli-unit-AC-001
    status: passed
    priority: high
  - caseId: TS-h5-mobile-yudingguanli-unit-AC-002
    status: failed
    priority: high
`);

    const result = runGateChecks(root, 'Q1', { coverageThreshold: 80, passRateThreshold: 90 });
    const passRate = result.checks.find((c) => c.name === '通过率');
    expect(passRate?.passed).toBe(false);
    expect(passRate?.value).toContain('50%');
    expect(result.passed).toBe(false);
  });

  it('Task 无关联用例 → Task 关联 error，如实报不能判定', () => {
    const result = runGateChecks(root, 'Q1', {
      coverageThreshold: 80, passRateThreshold: 90, taskId: 'Task-001',
    });
    const check = result.checks.find((c) => c.name === 'Task 关联');
    expect(check?.passed).toBe(false);
    expect(check?.message).toContain('未关联任何契约用例');
  });
});
