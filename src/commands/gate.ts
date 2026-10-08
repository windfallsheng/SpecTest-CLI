import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext } from '../core/context.js';
import { runGateChecks, type GateResult } from '../core/gate-checker.js';
import { loadConfig } from '../core/config.js';

export interface GateOptions {
  iteration?: string;
  task?: string;
  threshold?: string;
  /** 输出 JSON（供 SpecCore 门禁回流机器解析） */
  json?: boolean;
}

/**
 * 质量门禁（闸3）：覆盖率 / 规格完备性 / 通过率 / P0 / 漂移 / 缺陷
 *
 * 判定全部收敛于矩阵与谓词层的执行事实——没有默认通过，
 * 没有跑过测试就是「无执行事实」，阻塞放行。
 * 任一 error 级检查不达标 → exitCode 1（门禁回流 SpecCore execute）。
 */
export async function gateCommand(options: GateOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest gate -i <期次>');
    process.exit(1);
  }

  // 阈值优先级：CLI > config.yaml > 内置默认
  const config = loadConfig(projectRoot);
  const coverageThreshold = options.threshold
    ? parseInt(options.threshold, 10)
    : config.gate.coverageThreshold;

  // --json 模式不开 spinner，保证 stdout 只含 JSON（机器解析）
  let result: GateResult;
  if (!options.json) {
    const spinner = new Spinner('正在执行质量门禁检查...');
    spinner.start();
    try {
      result = runGateChecks(projectRoot, iteration, {
        coverageThreshold,
        passRateThreshold: config.gate.passRateThreshold,
        taskId: options.task,
      });
      spinner.stop('');
    } catch (error) {
      spinner.fail(`质量检查失败：${error}`);
      process.exit(1);
    }
  } else {
    result = runGateChecks(projectRoot, iteration, {
      coverageThreshold,
      passRateThreshold: config.gate.passRateThreshold,
      taskId: options.task,
    });
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    displayGateResult(result);
  }

  // 闸3 门禁语义：任一 error 不达标 → 阻塞（SpecCore 回流）
  if (!result.passed) {
    process.exitCode = 1;
  }
}

function displayGateResult(result: GateResult): void {
  console.log('');
  console.log(`━━ 质量门禁检查（${result.iteration} · ${result.scope}）━━`);
  console.log('');

  for (const check of result.checks) {
    const mark = check.passed ? '[PASS]' : check.level === 'warning' ? '[WARN]' : '[FAIL]';
    console.log(`  ${mark} ${check.name.padEnd(6, '　')} ${check.value}（要求：${check.threshold}）`);
    console.log(`          ${check.message}`);
    for (const d of check.details) {
      console.log(`          · ${d}`);
    }
    console.log('');
  }

  const verdict = result.passed
    ? '质量达标，允许放行（exitCode 0）'
    : `质量不达标，禁止放行（exitCode 1）——${result.errorCount} 项 error 未过`;
  console.log(`━━ ${verdict} ━━`);
  console.log('');
}
