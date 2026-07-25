import inquirer from 'inquirer';
import { Spinner, logger } from '../utils/logger.js';
import { i18n } from '../i18n/index.js';
import { ensureProjectRoot, loadContext, updateContext } from '../core/context.js';
import {
  generateTestSuite,
  saveTestSuite,
  GenerateOptions,
} from '../core/test-generator.js';

export interface GenOptions {
  iteration?: string;
  suite?: string;
  name?: string;
  type?: 'unit' | 'integration' | 'e2e' | 'api';
  platform?: 'backend' | 'frontend' | 'fullstack';
}

/**
 * 生成测试用例
 * 从 SpecCore 的 AC 自动生成测试用例
 */
export async function genCommand(options: GenOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);

  // 确定参数
  let iteration = options.iteration || context.currentIteration;
  let suiteName = options.name;
  let testType = options.type || ('unit' as const);
  let platform = options.platform || ('fullstack' as const);

  // 交互式补充缺失参数
  if (!iteration) {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'iteration',
        message: '请输入期次名称：',
        validate: (val: string) => val.trim() ? true : '期次名称不能为空',
      },
    ]);
    iteration = answer.iteration;
  }

  if (!suiteName) {
    suiteName = `测试套件-${iteration}`;
  }

  // 生成套件 ID
  const suiteId = `TS-${String(Date.now()).slice(-6)}`;

  const spinner = new Spinner(i18n.t('cmd.gen.reading_spec'));
  spinner.start();

  try {
    const genOptions: GenerateOptions = {
      projectRoot,
      iteration,
      suiteId,
      suiteName,
      testType,
      platform,
    };

    spinner.update(`正在为 ${iteration} 生成测试用例...`);
    const result = generateTestSuite(genOptions);

    spinner.update('正在保存...');
    const outputDir = saveTestSuite(projectRoot, result);

    spinner.stop('');

    // 输出摘要
    displaySummary(result.summary);

    // 更新上下文
    updateContext({
      currentIteration: iteration,
      currentSuite: suiteId,
      totalCases: context.totalCases + result.summary.generatedCases,
      totalSuites: context.totalSuites + 1,
    });

    console.log(`\n📂 输出目录：${outputDir}`);
  } catch (error) {
    spinner.fail(`生成失败：${error}`);
    throw error;
  }
}

/**
 * 显示生成摘要
 */
function displaySummary(summary: { totalRequirements: number; totalAC: number; generatedCases: number }): void {
  console.log('');
  console.log('┌─────────────────────────────────────┐');
  console.log('│       📊 测试用例生成摘要           │');
  console.log('├─────────────────────────────────────┤');
  console.log(`│  需求数    │  ${String(summary.totalRequirements).padEnd(18)} │`);
  console.log(`│  AC 数     │  ${String(summary.totalAC).padEnd(18)} │`);
  console.log(`│  生成用例  │  ${String(summary.generatedCases).padEnd(18)} │`);
  console.log('└─────────────────────────────────────┘');
  console.log('');
}
