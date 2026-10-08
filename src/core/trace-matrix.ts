import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { z } from 'zod';

/**
 * AC↔用例双向追溯矩阵 —— SpecTest 的灵魂
 *
 * 事实落点：.spectest/iterations/{期次}/{端名}/{功能单元}/matrix/trace.yaml
 * 总索引：  .spectest/iterations/{期次}/matrix/index.yaml（CLI 幂等重建，禁止手写）
 *
 * gap/impact/regress/gate 全部是矩阵上的查询，判定逻辑收敛于 predicates.ts。
 */

// ============================================================
// Schema
// ============================================================

export const TraceEntrySchema = z.object({
  acId: z.string().regex(/^AC-\d{3}$/),
  acDesc: z.string(),
  scenario: z.enum(['happy', 'error', 'edge', 'boundary']),
  /** 谁在证明这条 AC */
  caseIds: z.array(z.string()).default([]),
});

export const CaseEntrySchema = z.object({
  caseId: z.string().min(1),
  /** 为谁作证 */
  acIds: z.array(z.string()).default([]),
  /** 用例优先级（apply 回填，P0 门禁的唯一判定源；旧矩阵无此字段为 undefined） */
  priority: z.enum(['high', 'medium', 'low']).optional(),
  status: z.enum(['draft', 'ready', 'passed', 'failed', 'skipped', 'blocked']).default('draft'),
  lastRun: z.string().nullable().default(null),
  lastResult: z.string().nullable().default(null),
});

export const UnitMatrixSchema = z.object({
  unit: z.string(),
  unitSlug: z.string(),
  platform: z.string(),
  updatedAt: z.string(),
  traces: z.array(TraceEntrySchema).default([]),
  cases: z.array(CaseEntrySchema).default([]),
});

export const MatrixIndexSchema = z.object({
  iteration: z.string(),
  generatedAt: z.string(),
  /** 平铺的单元矩阵元信息 */
  units: z.array(z.object({
    platform: z.string(),
    unit: z.string(),
    unitSlug: z.string(),
    tracePath: z.string(),
  })).default([]),
});

export type TraceEntry = z.infer<typeof TraceEntrySchema>;
export type CaseEntry = z.infer<typeof CaseEntrySchema>;
export type UnitMatrix = z.infer<typeof UnitMatrixSchema>;
export type MatrixIndex = z.infer<typeof MatrixIndexSchema>;

// ============================================================
// 路径
// ============================================================

export function getIterationDir(projectRoot: string, iteration: string): string {
  return path.join(projectRoot, '.spectest', 'iterations', iteration);
}

export function getUnitMatrixPath(
  projectRoot: string, iteration: string, platform: string, unitSlug: string
): string {
  return path.join(getIterationDir(projectRoot, iteration), platform, unitSlug, 'matrix', 'trace.yaml');
}

export function getIndexPath(projectRoot: string, iteration: string): string {
  return path.join(getIterationDir(projectRoot, iteration), 'matrix', 'index.yaml');
}

/** 全量层：项目级用例库根目录（用例资产唯一居住地，跨期次复用） */
export function getGlobalCasesRoot(projectRoot: string): string {
  return path.join(projectRoot, '.spectest', 'GLOBAL', 'cases');
}

/**
 * 单元套件目录（全量层 GLOBAL/cases 优先）
 * 读路径回退旧迭代层 suites（迁移兼容）；写路径永远落全量层。
 */
export function getUnitSuitesDir(
  projectRoot: string, platform: string, unitSlug: string, iteration?: string
): string {
  const globalDir = path.join(getGlobalCasesRoot(projectRoot), platform, unitSlug, 'suites');
  if (iteration) {
    const legacyDir = path.join(getIterationDir(projectRoot, iteration), platform, unitSlug, 'suites');
    if (!fs.existsSync(globalDir) && fs.existsSync(legacyDir)) return legacyDir;
  }
  return globalDir;
}

// ============================================================
// 事实落点：读写单元矩阵
// ============================================================

export function loadUnitMatrix(
  projectRoot: string, iteration: string, platform: string, unitSlug: string
): UnitMatrix | null {
  const p = getUnitMatrixPath(projectRoot, iteration, platform, unitSlug);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    return UnitMatrixSchema.parse(yaml.load(raw, { schema: yaml.CORE_SCHEMA }));
  } catch {
    return null;
  }
}

export function saveUnitMatrix(
  projectRoot: string, iteration: string, matrix: UnitMatrix
): void {
  const p = getUnitMatrixPath(projectRoot, iteration, matrix.platform, matrix.unitSlug);
  fs.ensureDirSync(path.dirname(p));
  matrix.updatedAt = new Date().toISOString();
  const dumped = yaml.dump(UnitMatrixSchema.parse(matrix), { noRefs: true });
  fs.writeFileSync(p, dumped, 'utf-8');
}

/** 幂等建矩阵：重跑覆盖，AC 条目以传入为准、caseIds 保留已有登记 */
export function ensureUnitMatrix(
  projectRoot: string, iteration: string,
  platform: string, unitName: string, unitSlug: string,
  acs: { id: string; description: string; scenario: TraceEntry['scenario'] }[]
): UnitMatrix {
  const existing = loadUnitMatrix(projectRoot, iteration, platform, unitSlug);

  const traces = acs.map((ac) => {
    const prev = existing?.traces.find((t) => t.acId === ac.id);
    return {
      acId: ac.id,
      acDesc: ac.description,
      scenario: ac.scenario,
      caseIds: prev?.caseIds ?? [],
    };
  });

  const matrix: UnitMatrix = {
    unit: unitName,
    unitSlug,
    platform,
    updatedAt: new Date().toISOString(),
    traces,
    cases: existing?.cases ?? [],
  };

  saveUnitMatrix(projectRoot, iteration, matrix);
  return matrix;
}

/** 登记"用例 ↔ AC"双向关联（幂等） */
export function registerCase(
  projectRoot: string, iteration: string, platform: string, unitSlug: string,
  caseId: string, acIds: string[], priority?: CaseEntry['priority']
): void {
  const matrix = loadUnitMatrix(projectRoot, iteration, platform, unitSlug);
  if (!matrix) throw new Error(`矩阵不存在：${platform}/${unitSlug}，请先 ensureUnitMatrix`);

  // 更新 AC → cases
  for (const trace of matrix.traces) {
    if (acIds.includes(trace.acId) && !trace.caseIds.includes(caseId)) {
      trace.caseIds.push(caseId);
    }
  }

  // 更新 case → ACs
  const idx = matrix.cases.findIndex((c) => c.caseId === caseId);
  if (idx >= 0) {
    // 幂等回填：acIds 合并，priority 缺失时补登记（旧矩阵升级路径）
    matrix.cases[idx] = {
      ...matrix.cases[idx],
      acIds: [...new Set([...matrix.cases[idx].acIds, ...acIds])],
      priority: matrix.cases[idx].priority ?? priority,
    };
  } else {
    matrix.cases.push({ caseId, acIds, status: 'draft', lastRun: null, lastResult: null, priority });
  }

  saveUnitMatrix(projectRoot, iteration, matrix);
}

/** 执行结果回填（gate 的通过率事实来源） */
export function updateCaseResult(
  projectRoot: string, iteration: string, platform: string, unitSlug: string,
  caseId: string, status: CaseEntry['status'], result?: string
): void {
  const matrix = loadUnitMatrix(projectRoot, iteration, platform, unitSlug);
  if (!matrix) return;

  const entry = matrix.cases.find((c) => c.caseId === caseId);
  if (!entry) {
    // 执行回填补登记：从 caseId 解析 AC 锚点，同步回填 traces.caseIds。
    // 若只补 cases 不回填 traces，会出现「cases 有、traces 无」的事实不一致，
    // 覆盖判定（traces.caseIds 事实）将失真——覆盖必须随执行事实同步收敛。
    const acMatch = caseId.match(/AC-\d{3}/);
    const acIds: string[] = [];
    if (acMatch) {
      for (const t of matrix.traces) {
        if (t.acId === acMatch[0] && !t.caseIds.includes(caseId)) {
          t.caseIds.push(caseId);
          acIds.push(t.acId);
        }
      }
    }
    matrix.cases.push({
      caseId, acIds, status,
      lastRun: new Date().toISOString(), lastResult: result ?? null,
    });
  } else {
    entry.status = status;
    entry.lastRun = new Date().toISOString();
    entry.lastResult = result ?? null;
  }
  saveUnitMatrix(projectRoot, iteration, matrix);
}

// ============================================================
// 总索引：CLI 幂等重建（禁止手写）
// ============================================================

export function rebuildIndex(projectRoot: string, iteration: string): MatrixIndex {
  const iterDir = getIterationDir(projectRoot, iteration);
  if (!fs.existsSync(iterDir)) {
    throw new Error(`.spectest/iterations/${iteration} 不存在，请先 init 或生成用例`);
  }

  const units: MatrixIndex['units'] = [];
  const platformDirs = fs.readdirSync(iterDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'matrix');

  for (const pd of platformDirs) {
    const unitDirs = fs.readdirSync(path.join(iterDir, pd.name), { withFileTypes: true })
      .filter((e) => e.isDirectory());
    for (const ud of unitDirs) {
      const tracePath = getUnitMatrixPath(projectRoot, iteration, pd.name, ud.name);
      if (!fs.existsSync(tracePath)) continue;
      const m = loadUnitMatrix(projectRoot, iteration, pd.name, ud.name);
      if (!m) continue;
      units.push({ platform: pd.name, unit: m.unit, unitSlug: m.unitSlug, tracePath });
    }
  }

  const index: MatrixIndex = {
    iteration,
    generatedAt: new Date().toISOString(),
    units,
  };

  const indexPath = getIndexPath(projectRoot, iteration);
  fs.ensureDirSync(path.dirname(indexPath));
  fs.writeFileSync(indexPath, yaml.dump(MatrixIndexSchema.parse(index), { noRefs: true }), 'utf-8');
  return index;
}

export function loadIndex(projectRoot: string, iteration: string): MatrixIndex | null {
  const p = getIndexPath(projectRoot, iteration);
  if (!fs.existsSync(p)) return null;
  try {
    return MatrixIndexSchema.parse(yaml.load(fs.readFileSync(p, 'utf-8'), { schema: yaml.CORE_SCHEMA }));
  } catch {
    return null;
  }
}

/** 读取全量矩阵，供 predicates 查询
 *
 * 直接扫描「端/单元」目录（目录是唯一事实源），不依赖索引——
 * 索引是给人看的 TOC，可能滞后；查询必须恒见最新事实。
 */
export function loadAllMatrices(projectRoot: string, iteration: string): UnitMatrix[] {
  const iterDir = getIterationDir(projectRoot, iteration);
  if (!fs.existsSync(iterDir)) return [];
  const matrices: UnitMatrix[] = [];
  for (const pd of fs.readdirSync(iterDir, { withFileTypes: true })) {
    if (!pd.isDirectory() || pd.name === 'matrix') continue;
    for (const ud of fs.readdirSync(path.join(iterDir, pd.name), { withFileTypes: true })) {
      if (!ud.isDirectory()) continue;
      const m = loadUnitMatrix(projectRoot, iteration, pd.name, ud.name);
      if (m) matrices.push(m);
    }
  }
  return matrices;
}
