import path from 'path';
import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext, updateContext } from '../core/context.js';
import { prebuildSuites, type TestTypeName, type SkeletonOptions } from '../core/suite-skeleton.js';
import { buildGenRelayPrompt } from '../core/relay-prompt.js';
import { applyGeneratedCases } from '../core/suite-apply.js';

export interface GenOptions {
  iteration?: string;
  platform?: string;
  unit?: string;
  type?: TestTypeName;
  /** AI 接力后的回写模式 */
  apply?: boolean;
}

/**
 * 生成测试用例（骨架预建 + AI 接力）
 *
 * 模式一（默认）：CLI 预建骨架（矩阵登记 + SUITE.yaml + 端专属模板指令）
 *                → 输出 [SPECTEST_PROMPT] → exitCode 10（宿主 AI 接力生成用例）
 * 模式二（--apply）：AI 生成用例后回写（zod 校验 → 矩阵登记 → 索引重建 → 完成度门卫）
 */
export async function genCommand(options: GenOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称：spectest gen -i <期次>');
    process.exit(1);
  }

  // ── 模式二：apply 回写 ──
  if (options.apply) {
    const spinner = new Spinner('正在校验并回写用例...');
    spinner.start();
    try {
      const result = applyGeneratedCases(projectRoot, iteration, {
        platform: options.platform,
        unit: options.unit,
        testType: options.type,
      });
      spinner.stop('');
      displayApplyResult(projectRoot, iteration, result);
      return;
    } catch (error) {
      spinner.fail(`回写失败：${error}`);
      process.exit(1);
    }
  }

  // ── 模式一：骨架预建 + AI 接力 ──
  const spinner = new Spinner('正在扫描 Spec 并预建骨架...');
  spinner.start();

  let result;
  try {
    const opts: SkeletonOptions = { platform: options.platform, unit: options.unit, testType: options.type };
    result = prebuildSuites(projectRoot, iteration, opts);
    spinner.stop('');
  } catch (error) {
    spinner.fail(`骨架预建失败：${error}`);
    process.exit(1);
  }

  // ── 增量拆分：已有用例且 spec 未变的套件复用（全量层资产），不进接力清单 ──
  const toRelay = result.prepared.filter((p) => !p.reused);
  const reusedSuites = result.prepared.filter((p) => p.reused);

  // 概要报告
  displayPrebuildSummary(toRelay.length, reusedSuites.length, result.specGaps.length);
  for (const p of toRelay) {
    logger.info(`  ${p.suiteId}（AC×${p.acCount}${p.acChanged ? '，AC 已变化，增量补充' : '，新套件'}）`);
  }
  for (const p of reusedSuites) {
    logger.info(`  ${p.suiteId}（AC×${p.acCount}，已有用例×${p.existingCaseCount}，复用不重建）`);
  }

  if (result.prepared.length === 0) {
    if (result.specGaps.length > 0) {
      logger.warn('所有单元均为 SPEC-SKELETON 骨架：请先完成 SpecCore analyze，再回来生成用例');
      process.exit(1);
    }
    logger.warn('没有匹配的单元可生成');
    process.exit(1);
  }

  // 更新上下文
  updateContext({ currentIteration: iteration, lastAction: `gen:${iteration}` });

  // 全部复用：用例资产已在全量层，无需 AI 接力（增量终态）
  if (toRelay.length === 0) {
    logger.success(`✅ 全量层用例已存在：${reusedSuites.length} 个套件全部复用，无需重新生成`);
    logger.info('   如需覆盖现有用例（spec 未变），可手动删除 GLOBAL/cases 下对应套件后重跑');
    return;
  }

  // AI 接力：输出 prompt + exitCode 10（仅待接力套件）
  const prompt = buildGenRelayPrompt(projectRoot, iteration, { ...result, prepared: toRelay });
  process.stdout.write(prompt + '\n');
  process.exitCode = 10;
}

function displayPrebuildSummary(prepared: number, reused: number, gaps: number): void {
  console.log('');
  console.log('┌──────────────────────────────────────────┐');
  console.log('│        骨架预建完成                     │');
  console.log('├──────────────────────────────────────────┤');
  console.log(`│  待接力套件│  ${String(prepared).padEnd(22)} │`);
  console.log(`│  复用套件  │  ${String(reused).padEnd(22)} │`);
  console.log(`│  规格缺口  │  ${String(gaps).padEnd(22)} │`);
  console.log('└──────────────────────────────────────────┘');
  console.log('');
}

function truncate(msg: string, max: number): string {
  const one = msg.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '...' : one;
}

function displayApplyResult(projectRoot: string, iteration: string, result: {
  applied: { suiteId: string; caseCount: number }[];
  errors: { suiteId: string; file: string; message: string }[];
  uncoveredACs: { suiteId: string; acIds: string[] }[];
}): void {
  console.log('');
  console.log('┌──────────────────────────────────────────┐');
  console.log('│        ✅ 回写完成                       │');
  console.log('├──────────────────────────────────────────┤');
  console.log(`│  登记套件  │  ${String(result.applied.length).padEnd(22)} │`);
  console.log(`│  用例总数  │  ${String(result.applied.reduce((s, a) => s + a.caseCount, 0)).padEnd(22)} │`);
  console.log(`│  结构错误  │  ${String(result.errors.length).padEnd(22)} │`);
  console.log('└──────────────────────────────────────────┘');
  console.log('');

  if (result.errors.length > 0) {
    logger.error('以下用例结构校验失败（请修正后重新 --apply）：');
    for (const e of result.errors) {
      logger.error(`  ${e.suiteId}/${e.file}: ${truncate(e.message, 220)}`);
    }
    console.log('');
    process.exit(1);
  }

  if (result.uncoveredACs.length > 0) {
    logger.warn('⚠️ 骨架完成度门卫：以下 AC 仍无用例证明');
    for (const u of result.uncoveredACs) {
      logger.warn(`  ${u.suiteId}: ${u.acIds.join(', ')}`);
    }
    console.log('');
    logger.info('🤖 Host AI Handoff: 请为上述 AC 补齐用例后重新执行：');
    logger.info(`   spectest gen -i ${iteration} --apply`);
    console.log('');
    process.exitCode = 10;
    return;
  }

  logger.success('✅ 骨架完成度 100%：所有 AC 均有用例证明，矩阵与索引已更新');
  updateContext({ lastAction: `apply:${iteration}` });
}
