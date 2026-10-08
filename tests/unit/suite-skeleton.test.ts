import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { prebuildSuites } from '../../src/core/suite-skeleton.js';
import { applyGeneratedCases } from '../../src/core/suite-apply.js';
import { loadUnitMatrix, loadIndex } from '../../src/core/trace-matrix.js';

const ITERATION = 'Iteration-009-test';

let root: string;

/** 构造 mock SpecCore 项目：020-specs/{单元}/{端}/TEST.md */
function buildMockSpecCore(iterName = ITERATION): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-skel-'));
  const specs = path.join(dir, iterName, '020-specs');

  // 真实 AC 单元
  fs.outputFileSync(path.join(specs, 'booking', 'h5-mobile', 'TEST.md'), [
    '# 预订管理 H5 测试规格',
    '',
    '## 验收标准',
    '- [ ] AC-1: 用户可以创建预订',
    '- [ ] AC-2: 金额超过最大限制时拒绝提交',
    '- [ ] AC-3: 无效参数返回明确错误',
  ].join('\n'));
  fs.outputFileSync(path.join(specs, 'user', 'h5-mobile', 'TEST.md'), [
    '# 用户管理 H5 测试规格',
    '',
    '## 验收标准',
    '- [ ] AC-1: 用户注册成功后跳转首页',
  ].join('\n'));

  // 骨架单元
  fs.outputFileSync(path.join(specs, 'booking', 'admin-web', 'TEST.md'),
    '<!-- SPEC-SKELETON -->\n# 待分析\n');

  return dir;
}

function writeCase(suiteDir: string, caseId: string, relatedAC: string[]): void {
  const now = new Date().toISOString();
  fs.outputFileSync(path.join(suiteDir, 'cases', `${caseId}.yaml`), yaml.dump({
    id: caseId,
    name: `用例 ${caseId}`,
    type: 'unit',
    status: 'draft',
    priority: 'medium',
    scenario: 'happy',
    suiteId: path.basename(suiteDir),
    relatedAC,
    preconditions: ['环境就绪'],
    steps: [{ step: 1, action: '执行', expected: '结果正确' }],
    tags: ['unit', 'happy'],
    createdAt: now,
    updatedAt: now,
  }, { noRefs: true }));
}

describe('prebuildSuites 骨架预建', () => {
  beforeEach(() => { root = buildMockSpecCore(); });
  afterEach(() => { fs.removeSync(root); });

  it('真实 AC 单元建骨架 + 矩阵，骨架单元报缺不脑补', () => {
    const r = prebuildSuites(root, ITERATION);
    expect(r.prepared).toHaveLength(2);
    expect(r.specGaps).toHaveLength(1);
    expect(r.specGaps[0].platform).toBe('admin-web');

    const p = r.prepared.find(x => x.unit === 'booking')!;
    expect(p.acCount).toBe(3);
    expect(p.suiteId).toBe('TS-h5-mobile-booking-unit');

    // 骨架落盘：SUITE.yaml + SCAFFOLD.md
    expect(fs.existsSync(path.join(p.suiteDir, 'SUITE.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(p.suiteDir, 'SCAFFOLD.md'))).toBe(true);

    // 矩阵 AC 事实落点
    const m = loadUnitMatrix(root, ITERATION, 'h5-mobile', p.unitSlug)!;
    expect(m.traces).toHaveLength(3);
    expect(m.traces.map(t => t.acId).sort()).toEqual(['AC-001', 'AC-002', 'AC-003']);
  });

  it('幂等重跑：testCaseIds 保留，版本锚稳定', () => {
    const r1 = prebuildSuites(root, ITERATION);
    const p1 = r1.prepared.find(x => x.unit === 'booking')!;
    writeCase(p1.suiteDir, 'TS-h5-mobile-booking-unit-AC-001', ['AC-001']);
    applyGeneratedCases(root, ITERATION);

    const r2 = prebuildSuites(root, ITERATION);
    const p2 = r2.prepared.find(x => x.unit === 'booking')!;
    expect(p2.existingCaseCount).toBe(1);
    expect(p2.acChanged).toBe(false);
  });

  it('AC 变化检测：修改 TEST.md 后版本锚判定变化', () => {
    prebuildSuites(root, ITERATION);
    const testMd = path.join(root, ITERATION, '020-specs', 'booking', 'h5-mobile', 'TEST.md');
    fs.appendFileSync(testMd, '\n- [ ] AC-4: 新增验收标准\n');

    const r = prebuildSuites(root, ITERATION);
    const p = r.prepared.find(x => x.unit === 'booking')!;
    expect(p.acCount).toBe(4);
    expect(p.acChanged).toBe(true);
  });
});

describe('applyGeneratedCases 回写', () => {
  beforeEach(() => { root = buildMockSpecCore(); });
  afterEach(() => { fs.removeSync(root); });

  it('校验通过 → 矩阵登记 → 索引重建', () => {
    const r = prebuildSuites(root, ITERATION);
    const p = r.prepared.find(x => x.unit === 'booking')!;
    writeCase(p.suiteDir, 'TS-h5-mobile-booking-unit-AC-001', ['AC-001']);

    const applied = applyGeneratedCases(root, ITERATION);
    expect(applied.errors).toHaveLength(0);
    expect(applied.applied).toHaveLength(1);

    const m = loadUnitMatrix(root, ITERATION, 'h5-mobile', p.unitSlug)!;
    expect(m.traces.find(t => t.acId === 'AC-001')!.caseIds).toContain('TS-h5-mobile-booking-unit-AC-001');
    expect(loadIndex(root, ITERATION)!.units.length).toBeGreaterThan(0);
  });

  it('结构非法用例 → 报错不登记', () => {
    const r = prebuildSuites(root, ITERATION);
    const p = r.prepared.find(x => x.unit === 'booking')!;
    // 缺 scenario 和 relatedAC 的坏用例
    fs.outputFileSync(path.join(p.suiteDir, 'cases', 'bad.yaml'), yaml.dump({
      id: 'bad-id-format',
      name: '坏用例',
      type: 'unit',
      status: 'draft',
      priority: 'urgent',
      suiteId: p.suiteId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { noRefs: true }));

    const applied = applyGeneratedCases(root, ITERATION);
    expect(applied.errors.length).toBeGreaterThan(0);
  });

  it('完成度门卫：AC 无用例证明 → uncoveredACs 清单', () => {
    const r = prebuildSuites(root, ITERATION);
    const p = r.prepared.find(x => x.unit === 'booking')!;
    // 只覆盖 1/3 AC
    writeCase(p.suiteDir, 'TS-h5-mobile-x-unit-AC-001', ['AC-001']);

    const applied = applyGeneratedCases(root, ITERATION);
    const uncovered = applied.uncoveredACs.find(u => u.suiteId === p.suiteId)!;
    expect(uncovered.acIds.sort()).toEqual(['AC-002', 'AC-003']);
  });

  it('全覆盖后完成度 100%：uncoveredACs 为空', () => {
    const r = prebuildSuites(root, ITERATION);
    const p = r.prepared.find(x => x.unit === 'booking')!;
    writeCase(p.suiteDir, 'TS-h5-mobile-booking-unit-AC-001', ['AC-001']);
    writeCase(p.suiteDir, 'TS-h5-mobile-booking-unit-AC-002', ['AC-002']);
    writeCase(p.suiteDir, 'TS-h5-mobile-booking-unit-AC-003', ['AC-003']);

    const applied = applyGeneratedCases(root, ITERATION);
    expect(applied.uncoveredACs.filter(u => u.suiteId.includes('booking'))).toHaveLength(0);
  });
});

describe('全量层增量复用（GLOBAL/cases）', () => {
  beforeEach(() => { root = buildMockSpecCore(); });
  afterEach(() => { fs.removeSync(root); });

  function buildCase(suiteDir: string, caseId: string): void {
    // caseId 形如 TS-{端}-{单元}-{类型}-AC-{编号} → relatedAC 锚定 AC-{编号}
    writeCase(suiteDir, caseId, [`AC-${caseId.split('-AC-').pop()}`]);
  }

  it('已有用例且 spec 未变 → reused=true，且 GLOBAL 资产不动', () => {
    const r1 = prebuildSuites(root, ITERATION);
    const p1 = r1.prepared.find(x => x.unit === 'booking')!;
    expect(p1.reused).toBe(false);
    buildCase(p1.suiteDir, 'TS-h5-mobile-booking-unit-AC-001');
    applyGeneratedCases(root, ITERATION);

    const suiteYaml = path.join(p1.suiteDir, 'SUITE.yaml');
    const mtimeBefore = fs.statSync(suiteYaml).mtimeMs;
    const contentBefore = fs.readFileSync(suiteYaml, 'utf-8');

    const r2 = prebuildSuites(root, ITERATION);
    const p2 = r2.prepared.find(x => x.unit === 'booking')!;
    expect(p2.reused).toBe(true);
    // 复用态：SUITE.yaml 不重写（引用不重建）
    expect(fs.statSync(suiteYaml).mtimeMs).toBe(mtimeBefore);
    expect(fs.readFileSync(suiteYaml, 'utf-8')).toBe(contentBefore);
  });

  it('spec 变更 → reused=false 且 acChanged=true（增量补充态）', () => {
    const r1 = prebuildSuites(root, ITERATION);
    const p1 = r1.prepared.find(x => x.unit === 'booking')!;
    buildCase(p1.suiteDir, 'TS-h5-mobile-booking-unit-AC-001');
    applyGeneratedCases(root, ITERATION);

    const testMd = path.join(root, ITERATION, '020-specs', 'booking', 'h5-mobile', 'TEST.md');
    fs.appendFileSync(testMd, '\n- [ ] AC-4: 新增验收标准\n');

    const r2 = prebuildSuites(root, ITERATION);
    const p2 = r2.prepared.find(x => x.unit === 'booking')!;
    expect(p2.acChanged).toBe(true);
    expect(p2.reused).toBe(false);
    expect(p2.existingCaseCount).toBe(1);
  });

  it('跨期次复用：Q2 同单元同 spec → 复用 Q1 已建用例', () => {
    const r1 = prebuildSuites(root, ITERATION);
    const p1 = r1.prepared.find(x => x.unit === 'booking')!;
    buildCase(p1.suiteDir, 'TS-h5-mobile-booking-unit-AC-001');
    applyGeneratedCases(root, ITERATION);

    // Q2：新期次目录，同单元同 TEST.md 内容
    const q2 = 'Iteration-010-test';
    const specsQ2 = path.join(root, q2, '020-specs', 'booking', 'h5-mobile');
    fs.ensureDirSync(specsQ2);
    fs.copySync(
      path.join(root, ITERATION, '020-specs', 'booking', 'h5-mobile', 'TEST.md'),
      path.join(specsQ2, 'TEST.md')
    );

    const r2 = prebuildSuites(root, q2);
    const p2 = r2.prepared.find(x => x.unit === 'booking')!;
    expect(p2.reused).toBe(true);
    expect(p2.acChanged).toBe(false);
    expect(p2.existingCaseCount).toBe(1);
    // 用例资产仍在 GLOBAL（唯一居住地）
    expect(fs.existsSync(path.join(p2.suiteDir, 'cases', 'TS-h5-mobile-booking-unit-AC-001.yaml'))).toBe(true);
  });

  it('旧数据迁移：迭代层 suites → GLOBAL/cases（幂等 move）', () => {
    // 手工造旧迭代层 suites（迁移前形态：.spectest/iterations/{期次}/{端}/{单元}/suites）
    const legacy = path.join(
      root, '.spectest', 'iterations', ITERATION, 'h5-mobile', 'booking', 'suites', 'TS-h5-mobile-booking-legacy'
    );
    fs.outputFileSync(path.join(legacy, 'SUITE.yaml'), 'id: TS-h5-mobile-booking-legacy\n');
    fs.outputFileSync(path.join(legacy, 'cases', 'old-case.yaml'), 'id: old-case\n');

    prebuildSuites(root, ITERATION);

    const moved = path.join(
      root, '.spectest', 'GLOBAL', 'cases', 'h5-mobile', 'booking', 'suites', 'TS-h5-mobile-booking-legacy'
    );
    expect(fs.existsSync(path.join(moved, 'SUITE.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(moved, 'cases', 'old-case.yaml'))).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
  });
});
