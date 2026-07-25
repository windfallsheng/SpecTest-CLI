import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext } from '../core/context.js';
import { analyzeImpact, saveImpactReport, ImpactResult } from '../core/test-regress.js';

export interface ImpactOptions {
  iteration?: string;
  task?: string;
}

/**
 * 变更影响分析
 * 当 spec-core 需求变更时，分析哪些测试需要更新、哪些需要新增
 */
export async function impactCommand(options: ImpactOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest impact --iteration Q1');
    process.exit(1);
  }

  const spinner = new Spinner('正在分析变更影响...');
  spinner.start();

  try {
    const result = analyzeImpact({
      projectRoot,
      iteration,
      changedTaskId: options.task,
    });

    spinner.stop('');

    // 显示结果
    displayImpactResult(result);

    // 保存报告
    if (result.affectedTestCases.length > 0) {
      const reportPath = saveImpactReport(projectRoot, result);
      console.log(`\n📄 详细报告：${reportPath}`);
    }
  } catch (error) {
    spinner.fail(`分析失败：${error}`);
    throw error;
  }
}

function displayImpactResult(result: ImpactResult): void {
  console.log('');
  console.log('┌──────────────────────────────────────────┐');
  console.log('│       🔍 变更影响分析结果               │');
  console.log('├──────────────────────────────────────────┤');
  console.log(`│  变更 Task  │  ${result.changedTaskId.padEnd(20)} │`);
  console.log(`│  影响用例   │  ${String(result.affectedTestCases.length).padEnd(20)} │`);
  console.log(`│  建议新增   │  ${String(result.newlyRequiredTests.length).padEnd(20)} │`);
  console.log('└──────────────────────────────────────────┘');

  if (result.affectedTestCases.length > 0) {
    console.log('');
    console.log('📋 需要更新的测试用例：');
    for (const tc of result.affectedTestCases) {
      const emoji = tc.impact === 'need-update' ? '🔴' : '🟡';
      console.log(`  ${emoji} ${tc.caseId}: ${tc.caseName}`);
    }
  }
}
