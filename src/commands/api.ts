import { Spinner, logger } from '../utils/logger.js';
import { i18n } from '../i18n/index.js';
import { ensureProjectRoot, loadContext, updateContext } from '../core/context.js';
import { generateAPITests, saveAPITestSuite } from '../core/api-test-generator.js';

export interface ApiOptions {
  iteration?: string;
  name?: string;
}

/**
 * 从 API Contract 生成 API 测试
 * 解析 spec-core 产出的 API_CONTRACT.yaml，自动生成接口测试用例
 */
export async function apiCommand(options: ApiOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest api --iteration Q1');
    process.exit(1);
  }

  const suiteName = options.name || `API测试套件-${iteration}`;
  const suiteId = `API-${iteration}-${String(Date.now()).slice(-6)}`;

  const spinner = new Spinner('正在扫描 API Contract 文件...');
  spinner.start();

  try {
    spinner.update('正在解析 API 定义...');
    const result = generateAPITests({
      projectRoot,
      iteration,
      suiteId,
      suiteName,
    });

    spinner.update('正在保存 API 测试用例...');
    const outputDir = saveAPITestSuite(projectRoot, result);

    spinner.stop('');

    displayAPISummary(result.summary);

    // 更新上下文
    updateContext({
      totalCases: context.totalCases + result.summary.generatedCases,
      totalSuites: context.totalSuites + 1,
    });

    console.log(`\n📂 输出目录：${outputDir}`);
  } catch (error) {
    spinner.fail(`生成 API 测试失败：${error}`);
    throw error;
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
