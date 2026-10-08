import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  ensureUnitMatrix,
  registerCase,
  updateCaseResult,
  rebuildIndex,
  loadIndex,
  loadUnitMatrix,
  loadAllMatrices,
  getIndexPath,
} from '../../src/core/trace-matrix.js';

const ITERATION = 'Iteration-009';
const PLATFORM = 'h5-mobile';
const UNIT = 'yudingguanli';
const UNIT_NAME = '预订管理';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-matrix-'));
});

afterEach(() => {
  fs.removeSync(root);
});

const ACS = [
  { id: 'AC-001', description: '用户可以创建预订', scenario: 'happy' as const },
  { id: 'AC-002', description: '金额超限拒绝提交', scenario: 'boundary' as const },
  { id: 'AC-003', description: '无效参数返回错误', scenario: 'error' as const },
];

describe('ensureUnitMatrix 幂等性', () => {
  it('首次创建：AC 条目落盘，caseIds 为空', () => {
    const m = ensureUnitMatrix(root, ITERATION, PLATFORM, UNIT_NAME, UNIT, ACS);
    expect(m.traces).toHaveLength(3);
    expect(m.traces[0].caseIds).toEqual([]);
    expect(fs.existsSync(path.join(root, '.spectest', 'iterations', ITERATION, PLATFORM, UNIT, 'matrix', 'trace.yaml'))).toBe(true);
  });

  it('重跑覆盖：AC 以传入为准，已登记的 caseIds 保留', () => {
    ensureUnitMatrix(root, ITERATION, PLATFORM, UNIT_NAME, UNIT, ACS);
    registerCase(root, ITERATION, PLATFORM, UNIT, 'TS-h5-mobile-yudingguanli-unit-AC-001', ['AC-001']);

    // 传入 AC 减少一条
    const m2 = ensureUnitMatrix(root, ITERATION, PLATFORM, UNIT_NAME, UNIT, ACS.slice(0, 2));
    expect(m2.traces).toHaveLength(2);
    expect(m2.traces[0].caseIds).toEqual(['TS-h5-mobile-yudingguanli-unit-AC-001']);
  });

  it('重跑覆盖：传入新 AC 追加，旧的 caseIds 不丢', () => {
    ensureUnitMatrix(root, ITERATION, PLATFORM, UNIT_NAME, UNIT, ACS.slice(0, 2));
    const m2 = ensureUnitMatrix(root, ITERATION, PLATFORM, UNIT_NAME, UNIT, [...ACS.slice(0, 2), { id: 'AC-004', description: '并发创建幂等', scenario: 'edge' as const }]);
    expect(m2.traces).toHaveLength(3);
    expect(m2.traces.find(t => t.acId === 'AC-004')).toBeDefined();
  });
});

describe('registerCase 双向登记', () => {
  it('登记后 AC→cases 与 case→ACs 双向可见', () => {
    ensureUnitMatrix(root, ITERATION, PLATFORM, UNIT_NAME, UNIT, ACS);
    registerCase(root, ITERATION, PLATFORM, UNIT, 'TC-1', ['AC-001', 'AC-002']);

    const m = loadUnitMatrix(root, ITERATION, PLATFORM, UNIT)!;
    expect(m.traces.find(t => t.acId === 'AC-001')!.caseIds).toEqual(['TC-1']);
    expect(m.traces.find(t => t.acId === 'AC-002')!.caseIds).toEqual(['TC-1']);
    expect(m.traces.find(t => t.acId === 'AC-003')!.caseIds).toEqual([]);
    expect(m.cases.find(c => c.caseId === 'TC-1')!.acIds.sort()).toEqual(['AC-001', 'AC-002']);
  });

  it('重复登记不产生重复条目', () => {
    ensureUnitMatrix(root, ITERATION, PLATFORM, UNIT_NAME, UNIT, ACS);
    registerCase(root, ITERATION, PLATFORM, UNIT, 'TC-1', ['AC-001']);
    registerCase(root, ITERATION, PLATFORM, UNIT, 'TC-1', ['AC-001']);

    const m = loadUnitMatrix(root, ITERATION, PLATFORM, UNIT)!;
    expect(m.traces.find(t => t.acId === 'AC-001')!.caseIds).toEqual(['TC-1']);
    expect(m.cases.filter(c => c.caseId === 'TC-1')).toHaveLength(1);
  });

  it('矩阵不存在时抛错（先 ensure 后 register 的纪律）', () => {
    expect(() => registerCase(root, ITERATION, PLATFORM, UNIT, 'TC-1', ['AC-001'])).toThrow();
  });
});

describe('updateCaseResult 执行回填', () => {
  it('已登记用例：状态与结果回填', () => {
    ensureUnitMatrix(root, ITERATION, PLATFORM, UNIT_NAME, UNIT, ACS);
    registerCase(root, ITERATION, PLATFORM, UNIT, 'TC-1', ['AC-001']);
    updateCaseResult(root, ITERATION, PLATFORM, UNIT, 'TC-1', 'passed', 'OK');

    const m = loadUnitMatrix(root, ITERATION, PLATFORM, UNIT)!;
    const c = m.cases.find(c => c.caseId === 'TC-1')!;
    expect(c.status).toBe('passed');
    expect(c.lastResult).toBe('OK');
    expect(c.lastRun).not.toBeNull();
  });

  it('未登记用例：补登并回填', () => {
    ensureUnitMatrix(root, ITERATION, PLATFORM, UNIT_NAME, UNIT, ACS);
    updateCaseResult(root, ITERATION, PLATFORM, UNIT, 'TC-9', 'failed', 'assert error');

    const m = loadUnitMatrix(root, ITERATION, PLATFORM, UNIT)!;
    expect(m.cases.find(c => c.caseId === 'TC-9')!.status).toBe('failed');
  });
});

describe('rebuildIndex 总索引', () => {
  it('幂等重建：扫描矩阵目录生成索引', () => {
    ensureUnitMatrix(root, ITERATION, PLATFORM, UNIT_NAME, UNIT, ACS);
    ensureUnitMatrix(root, ITERATION, 'admin-web', 'yudingguanli', '预订管理', ACS);

    const idx = rebuildIndex(root, ITERATION);
    expect(idx.units).toHaveLength(2);
    expect(idx.units.map(u => u.platform).sort()).toEqual(['admin-web', 'h5-mobile']);

    // 重跑结果一致（幂等）
    const idx2 = rebuildIndex(root, ITERATION);
    expect(idx2.units).toEqual(idx.units);

    // 落盘可读回
    expect(loadIndex(root, ITERATION)!.units).toHaveLength(2);
    expect(fs.existsSync(getIndexPath(root, ITERATION))).toBe(true);
  });

  it('迭代目录不存在时抛错', () => {
    expect(() => rebuildIndex(root, ITERATION)).toThrow();
  });

  it('loadAllMatrices 自动重建并读全量', () => {
    ensureUnitMatrix(root, ITERATION, PLATFORM, UNIT_NAME, UNIT, ACS);
    // 删除索引强制重建
    fs.removeSync(getIndexPath(root, ITERATION));

    const all = loadAllMatrices(root, ITERATION);
    expect(all).toHaveLength(1);
    expect(all[0].platform).toBe(PLATFORM);
  });
});
