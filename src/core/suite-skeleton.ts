import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import yaml from 'js-yaml';
import { scanSpecIndex, buildSuiteId, findIterationDir, type ACItem } from './spec-reader.js';
import { resolveSuiteOwner } from './staffing.js';
import { ensureUnitMatrix, getIterationDir, getGlobalCasesRoot } from './trace-matrix.js';
import { TestSuiteSchema, type TestSuite } from './schemas/test-suite.schema.js';

/**
 * 骨架预建引擎 —— 铁律「CLI 管确定性，AI 管生成」
 *
 * 职责（全部确定性）：
 * 1. 扫 020-specs 的「功能单元 × 端」→ 端优先目录落骨架
 * 2. AC 事实登记矩阵（ensureUnitMatrix）
 * 3. SUITE.yaml 落盘（幂等覆盖 + specSource 双产物版本锚）
 * 4. 检测骨架缺口（SPEC-SKELETON 报缺不脑补）
 *
 * 不做的事：生成用例内容（AI 接力完成，apply 回写校验）。
 */

export type TestTypeName = 'unit' | 'integration' | 'e2e' | 'api' | 'performance' | 'security';

export interface SkeletonOptions {
  /** 端名过滤（标准端名） */
  platform?: string;
  /** 单元过滤（unitSlug 或中文单元名） */
  unit?: string;
  /** 测试类型，默认 unit */
  testType?: TestTypeName;
  /** 独立输入通道：自备规格目录（与 020-specs 同构），缺省走 SpecCore 迭代目录 */
  specDir?: string;
}

/** 预建好的一个套件骨架 */
export interface PreparedSuite {
  suiteId: string;
  platform: string;
  unit: string;
  unitSlug: string;
  testType: TestTypeName;
  /** AC 清单（接力 prompt 的输入） */
  acs: Pick<ACItem, 'id' | 'description' | 'scenario' | 'priority'>[];
  acCount: number;
  specPath: string;
  specHash: string;
  suiteDir: string;
  /** 相对上次骨架 AC 是否变化（版本锚对比） */
  acChanged: boolean;
  /** 套件负责人（源自 SpecCore 任务分配/STAFFING；未登记时 undefined） */
  owner?: string;
  /** 已有用例文件数（SUITE.yaml 登记数，apply 后回填） */
  existingCaseCount: number;
  /** 增量复用：用例已落盘且 spec 未变 → 不重建（gen 接力清单跳过） */
  reused: boolean;
}

export interface SkeletonResult {
  prepared: PreparedSuite[];
  /** 规格缺口：SPEC-SKELETON 单元（报缺不脑补） */
  specGaps: { platform: string; unit: string; reason: string }[];
}

export function getSuiteDir(
  projectRoot: string, _iteration: string, platform: string, unitSlug: string, suiteId: string
): string {
  // 全量层：用例资产落 GLOBAL/cases（期次目录只留 matrix 执行事实）
  return path.join(getGlobalCasesRoot(projectRoot), platform, unitSlug, 'suites', suiteId);
}

/**
 * 迁移：迭代层旧 suites → 全量层 GLOBAL/cases（幂等）
 * GLOBAL 无对应套件 → move；两边都有 → 旧目录备份 .legacy-*（以 GLOBAL 为准，不丢数据）。
 */
export function migrateLegacySuites(
  projectRoot: string, iteration: string
): { moved: string[]; backedUp: string[] } {
  const moved: string[] = [];
  const backedUp: string[] = [];
  const iterDir = getIterationDir(projectRoot, iteration);
  if (!fs.existsSync(iterDir)) return { moved, backedUp };

  for (const pd of fs.readdirSync(iterDir, { withFileTypes: true })) {
    if (!pd.isDirectory() || pd.name === 'matrix') continue;
    for (const ud of fs.readdirSync(path.join(iterDir, pd.name), { withFileTypes: true })) {
      if (!ud.isDirectory()) continue;
      const legacySuites = path.join(iterDir, pd.name, ud.name, 'suites');
      if (!fs.existsSync(legacySuites)) continue;
      const globalSuites = path.join(getGlobalCasesRoot(projectRoot), pd.name, ud.name, 'suites');
      if (!fs.existsSync(globalSuites)) {
        fs.ensureDirSync(path.dirname(globalSuites));
        fs.moveSync(legacySuites, globalSuites);
        moved.push(`${pd.name}/${ud.name}`);
      } else {
        fs.moveSync(legacySuites, `${legacySuites}.legacy-${Date.now()}`);
        backedUp.push(`${pd.name}/${ud.name}`);
      }
    }
  }
  return { moved, backedUp };
}

/** 读已有 SUITE.yaml（不存在或损坏返回 null，不抛） */
function readSuite(suiteDir: string): TestSuite | null {
  const p = path.join(suiteDir, 'SUITE.yaml');
  if (!fs.existsSync(p)) return null;
  try {
    return TestSuiteSchema.parse(yaml.load(fs.readFileSync(p, 'utf-8'), { schema: yaml.CORE_SCHEMA }));
  } catch {
    return null;
  }
}

function sha256(content: string): string {
  return `sha256:${crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16)}`;
}

/**
 * 骨架预建：扫 spec → 登记矩阵 → 落 SUITE.yaml + SCAFFOLD.md
 */
export function prebuildSuites(
  projectRoot: string, iteration: string, opts: SkeletonOptions = {}
): SkeletonResult {
  // 旧数据迁移：迭代层 suites → 全量层 GLOBAL/cases（幂等，一次性）
  const migrated = migrateLegacySuites(projectRoot, iteration);
  if (migrated.moved.length > 0) {
    console.log(`📦 用例库迁移至全量层 GLOBAL/cases：${migrated.moved.join('、')}`);
  }
  if (migrated.backedUp.length > 0) {
    console.log(`🗄️  双份套件已备份旧目录（.legacy-*）：${migrated.backedUp.join('、')}`);
  }

  const index = scanSpecIndex(projectRoot, iteration, opts.specDir);
  const prepared: PreparedSuite[] = [];
  const specGaps: SkeletonResult['specGaps'] = [];

  for (const e of index.entries) {
    if (opts.platform && e.platform !== opts.platform) continue;
    if (opts.unit && e.unitSlug !== opts.unit && e.unitName !== opts.unit) continue;

    // 骨架缺口：SpecCore 分析未产出真实 AC，报缺不脑补
    if (e.isSkeleton || !e.testMdPath) {
      specGaps.push({
        platform: e.platform,
        unit: e.unitSlug,
        reason: `SPEC-SKELETON 骨架占位（${e.testMdPath ?? 'TEST.md 缺失'}），请先完成 SpecCore analyze`,
      });
      continue;
    }

    const testType = opts.testType ?? 'unit';

    // 负责人：单一事实源在 SpecCore（030-tasks owner → STAFFING 方向映射），报缺不脑补
    const iterationDir = findIterationDir(projectRoot, iteration);
    const owner = iterationDir
      ? resolveSuiteOwner(iterationDir, e.unitSlug, e.unitName, e.platform)
      : undefined;

    const suiteId = buildSuiteId(e.platform, e.unitSlug, testType);
    const suiteDir = getSuiteDir(projectRoot, iteration, e.platform, e.unitSlug, suiteId);

    // 双产物版本锚：对比上次 specSource.contentHash
    const prevSuite = readSuite(suiteDir);
    const rawSpec = fs.readFileSync(e.testMdPath!, 'utf-8');
    const specHash = sha256(rawSpec);
    const acChanged = !!prevSuite?.specSource && prevSuite.specSource.contentHash !== specHash;

    // 增量复用判定：用例文件实际落盘（cases/*.yaml）且 spec 未变 → 全量层资产复用，不重建
    const casesDir = path.join(suiteDir, 'cases');
    const hasCaseFiles = fs.existsSync(casesDir)
      && fs.readdirSync(casesDir).some((f) => f.endsWith('.yaml'));
    const reused = !!prevSuite && !acChanged && hasCaseFiles;

    // 矩阵：AC 事实落点（幂等，重跑保留已登记 caseIds）
    ensureUnitMatrix(
      projectRoot, iteration, e.platform, e.unitName, e.unitSlug,
      e.acs.map(ac => ({ id: ac.id, description: ac.description, scenario: ac.scenario }))
    );

    // SUITE.yaml 骨架（幂等覆盖；testCaseIds 保留已有，apply 后由 apply 引擎更新）
    const now = new Date().toISOString();
    const suite: TestSuite = {
      id: suiteId,
      name: `${e.unitName} · ${e.platform} · ${testType} 测试套件`,
      description: `AC 锚定测试套件，spec-source: ${e.testMdPath}`,
      iteration,
      bornIteration: prevSuite?.bornIteration ?? iteration,
      platform: e.platform,
      unit: e.unitSlug,
      ...(owner ? { owner } : {}),
      testCaseIds: prevSuite?.testCaseIds ?? [],
      type: testType,
      tags: ['spec-anchored', e.unitSlug],
      passRate: prevSuite?.passRate ?? 0,
      specSource: { testPath: e.testMdPath!, contentHash: specHash, acCount: e.acs.length },
      createdAt: prevSuite?.createdAt ?? now,
      updatedAt: now,
    };
    // 复用态：全量层资产不动（引用不重建）；矩阵登记照做（迭代层事实）
    if (!reused) {
      fs.ensureDirSync(suiteDir);
      fs.writeFileSync(
        path.join(suiteDir, 'SUITE.yaml'),
        yaml.dump(TestSuiteSchema.parse(suite), { noRefs: true }), 'utf-8'
      );

      // SCAFFOLD.md：骨架元信息（供人类与续跑会话查阅；AC 详情接力时读 TEST.md）
      fs.writeFileSync(
        path.join(suiteDir, 'SCAFFOLD.md'),
        buildScaffoldMarkdown(suiteId, e.platform, e.unitName, e.unitSlug, testType, e.acs.length, e.testMdPath!, specHash),
        'utf-8'
      );
    }

    prepared.push({
      suiteId,
      platform: e.platform,
      unit: e.unitSlug,
      unitSlug: e.unitSlug,
      testType,
      acs: e.acs,
      acCount: e.acs.length,
      specPath: e.testMdPath!,
      specHash,
      suiteDir,
      acChanged,
      owner,
      existingCaseCount: prevSuite?.testCaseIds.length ?? 0,
      reused,
    });
  }

  return { prepared, specGaps };
}

function buildScaffoldMarkdown(
  suiteId: string, platform: string, unitName: string, unitSlug: string,
  testType: string, acCount: number, specPath: string, specHash: string
): string {
  return [
    `# 骨架 ${suiteId}`,
    '',
    `> CLI 预建骨架，用例内容由 AI 接力填充（apply 回写校验）。`,
    '',
    '| 项 | 值 |',
    '| :--- | :--- |',
    `| 套件 ID | \`${suiteId}\` |`,
    `| 端 | \`${platform}\` |`,
    `| 功能单元 | ${unitName}（\`${unitSlug}\`） |`,
    `| 类型 | \`${testType}\` |`,
    `| AC 数 | ${acCount} |`,
    `| Spec 源 | \`${specPath}\` |`,
    `| 版本锚 | \`${specHash}\` |`,
    '',
    '## 填充流程',
    '',
    '1. AI 接力：读取 Spec 源的 AC 清单，按端专属模板生成用例',
    '2. 用例落盘：`cases/{用例ID}.yaml`（ID 格式 `TS-{端}-{单元}-{类型}-AC-{编号}`）',
    `3. 回写校验：\`spectest gen -i <迭代> --apply\`（zod 校验 + 矩阵登记 + 索引重建）`,
    '',
  ].join('\n');
}
