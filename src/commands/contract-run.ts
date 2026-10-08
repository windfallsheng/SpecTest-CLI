import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext } from '../core/context.js';
import { runContractMatrix } from '../core/contract-runner.js';

export interface ContractRunOptions {
  iteration?: string;
  /** 环境名（逗号分隔 = 环境矩阵，如 sit,uat 跨环境对比回归） */
  env?: string;
  platform?: string;
  suite?: string;
  /** 优先级过滤（high = P0，与 gate 的 P0 定义一致） */
  priority?: 'high' | 'medium' | 'low';
  /** 用例级过滤（幂等 caseId，逗号分隔） */
  case?: string;
  /** 失败重试次数（默认 0） */
  retry?: string;
}

/**
 * 契约执行（内置，真能自己跑）
 *
 * 从契约用例的 testData 组装真实 HTTP 请求 → 状态码断言 → 矩阵回填。
 * 边界哲学：执行力止于契约面——测的是「接口是否符合契约」。
 */
export async function contractRunCommand(options: ContractRunOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;
  // 环境矩阵：逗号分隔多环境（如 --env sit,uat），缺省单环境 test
  const envs = (options.env || 'test').split(',').map((e) => e.trim()).filter(Boolean);
  const caseIds = options.case?.split(',').map((c) => c.trim()).filter(Boolean);
  const retry = options.retry !== undefined ? Math.max(0, parseInt(options.retry, 10) || 0) : 0;

  if (!iteration) {
    logger.error('请指定期次名称：spectest contract-run -i <期次> --env test');
    process.exit(1);
  }

  const spinner = new Spinner(`正在执行契约测试（环境：${envs.join('、')}）...`);
  spinner.start();
  let entries;
  try {
    entries = await runContractMatrix({
      projectRoot,
      iteration,
      envs,
      platform: options.platform,
      suiteId: options.suite,
      priority: options.priority,
      caseIds,
      retry,
    });
    spinner.stop('');
  } catch (error) {
    spinner.fail(`契约执行失败：${error}`);
    process.exit(1);
  }

  let failed = 0;
  for (const entry of entries) {
    displayContractResult(entry.env, entry.result);
    if (entry.result.skippedReasons.length > 0) {
      for (const r of entry.result.skippedReasons) {
        logger.warn(`[${entry.env}] 未执行：${r}`);
      }
    }
    if (entry.result.failed > 0) failed++;
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

function displayContractResult(env: string, result: {
  total: number; passed: number; failed: number; retried: number;
  failures: { caseId: string; reason: string }[];
}): void {
  console.log('');
  console.log('┌──────────────────────────────────────────┐');
  console.log('│       🚀 契约执行结果                    │');
  console.log('├──────────────────────────────────────────┤');
  console.log(`│  环境       │  ${env.padEnd(20)} │`);
  console.log(`│  用例总数   │  ${String(result.total).padEnd(20)} │`);
  console.log(`│  ✅ 通过    │  ${String(result.passed).padEnd(20)} │`);
  if (result.failed > 0) {
    console.log(`│  ❌ 失败    │  ${String(result.failed).padEnd(20)} │`);
  }
  if (result.retried > 0) {
    console.log(`│  🔁 重试    │  ${String(result.retried).padEnd(20)} │`);
  }
  console.log('└──────────────────────────────────────────┘');

  if (result.failures.length > 0) {
    console.log('');
    console.log(`❌ 失败明细（${env}，矩阵已回填）：`);
    for (const f of result.failures) {
      console.log(`  - ${f.caseId}: ${f.reason}`);
    }
  }
  console.log('');
}
