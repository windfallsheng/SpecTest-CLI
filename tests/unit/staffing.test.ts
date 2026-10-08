import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { loadStaffing, resolveTaskOwner, resolveSuiteOwner } from '../../src/core/staffing.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-staffing-'));
}

describe('loadStaffing', () => {
  it('解析 STAFFING.md 人员表格', () => {
    const dir = tmpDir();
    fs.outputFileSync(path.join(dir, 'STAFFING.md'), [
      '# 人员排期',
      '',
      '## 人员列表',
      '',
      '| 成员 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- |',
      '| 张三 | Web | 100% |',
      '| 李四 | 后台，小程序 | 50% |',
      '| 王五 | APP、Web | 80% |',
      '',
    ].join('\n'));
    const members = loadStaffing(dir);
    expect(members).toHaveLength(3);
    expect(members[0]).toEqual({ name: '张三', directions: ['Web'] });
    expect(members[1]).toEqual({ name: '李四', directions: ['后台', '小程序'] });
    expect(members[2]).toEqual({ name: '王五', directions: ['APP', 'Web'] });
  });

  it('无 STAFFING.md → 空数组', () => {
    expect(loadStaffing(tmpDir())).toEqual([]);
  });
});

describe('resolveTaskOwner', () => {
  it('feature 匹配 + 端子任务 owner 非空 → 返回', () => {
    const dir = tmpDir();
    fs.outputFileSync(path.join(dir, '030-tasks', 'Task-001-01', '.meta', 'feature'), 'yudingguanli');
    fs.outputFileSync(path.join(dir, '030-tasks', 'Task-001-01', 'h5-mobile', 'T-1', '.meta', 'owner'), '张三');
    expect(resolveTaskOwner(dir, 'yudingguanli', '预订管理', 'h5-mobile')).toBe('张三');
  });

  it('owner 为「未分配」→ null', () => {
    const dir = tmpDir();
    fs.outputFileSync(path.join(dir, '030-tasks', 'Task-001-01', '.meta', 'feature'), 'yudingguanli');
    fs.outputFileSync(path.join(dir, '030-tasks', 'Task-001-01', 'h5-mobile', 'T-1', '.meta', 'owner'), '未分配');
    expect(resolveTaskOwner(dir, 'yudingguanli', '预订管理', 'h5-mobile')).toBeNull();
  });

  it('无 030-tasks → null', () => {
    expect(resolveTaskOwner(tmpDir(), 'u', '单元', 'h5-mobile')).toBeNull();
  });
});

describe('resolveSuiteOwner', () => {
  it('任务 owner 优先于 STAFFING', () => {
    const dir = tmpDir();
    fs.outputFileSync(path.join(dir, '030-tasks', 'Task-001-01', '.meta', 'feature'), 'yudingguanli');
    fs.outputFileSync(path.join(dir, '030-tasks', 'Task-001-01', 'h5-mobile', 'T-1', '.meta', 'owner'), '张三');
    fs.outputFileSync(path.join(dir, 'STAFFING.md'), [
      '| 成员 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- |',
      '| 李四 | Web | 100% |',
    ].join('\n'));
    expect(resolveSuiteOwner(dir, 'yudingguanli', '预订管理', 'h5-mobile')).toBe('张三');
  });

  it('STAFFING 方向唯一成员 → 确定', () => {
    const dir = tmpDir();
    fs.outputFileSync(path.join(dir, 'STAFFING.md'), [
      '| 成员 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- |',
      '| 李四 | Web | 100% |',
    ].join('\n'));
    expect(resolveSuiteOwner(dir, 'yudingguanli', '预订管理', 'h5-mobile')).toBe('李四');
  });

  it('方向多成员 → undefined（不脑补）', () => {
    const dir = tmpDir();
    fs.outputFileSync(path.join(dir, 'STAFFING.md'), [
      '| 成员 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- |',
      '| 李四 | Web | 50% |',
      '| 王五 | Web | 50% |',
    ].join('\n'));
    expect(resolveSuiteOwner(dir, 'yudingguanli', '预订管理', 'h5-mobile')).toBeUndefined();
  });

  it('无人与未知端 → undefined', () => {
    const dir = tmpDir();
    fs.outputFileSync(path.join(dir, 'STAFFING.md'), [
      '| 成员 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- |',
      '| 李四 | 后台 | 100% |',
    ].join('\n'));
    expect(resolveSuiteOwner(dir, 'yudingguanli', '预订管理', 'h5-mobile')).toBeUndefined();
    expect(resolveSuiteOwner(dir, 'yudingguanli', '预订管理', 'unknown-end')).toBeUndefined();
  });
});
