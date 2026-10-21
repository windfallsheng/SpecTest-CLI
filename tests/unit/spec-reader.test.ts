import { describe, it, expect } from 'vitest';
import {
  extractAC, normalizeACId, buildSuiteId, buildCaseId, slugify,
  findIterationDir, scanSpecIndex, scanExternalSpecDir,
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

describe('scanExternalSpecDir（--spec-dir 独立输入通道）', () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = require('fs-extra');
  const os = require('os');
  const path = require('path');

  function makeSpecTree() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'spectest-specdir-'));
    const unitDir = path.join(root, 'yudingguanli', 'h5-mobile');
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(
      path.join(unitDir, 'TEST.md'),
      '- [ ] AC-1: 用户正常下单\n- [ ] AC-2: 库存不足时下单失败\n',
      'utf-8'
    );
    return root;
  }

  it('形态一：直接给 020-specs 等价目录 → 扫出单元 × 端', () => {
    const root = makeSpecTree();
    const index = scanExternalSpecDir(root, 'Ext-001');
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].unitName).toBe('yudingguanli');
    expect(index.entries[0].platform).toBe('h5-mobile');
    expect(index.entries[0].acs.map((a) => a.id)).toEqual(['AC-001', 'AC-002']);
    expect(index.entries[0].isSkeleton).toBe(false);
  });

  it('形态二：给迭代目录（含 020-specs 子目录）→ 自动进一层', () => {
    const root = makeSpecTree();
    const iterRoot = mkdtempSync(path.join(os.tmpdir(), 'spectest-iter-'));
    const srcSpecs = path.join(root);
    const dstSpecs = path.join(iterRoot, '020-specs');
    mkdirSync(path.dirname(dstSpecs), { recursive: true });
    require('fs-extra').copySync(srcSpecs, dstSpecs);
    const index = scanExternalSpecDir(iterRoot, 'Ext-002');
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].unitName).toBe('yudingguanli');
  });

  it('目录不存在 → 报缺不脑补（抛错带期望结构）', () => {
    expect(() => scanExternalSpecDir('/nonexistent/spec/dir', 'Ext-003')).toThrow(/规格目录不存在/);
  });

  it('空骨架（SPEC-SKELETON 残留）→ 标记规格缺口', () => {
    const root = makeSpecTree();
    const unitDir = path.join(root, 'kongdanwei', 'backend');
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(path.join(unitDir, 'TEST.md'), '<!-- SPEC-SKELETON -->\n', 'utf-8');
    const index = scanExternalSpecDir(root, 'Ext-004');
    const gap = index.entries.find((e) => e.unitName === 'kongdanwei');
    expect(gap?.isSkeleton).toBe(true);
  });
});
