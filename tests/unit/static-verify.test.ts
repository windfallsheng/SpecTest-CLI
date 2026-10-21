import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { runStaticVerify } from '../../src/core/static-verify';

/**
 * 静态验证引擎（gate 第一道闸）集成测试：临时项目树驱动五检查项
 */
describe('runStaticVerify 五检查项', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-verify-'));
    fs.ensureDirSync(path.join(root, '.spectest'));
  });

  afterEach(() => {
    fs.removeSync(root);
  });

  /** 搭 spec 面：Iteration-001-Q1/020-specs/{unit}/{platform}/TEST.md */
  function writeSpec(unit: string, platform: string, content: string): void {
    const dir = path.join(root, 'Iteration-001-Q1', '020-specs', unit, platform);
    fs.ensureDirSync(dir);
    fs.writeFileSync(path.join(dir, 'TEST.md'), content, 'utf-8');
  }

  /** 搭矩阵面：.spectest/iterations/Q1/{platform}/{unitSlug}/matrix/trace.yaml */
  function writeMatrix(platform: string, unit: string, unitSlug: string, yaml: string): void {
    const dir = path.join(root, '.spectest', 'iterations', 'Q1', platform, unitSlug, 'matrix');
    fs.ensureDirSync(dir);
    fs.writeFileSync(path.join(dir, 'trace.yaml'), yaml, 'utf-8');
  }

  /** 搭用例面：.spectest/GLOBAL/cases/{platform}/{unitSlug}/suites/{suiteId}/cases/{file}.yaml */
  function writeCase(platform: string, unitSlug: string, suiteId: string, file: string, yaml: string): void {
    const dir = path.join(root, '.spectest', 'GLOBAL', 'cases', platform, unitSlug, 'suites', suiteId, 'cases');
    fs.ensureDirSync(dir);
    fs.writeFileSync(path.join(dir, file), yaml, 'utf-8');
  }

  const GOOD_CASE = `id: TS-h5-mobile-yudingguanli-unit-AC-001
name: 用户正常下单
type: unit
priority: high
scenario: happy
suiteId: TS-h5-mobile-yudingguanli-unit
preconditions:
  - 已登录
steps:
  - step: 1
    action: 打开下单页
    expected: 显示下单表单
testData: {}
createdAt: 2026-01-01T00:00:00.000Z
updatedAt: 2026-01-01T00:00:00.000Z
`;

  it('全绿树：五检查项全过，passed=true', () => {
    writeSpec('yudingguanli', 'h5-mobile', '- [ ] AC-1: 用户正常下单\n');
    writeMatrix('h5-mobile', 'yudingguanli', 'yudingguanli', `unit: yudingguanli
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
    writeCase('h5-mobile', 'yudingguanli', 'TS-h5-mobile-yudingguanli-unit', 'TS-h5-mobile-yudingguanli-unit-AC-001.yaml', GOOD_CASE);

    const result = runStaticVerify(root, 'Q1');
    expect(result.passed).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('骨架缺口：SPEC-SKELETON 单元 → AC 格式完整性 error', () => {
    writeSpec('kongdanwei', 'h5-mobile', '<!-- SPEC-SKELETON -->\n');

    const result = runStaticVerify(root, 'Q1');
    const check = result.checks.find((c) => c.name === 'AC 格式完整性');
    expect(check?.passed).toBe(false);
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('AC 无证明：矩阵 caseIds 空 → error', () => {
    writeSpec('yudingguanli', 'h5-mobile', '- [ ] AC-1: 用户正常下单\n');
    writeMatrix('h5-mobile', 'yudingguanli', 'yudingguanli', `unit: yudingguanli
unitSlug: yudingguanli
platform: h5-mobile
updatedAt: 2026-01-01T00:00:00.000Z
traces:
  - acId: AC-001
    acDesc: 用户正常下单
    scenario: happy
    caseIds: []
cases: []
`);

    const result = runStaticVerify(root, 'Q1');
    const check = result.checks.find((c) => c.name === 'AC 用例证明');
    expect(check?.passed).toBe(false);
    expect(check?.details[0]).toContain('AC-001');
  });

  it('用例缺段：缺 preconditions → 四段齐全 error', () => {
    writeSpec('yudingguanli', 'h5-mobile', '- [ ] AC-1: 用户正常下单\n');
    writeMatrix('h5-mobile', 'yudingguanli', 'yudingguanli', `unit: yudingguanli
unitSlug: yudingguanli
platform: h5-mobile
updatedAt: 2026-01-01T00:00:00.000Z
traces:
  - acId: AC-001
    acDesc: 用户正常下单
    scenario: happy
    caseIds: [TS-h5-mobile-yudingguanli-unit-AC-001]
cases: []
`);
    const bad = `id: TS-h5-mobile-yudingguanli-unit-AC-001
name: 缺前置条件用例
type: unit
priority: medium
scenario: happy
suiteId: TS-h5-mobile-yudingguanli-unit
preconditions: []
steps:
  - step: 1
    action: 打开页面
    expected: 显示
testData: {}
createdAt: 2026-01-01T00:00:00.000Z
updatedAt: 2026-01-01T00:00:00.000Z
`;
    writeCase('h5-mobile', 'yudingguanli', 'TS-h5-mobile-yudingguanli-unit', 'TS-h5-mobile-yudingguanli-unit-AC-001.yaml', bad);

    const result = runStaticVerify(root, 'Q1');
    const check = result.checks.find((c) => c.name === '用例四段齐全');
    expect(check?.passed).toBe(false);
    expect(check?.details.some((d) => d.includes('缺前置条件'))).toBe(true);
  });

  it('端级专项：backend 用例无事务/幂等/并发字段 → warning（不阻塞）', () => {
    writeSpec('dingdan', 'booking-service', '- [ ] AC-1: 创建订单\n');
    writeMatrix('booking-service', 'dingdan', 'dingdan', `unit: dingdan
unitSlug: dingdan
platform: booking-service
updatedAt: 2026-01-01T00:00:00.000Z
traces:
  - acId: AC-001
    acDesc: 创建订单
    scenario: happy
    caseIds: [TS-booking-service-dingdan-unit-AC-001]
cases: []
`);
    const plain = `id: TS-booking-service-dingdan-unit-AC-001
name: 创建订单
type: unit
priority: medium
scenario: happy
suiteId: TS-booking-service-dingdan-unit
preconditions:
  - 已登录
steps:
  - step: 1
    action: 提交订单
    expected: 成功
testData: {}
createdAt: 2026-01-01T00:00:00.000Z
updatedAt: 2026-01-01T00:00:00.000Z
`;
    writeCase('booking-service', 'dingdan', 'TS-booking-service-dingdan-unit', 'TS-booking-service-dingdan-unit-AC-001.yaml', plain);

    const result = runStaticVerify(root, 'Q1');
    const check = result.checks.find((c) => c.name === '端级专项覆盖');
    expect(check?.level).toBe('warning');
    expect(check?.passed).toBe(false);
    expect(check?.details[0]).toContain('事务/幂等/并发');
  });
});
