import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { queryACCoverage, detectACDrift, queryImpact, queryAffectedByTask } from '../../src/core/predicates.js';
import { ensureUnitMatrix, registerCase } from '../../src/core/trace-matrix.js';
import { getIterationDir } from '../../src/core/trace-matrix.js';

/** 构建最小 mock 项目：SpecCore 迭代 + Spectest 矩阵 */
function setupMock() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-pred-'));
  const iteration = 'Iteration-001-mock';
  const iterDir = path.join(root, iteration);
  const specsDir = path.join(iterDir, '020-specs');

  // SpecCore 侧：booking 单元 × h5-mobile 端，TEST.md 两条 AC
  fs.ensureDirSync(path.join(specsDir, 'booking', 'h5-mobile'));
  fs.writeFileSync(
    path.join(specsDir, 'booking', 'h5-mobile', 'TEST.md'),
    `# 测试规格\n- [ ] AC-1: 当用户提交预订时，系统应创建订单\n- [ ] AC-2: 当余额不足时，系统应拒绝\n`,
    'utf-8'
  );
  // 骨架单元：skeleton 单元无真实 AC
  fs.ensureDirSync(path.join(specsDir, 'skeleton-unit', 'admin-web'));
  fs.writeFileSync(
    path.join(specsDir, 'skeleton-unit', 'admin-web', 'TEST.md'),
    `<!-- SPEC-SKELETON -->\n占位`,
    'utf-8'
  );

  // Spectest 侧：矩阵登记 booking/h5-mobile，AC-1 有证明、AC-2 无
  ensureUnitMatrix(root, iteration, 'h5-mobile', 'booking', 'booking', [
    { id: 'AC-001', description: '创建订单', scenario: 'happy' },
    { id: 'AC-002', description: '余额不足拒绝', scenario: 'error' },
  ]);
  registerCase(root, iteration, 'h5-mobile', 'booking', 'TS-h5-mobile-booking-unit-AC-001', ['AC-001']);

  return { root, iteration, iterDir };
}

describe('predicates 共享谓词层', () => {
  let env: ReturnType<typeof setupMock>;

  beforeEach(() => {
    env = setupMock();
  });

  it('queryACCoverage：矩阵 traces.caseIds 是覆盖判定的唯一事实', () => {
    const q = queryACCoverage(env.root, env.iteration);
    expect(q.covered).toHaveLength(1);
    expect(q.covered[0].acId).toBe('AC-001');
    expect(q.covered[0].caseIds).toContain('TS-h5-mobile-booking-unit-AC-001');
    expect(q.uncovered).toHaveLength(1);
    expect(q.uncovered[0].acId).toBe('AC-002');
    // 骨架缺口独立呈现（报缺不脑补）
    expect(q.specGaps).toHaveLength(1);
    expect(q.specGaps[0].unit).toBe('skeleton-unit');
  });

  it('detectACDrift：spec 内容变化 → 版本锚漂移', () => {
    // 先落 SUITE.yaml 锚（模拟 gen 预建）
    const suiteDir = path.join(getIterationDir(env.root, env.iteration), 'h5-mobile', 'booking', 'suites', 'TS-h5-mobile-booking-unit');
    fs.ensureDirSync(suiteDir);
    const testPath = path.join(env.iterDir, '020-specs', 'booking', 'h5-mobile', 'TEST.md');
    const sha = (c: string) => `sha256:${require('crypto').createHash('sha256').update(c, 'utf-8').digest('hex').slice(0, 16)}`;
    const suite = {
      id: 'TS-h5-mobile-booking-unit',
      name: 'x', description: '', iteration: env.iteration, platform: 'h5-mobile', unit: 'booking',
      testCaseIds: [], type: 'unit', tags: [], passRate: 0,
      specSource: { testPath, contentHash: sha('old'), acCount: 2 },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(suiteDir, 'SUITE.yaml'), require('js-yaml').dump(suite), 'utf-8');

    const drift = detectACDrift(env.root, env.iteration);
    expect(drift).toHaveLength(1);
    expect(drift[0].suiteId).toBe('TS-h5-mobile-booking-unit');
    expect(drift[0].currAcCount).toBe(2);
    expect(drift[0].hashChanged).toBe(true);
  });

  it('queryImpact：漂移套件全部用例 need-update，新增 AC 给出建议', () => {
    // 制造漂移 + 新增 AC：TEST.md 加 AC-3
    const testPath = path.join(env.iterDir, '020-specs', 'booking', 'h5-mobile', 'TEST.md');
    const suiteDir = path.join(getIterationDir(env.root, env.iteration), 'h5-mobile', 'booking', 'suites', 'TS-h5-mobile-booking-unit');
    fs.ensureDirSync(suiteDir);
    const sha = (c: string) => `sha256:${require('crypto').createHash('sha256').update(c, 'utf-8').digest('hex').slice(0, 16)}`;
    const suite = {
      id: 'TS-h5-mobile-booking-unit',
      name: 'x', description: '', iteration: env.iteration, platform: 'h5-mobile', unit: 'booking',
      testCaseIds: ['TS-h5-mobile-booking-unit-AC-001'], type: 'unit', tags: [], passRate: 0,
      specSource: { testPath, contentHash: sha('old'), acCount: 2 },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(suiteDir, 'SUITE.yaml'), require('js-yaml').dump(suite), 'utf-8');
    fs.appendFileSync(testPath, '\n- [ ] AC-3: 当订单取消时，系统应退款\n', 'utf-8');

    const impact = queryImpact(env.root, env.iteration);
    expect(impact.affected.some(a => a.caseId === 'TS-h5-mobile-booking-unit-AC-001' && a.impact === 'need-update')).toBe(true);
    // 漂移建议：新增 1 条 AC
    expect(impact.newlyRequired.some(n => n.includes('新增 1 条 AC'))).toBe(true);
  });

  it('queryAffectedByTask：契约面用例 tags 命中 Task ID', () => {
    // 造一个 api-contract 单元矩阵 + 用例文件含 taskId 标签
    ensureUnitMatrix(env.root, env.iteration, 'booking-service', 'API 契约', 'api-contract', []);
    const suiteDir = path.join(getIterationDir(env.root, env.iteration), 'booking-service', 'api-contract', 'suites', 'TS-booking-service-api-contract-api');
    fs.ensureDirSync(path.join(suiteDir, 'cases'));
    fs.writeFileSync(
      path.join(suiteDir, 'cases', 'TS-booking-service-api-contract-api-EP-001.yaml'),
      `id: TS-booking-service-api-contract-api-EP-001\ntags: ['api', 'Task-001-create-order', 'happy-path']\n`,
      'utf-8'
    );

    const affected = queryAffectedByTask(env.root, env.iteration, 'Task-001-create-order');
    expect(affected).toHaveLength(1);
    expect(affected[0].caseId).toBe('TS-booking-service-api-contract-api-EP-001');
  });
});
