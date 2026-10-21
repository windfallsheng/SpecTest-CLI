import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { TestCaseSchema, TestSuiteSchema, type TestCase, type TestSuite } from './schemas/index.js';
import { scanSpecIndex } from './spec-reader.js';
import { ensureUnitMatrix, registerCase, loadUnitMatrix, rebuildIndex, getIterationDir, getGlobalCasesRoot } from './trace-matrix.js';

/**
 * apply 回写引擎 —— 铁律「CLI 管确定性」
 *
 * AI 接力生成用例 YAML 后，由 CLI 完成确定性回写：
 * 1. zod 校验每个用例（结构错误直接报错，不脑补）
 * 2. 矩阵双向登记（registerCase）
 * 3. SUITE.yaml testCaseIds 更新
 * 4. 总索引重建（rebuildIndex）
 * 5. 骨架完成度门卫：空 AC 清单（供接力补齐）
 */

export interface ApplyOptions {
  platform?: string;
  unit?: string;
  testType?: string;
  /** 独立输入通道：与 gen 模式一相同的自备规格目录 */
  specDir?: string;
}

export interface ApplyResult {
  applied: { suiteId: string; caseCount: number; platform: string; unit: string }[];
  errors: { suiteId: string; file: string; message: string }[];
  /** 骨架完成度门卫：仍无用例证明的 AC */
  uncoveredACs: { suiteId: string; platform: string; unit: string; acIds: string[] }[];
}

export function applyGeneratedCases(
  projectRoot: string, iteration: string, opts: ApplyOptions = {}
): ApplyResult {
  const result: ApplyResult = { applied: [], errors: [], uncoveredACs: [] };
  const iterDir = getIterationDir(projectRoot, iteration);
  if (!fs.existsSync(iterDir)) {
    throw new Error(`.spectest/iterations/${iteration} 不存在，请先 spectest gen 预建骨架`);
  }

  // 1. 遍历 {端}/{单元}/suites/TS-*/SUITE.yaml
  const suites = scanSuiteDirs(projectRoot, opts);
  if (suites.length === 0) {
    throw new Error('没有找到套件目录，请先 spectest gen 预建骨架');
  }

  // spec 索引（用于矩阵兜底重建与 unitName 解析）
  const specIndex = scanSpecIndex(projectRoot, iteration, opts.specDir);

  for (const s of suites) {
    const suite = readSuite(s.dir);
    if (!suite) {
      result.errors.push({ suiteId: path.basename(s.dir), file: 'SUITE.yaml', message: 'SUITE.yaml 损坏或格式非法' });
      continue;
    }

    // 矩阵兜底：prebuild 未跑过时从 spec 重建
    const specEntry = specIndex.entries.find(e => e.platform === s.platform && e.unitSlug === s.unit);
    if (!specEntry) {
      result.errors.push({ suiteId: suite.id, file: 'matrix', message: `spec 索引中找不到 ${s.platform}/${s.unit}` });
      continue;
    }
    ensureUnitMatrix(
      projectRoot, iteration, s.platform, specEntry.unitName, s.unit,
      specEntry.acs.map(ac => ({ id: ac.id, description: ac.description, scenario: ac.scenario }))
    );

    // 2. 读 cases/*.yaml → zod 校验 → 矩阵登记
    const casesDir = path.join(s.dir, 'cases');
    const caseIds: string[] = [];
    if (fs.existsSync(casesDir)) {
      for (const f of fs.readdirSync(casesDir)) {
        if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
        const filePath = path.join(casesDir, f);
        try {
          const raw = yaml.load(fs.readFileSync(filePath, 'utf-8'), { schema: yaml.CORE_SCHEMA });
          const tc = TestCaseSchema.parse(raw) as TestCase;
          registerCase(projectRoot, iteration, s.platform, s.unit, tc.id, tc.relatedAC, tc.priority);
          caseIds.push(tc.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result.errors.push({ suiteId: suite.id, file: f, message });
        }
      }
    }

    // 3. SUITE.yaml testCaseIds 更新（幂等去重）
    suite.testCaseIds = [...new Set(caseIds)];
    suite.updatedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(s.dir, 'SUITE.yaml'),
      yaml.dump(TestSuiteSchema.parse(suite), { noRefs: true }), 'utf-8'
    );

    if (caseIds.length > 0) {
      result.applied.push({ suiteId: suite.id, caseCount: caseIds.length, platform: s.platform, unit: s.unit });
    }

    // 4. 骨架完成度门卫：矩阵中仍无用例证明的 AC
    const matrix = loadUnitMatrix(projectRoot, iteration, s.platform, s.unit);
    const uncovered = (matrix?.traces ?? []).filter(t => t.caseIds.length === 0).map(t => t.acId);
    if (uncovered.length > 0) {
      result.uncoveredACs.push({ suiteId: suite.id, platform: s.platform, unit: s.unit, acIds: uncovered });
    }
  }

  // 5. 总索引重建（幂等）
  try {
    rebuildIndex(projectRoot, iteration);
  } catch (err) {
    result.errors.push({ suiteId: '-', file: 'matrix/index.yaml', message: String(err) });
  }

  return result;
}

interface SuiteRef {
  dir: string;
  platform: string;
  unit: string;
}

function scanSuiteDirs(projectRoot: string, opts: ApplyOptions): SuiteRef[] {
  const suites: SuiteRef[] = [];
  // 全量层：套件扫描自 GLOBAL/cases（用例资产项目级唯一）
  const casesRoot = getGlobalCasesRoot(projectRoot);
  if (!fs.existsSync(casesRoot)) return suites;
  const platforms = fs.readdirSync(casesRoot, { withFileTypes: true })
    .filter(e => e.isDirectory());

  for (const pd of platforms) {
    if (opts.platform && pd.name !== opts.platform) continue;
    const unitDirs = fs.readdirSync(path.join(casesRoot, pd.name), { withFileTypes: true })
      .filter(e => e.isDirectory());
    for (const ud of unitDirs) {
      if (opts.unit && ud.name !== opts.unit) continue;
      const suitesRoot = path.join(casesRoot, pd.name, ud.name, 'suites');
      if (!fs.existsSync(suitesRoot)) continue;
      const suiteDirs = fs.readdirSync(suitesRoot, { withFileTypes: true })
        .filter(e => e.isDirectory());
      for (const sd of suiteDirs) {
        if (opts.testType && !sd.name.endsWith(`-${opts.testType}`)) continue;
        suites.push({ dir: path.join(suitesRoot, sd.name), platform: pd.name, unit: ud.name });
      }
    }
  }
  return suites;
}

function readSuite(suiteDir: string): TestSuite | null {
  const p = path.join(suiteDir, 'SUITE.yaml');
  if (!fs.existsSync(p)) return null;
  try {
    return TestSuiteSchema.parse(yaml.load(fs.readFileSync(p, 'utf-8'), { schema: yaml.CORE_SCHEMA }));
  } catch {
    return null;
  }
}
