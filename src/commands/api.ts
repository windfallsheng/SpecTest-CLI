import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext, updateContext } from '../core/context.js';
import { generateAPITests, saveAPITestSuite } from '../core/api-test-generator.js';

export interface ApiOptions {
  iteration?: string;
  name?: string;
  /** 标准端名（服务端），必填：契约面归属的服务端 */
  platform?: string;
}

/**
 * 从 API Contract 生成 API 测试
 * 解析 spec-core 产出的 API_CONTRACT.yaml（030-tasks 下 <Task组>/_shared/），
 * 确定性生成五类契约场景用例（幂等 ID + 矩阵登记）。
 */
export async function apiCommand(options: ApiOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest api -i <期次>');
    process.exit(1);
  }

  if (!options.platform) {
    logger.error('请指定标准端名（服务端），如：spectest api -p booking-service');
    logger.info('端名必须与 SpecCore CONSTITUTION.md 端列表一致');
    process.exit(1);
  }

  const spinner = new Spinner('正在扫描 API Contract 文件...');
  spinner.start();

  try {
    spinner.update('正在解析 API 定义...');
    const result = generateAPITests({
      projectRoot,
      iteration,
      platform: options.platform,
      suiteName: options.name,
    });

    spinner.update('正在保存 API 测试用例...');
    const outputDir = saveAPITestSuite(projectRoot, result);

    spinner.stop('');

    displayAPISummary(result.summary);

    // 更新上下文
    updateContext({
      currentIteration: iteration,
      totalCases: context.totalCases + result.summary.generatedCases,
      totalSuites: context.totalSuites + 1,
      lastAction: `api:${iteration}`,
    });

    console.log(`📂 输出目录：${outputDir}`);
  } catch (error) {
    spinner.fail(`生成 API 测试失败：${error}`);
    process.exit(1);
  }
}

function displayAPISummary(summary: { totalEndpoints: number; generatedCases: number; skippedEndpoints: number }): void {
  console.log('');
  console.log('┌──────────────────────────────────────┐');
  console.log('│       🔌 API 测试生成摘要           │');
  console.log('├──────────────────────────────────────┤');
  console.log(`│  API 端点   │  ${String(summary.totalEndpoints).padEnd(18)} │`);
  console.log(`│  生成用例   │  ${String(summary.generatedCases).padEnd(18)} │`);
  if (summary.skippedEndpoints > 0) {
    console.log(`│  跳过端点   │  ${String(summary.skippedEndpoints).padEnd(18)} │`);
  }
  console.log('└──────────────────────────────────────┘');
  console.log('');
}
