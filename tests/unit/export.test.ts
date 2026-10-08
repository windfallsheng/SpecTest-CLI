import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { collectSuites } from '../../src/commands/export.js';

let root: string;

/** 搭全量库结构：GLOBAL/cases/{端}/{单元}/suites/{suiteId}/SUITE.yaml + cases */
function buildSuite(platform: string, unit: string, suiteId: string, iteration: string, owner?: string, caseCount = 2): void {
  const suiteDir = path.join(root, '.spectest', 'GLOBAL', 'cases', platform, unit, 'suites', suiteId);
  fs.outputFileSync(path.join(suiteDir, 'SUITE.yaml'), yaml.dump({
    id: suiteId,
    name: `${unit} · ${platform} · unit 测试套件`,
    description: '',
    iteration,
    platform,
    unit,
    ...(owner ? { owner } : {}),
    testCaseIds: Array.from({ length: caseCount }, (_, i) => `${suiteId}-AC-00${i + 1}`),
    type: 'unit',
    tags: [],
    passRate: 80,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }, { noRefs: true }));
  for (let i = 0; i < caseCount; i++) {
    fs.outputFileSync(path.join(suiteDir, 'cases', `${suiteId}-AC-00${i + 1}.yaml`), yaml.dump({
      id: `${suiteId}-AC-00${i + 1}`,
      name: `用例 ${i + 1}`,
      type: 'unit',
      status: 'draft',
      priority: 'medium',
      scenario: 'happy',
      suiteId,
      relatedAC: [`AC-00${i + 1}`],
      preconditions: [],
      steps: [{ step: 1, action: '操作', expected: '预期' }],
      tags: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }, { noRefs: true }));
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-export-'));
});

afterEach(() => {
  fs.removeSync(root);
});

describe('collectSuites', () => {
  it('全量聚合：无过滤 → 全部套件与用例', () => {
    buildSuite('h5-mobile', 'yudingguanli', 'TS-h5-mobile-yudingguanli-unit', 'Q1', '张三', 2);
    buildSuite('admin-web', 'login', 'TS-admin-web-login-unit', 'Q1', '李四', 1);
    const r = collectSuites(root, { units: [] });
    expect(r).toHaveLength(2);
    expect(r.reduce((s, e) => s + e.cases.length, 0)).toBe(3);
  });

  it('期次过滤：只取 suite.iteration 匹配', () => {
    buildSuite('h5-mobile', 'yudingguanli', 'TS-h5-mobile-yudingguanli-unit', 'Q1', '张三', 1);
    buildSuite('admin-web', 'login', 'TS-admin-web-login-unit', 'Q2', '李四', 1);
    const r = collectSuites(root, { iteration: 'Q1', units: [] });
    expect(r).toHaveLength(1);
    expect(r[0].suite.id).toBe('TS-h5-mobile-yudingguanli-unit');
  });

  it('单元多选：slug 与中文名均可匹配', () => {
    buildSuite('h5-mobile', 'yudingguanli', 'TS-h5-mobile-yudingguanli-unit', 'Q1', '张三', 1);
    buildSuite('admin-web', 'login', 'TS-admin-web-login-unit', 'Q1', '李四', 1);
    buildSuite('app', 'pay', 'TS-app-pay-unit', 'Q1', '王五', 1);
    const bySlug = collectSuites(root, { units: ['yudingguanli', 'pay'] });
    expect(bySlug).toHaveLength(2);
    const byName = collectSuites(root, { units: ['login'] });
    expect(byName).toHaveLength(1);
    expect(byName[0].suite.id).toBe('TS-admin-web-login-unit');
  });

  it('负责人过滤：只取 owner 匹配的套件', () => {
    buildSuite('h5-mobile', 'yudingguanli', 'TS-h5-mobile-yudingguanli-unit', 'Q1', '张三', 1);
    buildSuite('admin-web', 'login', 'TS-admin-web-login-unit', 'Q1', '李四', 1);
    const r = collectSuites(root, { units: [], owner: '张三' });
    expect(r).toHaveLength(1);
    expect(r[0].suite.owner).toBe('张三');
  });

  it('组合过滤：期次 + 单元 + 负责人', () => {
    buildSuite('h5-mobile', 'yudingguanli', 'TS-h5-mobile-yudingguanli-unit', 'Q1', '张三', 1);
    buildSuite('h5-mobile', 'login', 'TS-h5-mobile-login-unit', 'Q1', '张三', 1);
    buildSuite('h5-mobile', 'yudingguanli', 'TS-h5-mobile-yudingguanli-e2e', 'Q2', '张三', 1);
    const r = collectSuites(root, { iteration: 'Q1', units: ['yudingguanli'], owner: '张三' });
    expect(r).toHaveLength(1);
    expect(r[0].suite.id).toBe('TS-h5-mobile-yudingguanli-unit');
  });

  it('无匹配 → 空数组', () => {
    buildSuite('h5-mobile', 'yudingguanli', 'TS-h5-mobile-yudingguanli-unit', 'Q1', '张三', 1);
    expect(collectSuites(root, { units: [], owner: '不存在的人' })).toEqual([]);
    expect(collectSuites(root, { iteration: 'Q9', units: [] })).toEqual([]);
  });
});
