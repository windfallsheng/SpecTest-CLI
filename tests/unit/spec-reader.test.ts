import { describe, it, expect } from 'vitest';
import {
  extractAC, normalizeACId, buildSuiteId, buildCaseId, slugify,
  findIterationDir, scanSpecIndex,
} from '../../src/core/spec-reader';

describe('extractAC 双格式兼容', () => {
  it('checkbox 格式', () => {
    const acs = extractAC('- [ ] AC-1: 用户登录成功\n- [x] AC-2: 密码错误时提示异常');
    expect(acs).toHaveLength(2);
    expect(acs[0].id).toBe('AC-001');
    expect(acs[0].scenario).toBe('happy');
    expect(acs[1].scenario).toBe('error');
  });

  it('加粗编号格式（reverse-requirement）', () => {
    const acs = extractAC('- **AC-03**：当金额超过最大限制时，系统应拒绝提交。');
    expect(acs).toHaveLength(1);
    expect(acs[0].id).toBe('AC-003');
    expect(acs[0].scenario).toBe('boundary');
  });

  it('裸编号格式 + 去重', () => {
    const acs = extractAC('AC-1: 正常\nAC-1: 重复');
    expect(acs).toHaveLength(1);
  });
});

describe('normalizeACId', () => {
  it('AC-1/AC-01 → AC-001', () => {
    expect(normalizeACId('1')).toBe('AC-001');
    expect(normalizeACId('01')).toBe('AC-001');
    expect(normalizeACId('12')).toBe('AC-012');
  });
});

describe('幂等 ID', () => {
  it('套件 ID 确定性（重跑不变）', () => {
    const a = buildSuiteId('h5', slugify('用户管理'), 'unit');
    const b = buildSuiteId('h5', slugify('用户管理'), 'unit');
    expect(a).toBe(b);
  });

  it('用例 ID 锚定 AC', () => {
    expect(buildCaseId('h5', 'yudingguanli', 'unit', 'AC-001'))
      .toBe('TS-h5-yudingguanli-unit-AC-001');
  });

  it('slugify 中文稳定 + ASCII 清洗', () => {
    expect(slugify('用户管理')).toBe(slugify('用户管理'));
    expect(slugify('BookingService')).toBe('bookingservice');
  });
});

describe('scanSpecIndex 真实坐标（SpecCore 迭代项目）', () => {
  const root = '/Users/luzhaosheng/SmartDeveloper/DevWorkspace/AI/SpecCore-CLI/SpecCore';

  it('简称也能定位迭代目录', () => {
    const dir = findIterationDir(root, '002');
    expect(dir).toBeTruthy();
    expect(dir!.endsWith('Iteration-002-test-feature-module')).toBe(true);
  });

  it('扫描"功能单元 × 端"且全部识别为骨架缺口', () => {
    const idx = scanSpecIndex(root, '002');
    expect(idx.entries.length).toBeGreaterThan(0);
    // Iteration-002 的 TEST.md 均为 SPEC-SKELETON 残留，应全部标记缺口
    expect(idx.entries.every((e) => e.isSkeleton)).toBe(true);
  });
});
