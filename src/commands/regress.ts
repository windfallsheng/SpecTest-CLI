import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext } from '../core/context.js';
import { runRegress, RegressResult } from '../core/test-regress.js';

export interface RegressOptions {
  iteration?: string;
  task?: string;
  suite?: string;
}

/**
 * 回归测试
 * 需求变更后自动跑受影响的测试用例
 */
export async function regressCommand(options: RegressOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest regress --iteration Q1');
    process.exit(1);
  }

  const spinner = new Spinner('正在执行回归测试...');
  spinner.start();

  try {
    spinner.update('正在分析变更影响...');
    const result = runRegress({
      projectRoot,
      iteration,
      changedTaskId: options.task,
      suiteId: options.suite,
    });

    spinner.stop('');

    // 显示结果
    displayRegressResult(result);
  } catch (error) {
    spinner.fail(`回归测试失败：${error}`);
    throw error;
  }
}

function displayRegressResult(result: RegressResult): void {
  console.log('');
  console.log('┌──────────────────────────────────────────┐');
  console.log('│       🔄 回归测试结果                   │');
  console.log('├──────────────────────────────────────────┤');
  console.log(`│  受影响的用例 │  ${String(result.totalAffected).padEnd(18)} │`);
  console.log(`│  已执行       │  ${String(result.executed).padEnd(18)} │`);
  console.log(`│  ✅ 通过      │  ${String(result.passed).padEnd(18)} │`);
  if (result.failed > 0) {
    console.log(`│  ❌ 失败      │  ${String(result.failed).padEnd(18)} │`);
  }
  const rate = result.executed > 0 ? Math.round((result.passed / result.executed) * 100) : 100;
  console.log(`│  通过率       │  ${String(rate).padEnd(17)}% │`);
  console.log('└──────────────────────────────────────────┘');

  if (result.changes.length > 0) {
    console.log('');
    console.log('📝 关联变更：');
    for (const c of result.changes.slice(0, 3)) {
      console.log(`  - ${c}`);
    }
  }

  console.log('');
}
