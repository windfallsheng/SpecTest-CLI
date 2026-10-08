import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import yaml from 'js-yaml';
import { UnitMatrix, loadAllMatrices, getUnitSuitesDir } from './trace-matrix.js';
import { scanSpecIndex } from './spec-reader.js';
import { TestSuiteSchema, type TestSuite } from './schemas/test-suite.schema.js';

/**
 * predicates.ts —— 共享谓词层（gap/impact/regress/gate 的唯一判定源）
 *
 * 铁律「判定收敛于矩阵」：所有分析命令禁止各自扫描用例文件做字符串匹配，
 * 一律调用本层谓词。矩阵（traces/cases）是唯一事实落点，SUITE.yaml 的
 * specSource 版本锚是 AC 变化检测的唯一依据。
 */

// ============================================================
// 覆盖谓词（gap 的唯一判定源）
// ============================================================

export interface CoverageFact {
  platform: string;
  unit: string;
  unitSlug: string;
  acId: string;
  acDesc: string;
  scenario: 'happy' | 'error' | 'edge' | 'boundary';
  /** 证明这条 AC 的用例（矩阵登记的事实） */
  caseIds: string[];
}

export interface CoverageQuery {
  covered: CoverageFact[];
  uncovered: CoverageFact[];
  /** 骨架缺口（spec 面无真实 AC，报缺不脑补） */
  specGaps: { platform: string; unit: string; reason: string }[];
}

export interface CoverageFilter {
  platform?: string;
  unit?: string;
  scenario?: CoverageFact['scenario'];
}

/**
 * 查询 AC 覆盖事实：矩阵 traces 中 caseIds 为空 = 未覆盖。
 * 不扫描用例文件、不做字符串匹配——矩阵就是答案。
 */
export function queryACCoverage(
  projectRoot: string,
  iteration: string,
  filter: CoverageFilter = {}
): CoverageQuery {
  const matrices = loadAllMatrices(projectRoot, iteration);

  const covered: CoverageFact[] = [];
  const uncovered: CoverageFact[] = [];

  for (const m of matrices) {
    if (filter.platform && m.platform !== filter.platform) continue;
    if (filter.unit && m.unitSlug !== filter.unit && m.unit !== filter.unit) continue;

    for (const trace of m.traces) {
      if (filter.scenario && trace.scenario !== filter.scenario) continue;
      const fact: CoverageFact = {
        platform: m.platform,
        unit: m.unit,
        unitSlug: m.unitSlug,
        acId: trace.acId,
        acDesc: trace.acDesc,
        scenario: trace.scenario,
        caseIds: trace.caseIds,
      };
      (trace.caseIds.length > 0 ? covered : uncovered).push(fact);
    }
  }

  // 骨架缺口：spec 面（非矩阵面）的 SPEC-SKELETON 单元
  const specGaps = querySpecGaps(projectRoot, iteration).filter(
    (g) => (!filter.platform || g.platform === filter.platform)
      && (!filter.unit || g.unit === filter.unit)
  );

  return { covered, uncovered, specGaps };
}

/** 骨架缺口：SpecCore analyze 未产出真实 AC 的单元 */
export function querySpecGaps(
  projectRoot: string,
  iteration: string
): { platform: string; unit: string; reason: string }[] {
  try {
    return scanSpecIndex(projectRoot, iteration).entries
      .filter((e) => e.isSkeleton)
      .map((e) => ({
        platform: e.platform,
        unit: e.unitSlug,
        reason: `SPEC-SKELETON 骨架占位（${e.testMdPath ?? 'TEST.md 缺失'}），请先完成 SpecCore analyze`,
      }));
  } catch {
    return [];
  }
}

// ============================================================
// AC 漂移谓词（impact 的判定源：双产物版本锚对比）
// ============================================================

export interface ACDrift {
  suiteId: string;
  platform: string;
  unit: string;
  unitSlug: string;
  /** 上次骨架登记的 AC 数 */
  prevAcCount: number;
  /** 当前 spec 的 AC 数 */
  currAcCount: number;
  /** 版本锚是否漂移（spec 内容 hash 变化） */
  hashChanged: boolean;
  specPath: string;
}

function sha256(content: string): string {
  return `sha256:${crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16)}`;
}

/** 扫描 SUITE.yaml，逐套件对比 specSource 版本锚 → AC 漂移清单 */
export function detectACDrift(projectRoot: string, iteration: string): ACDrift[] {
  const matrices = loadAllMatrices(projectRoot, iteration);
  const drift: ACDrift[] = [];

  for (const m of matrices) {
    const suitesDir = getUnitSuitesDir(projectRoot, m.platform, m.unitSlug, iteration);
    if (!fs.existsSync(suitesDir)) continue;

    for (const sd of fs.readdirSync(suitesDir, { withFileTypes: true })) {
      if (!sd.isDirectory()) continue;
      const suitePath = path.join(suitesDir, sd.name, 'SUITE.yaml');
      if (!fs.existsSync(suitePath)) continue;

      let suite: TestSuite | null = null;
      try {
        suite = TestSuiteSchema.parse(
          yaml.load(fs.readFileSync(suitePath, 'utf-8'), { schema: yaml.CORE_SCHEMA })
        );
      } catch {
        continue;
      }

      if (!suite.specSource || !fs.existsSync(suite.specSource.testPath)) continue;
      const currHash = sha256(fs.readFileSync(suite.specSource.testPath, 'utf-8'));
      if (suite.specSource.contentHash === currHash) continue;

      drift.push({
        suiteId: suite.id,
        platform: m.platform,
        unit: m.unit,
        unitSlug: m.unitSlug,
        prevAcCount: suite.specSource.acCount,
        currAcCount: countACs(suite.specSource.testPath),
        hashChanged: true,
        specPath: suite.specSource.testPath,
      });
    }
  }

  return drift;
}

/** 快速统计 spec 的 AC 条数（复用 extractAC 的匹配逻辑，轻量版） */
function countACs(testMdPath: string): number {
  const content = fs.readFileSync(testMdPath, 'utf-8');
  const lines = content.split('\n');
  let n = 0;
  const seen = new Set<string>();
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(/^[-*]\s+\[[ xX]\]\s*AC-(\d+)[：:]/i)
      ?? t.match(/^[-*]\s*\*\*AC-(\d+)\*\*[：:]/i)
      ?? t.match(/^AC-(\d+)[：:]/i);
    if (m && !seen.has(m[1])) { seen.add(m[1]); n++; }
  }
  return n;
}

// ============================================================
// 影响谓词（impact/regress 的判定源）
// ============================================================

export interface AffectedCase {
  caseId: string;
  suiteId: string;
  platform: string;
  unit: string;
  unitSlug: string;
  impact: 'need-update' | 'new-required';
  reason: string;
}

export interface ImpactQuery {
  /** AC 漂移波及的套件用例（need-update） */
  affected: AffectedCase[];
  /** 建议新增（未覆盖 AC + 骨架缺口） */
  newlyRequired: string[];
}

/**
 * 影响面查询：
 * - AC 漂移 → 该套件矩阵登记的全部用例 need-update（版本锚是唯一依据）
 * - 未覆盖 AC → new-required 建议
 */
export function queryImpact(
  projectRoot: string,
  iteration: string,
  filter: { platform?: string; unit?: string } = {}
): ImpactQuery {
  const drift = detectACDrift(projectRoot, iteration).filter(
    (d) => (!filter.platform || d.platform === filter.platform)
      && (!filter.unit || d.unitSlug === filter.unit || d.unit === filter.unit)
  );

  const matrices = loadAllMatrices(projectRoot, iteration);
  const affected: AffectedCase[] = [];

  for (const d of drift) {
    const m = matrices.find((x) => x.platform === d.platform && x.unitSlug === d.unitSlug);
    const caseEntries = m?.cases ?? [];
    if (caseEntries.length === 0) {
      // 套件无用例但 AC 漂移：整个套件需要生成（new-required）
      affected.push({
        caseId: d.suiteId,
        suiteId: d.suiteId,
        platform: d.platform,
        unit: d.unit,
        unitSlug: d.unitSlug,
        impact: 'new-required',
        reason: `Spec AC 已漂移（${d.prevAcCount}→${d.currAcCount} 条）且套件无用例，需重新生成`,
      });
      continue;
    }
    for (const c of caseEntries) {
      affected.push({
        caseId: c.caseId,
        suiteId: d.suiteId,
        platform: d.platform,
        unit: d.unit,
        unitSlug: d.unitSlug,
        impact: 'need-update',
        reason: `Spec AC 已漂移（${d.prevAcCount}→${d.currAcCount} 条），用例需复核更新`,
      });
    }
  }

  // 建议新增：未覆盖 AC（矩阵事实）
  const { uncovered } = queryACCoverage(projectRoot, iteration, filter);
  const newlyRequired = uncovered.map(
    (u) => `[${u.platform}/${u.unit}] ${u.acId} ${u.acDesc.slice(0, 40)}（${u.scenario}）`
  );
  for (const d of drift) {
    if (d.currAcCount > d.prevAcCount) {
      newlyRequired.push(
        `[${d.platform}/${d.unit}] Spec 新增 ${d.currAcCount - d.prevAcCount} 条 AC，请先 spectest gen 重建骨架再接力补用例`
      );
    }
  }
  for (const g of querySpecGaps(projectRoot, iteration)) {
    if (filter.platform && g.platform !== filter.platform) continue;
    newlyRequired.push(`[${g.platform}/${g.unit}] 规格骨架待分析，完成后需生成用例`);
  }

  return { affected, newlyRequired };
}

/** 受 Task 变更影响：API 契约面用例携带 taskId 标签（契约关联的唯一事实） */
export function queryAffectedByTask(
  projectRoot: string,
  iteration: string,
  taskId: string
): AffectedCase[] {
  const matrices = loadAllMatrices(projectRoot, iteration);
  const affected: AffectedCase[] = [];

  for (const m of matrices) {
    const suitesDir = getUnitSuitesDir(projectRoot, m.platform, m.unitSlug, iteration);
    if (!fs.existsSync(suitesDir)) continue;

    for (const sd of fs.readdirSync(suitesDir, { withFileTypes: true })) {
      if (!sd.isDirectory()) continue;
      const casesDir = path.join(suitesDir, sd.name, 'cases');
      if (!fs.existsSync(casesDir)) continue;

      for (const f of fs.readdirSync(casesDir)) {
        if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
        const content = fs.readFileSync(path.join(casesDir, f), 'utf-8');
        // 契约面用例 tags 携带 Task ID（生成器写入的事实），此处仅做标签匹配
        if (!content.includes(`'${taskId}'`) && !content.includes(`"${taskId}"`)) continue;
        const caseId = f.replace(/\.ya?ml$/, '');
        affected.push({
          caseId,
          suiteId: sd.name,
          platform: m.platform,
          unit: m.unit,
          unitSlug: m.unitSlug,
          impact: 'need-update',
          reason: `关联 Task ${taskId} 变更，契约用例需复核`,
        });
      }
    }
  }

  return affected;
}
