import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext } from '../core/context.js';
import { runStaticVerify } from '../core/static-verify.js';

export interface VerifyOptions {
  iteration?: string;
  platform?: string;
  unit?: string;
}

/**
 * 文档静态验证（gate 第一道闸，零成本）
 *
 * 检查：AC 格式完整性 / AC 用例证明 / 用例四段齐全 / 端级专项 / 契约一致性。
 * error 级不通过 → exitCode 1（门禁回流）。
 */
export async function verifyCommand(options: VerifyOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称：spectest verify -i <期次>');
    process.exit(1);
  }

  const spinner = new Spinner('正在执行静态验证...');
  spinner.start();
  let result;
  try {
    result = runStaticVerify(projectRoot, iteration, {
      platform: options.platform,
      unit: options.unit,
    });
    spinner.stop('');
  } catch (error) {
    spinner.fail(`验证失败：${error}`);
    process.exit(1);
  }

  displayVerifyResult(result);

  if (!result.passed) {
    process.exitCode = 1;
  }
}

function displayVerifyResult(result: { checks: { name: string; level: string; passed: boolean; message: string; details: string[] }[]; errorCount: number; warningCount: number }): void {
  console.log('');
  console.log('┌──────────────────────────────────────────────┐');
  console.log('│          📋 静态验证结果                     │');
  console.log('├──────────────────────────────────────────────┤');

  for (const check of result.checks) {
    const icon = check.passed ? '✅' : check.level === 'error' ? '❌' : '⚠️';
    console.log(`│  ${icon} ${check.name.padEnd(12)} │ ${check.message.padEnd(24)} │`);
  }

  console.log('├──────────────────────────────────────────────┤');
  const verdict = result.errorCount === 0
    ? '✅ 静态验证通过'
    : `❌ 静态验证未通过（${result.errorCount} 个 error${result.warningCount > 0 ? `，${result.warningCount} 个 warning` : ''}）`;
  console.log(`│  ${verdict.padEnd(40)} │`);
  console.log('└──────────────────────────────────────────────┘');

  for (const check of result.checks) {
    if (check.passed || check.details.length === 0) continue;
    console.log('');
    const title = check.level === 'error' ? '❌ 阻塞项' : '⚠️ 提示项';
    console.log(`${title} ${check.name}：`);
    for (const d of check.details.slice(0, 10)) {
      console.log(`  - ${d}`);
    }
    if (check.details.length > 10) {
      console.log(`  ... 共 ${check.details.length} 项`);
    }
  }
  console.log('');
}
