import { Spinner, logger } from '../utils/logger.js';
import { i18n } from '../i18n/index.js';
import { ensureProjectRoot, loadContext, updateContext } from '../core/context.js';
import { analyzeCoverage, saveCoverageReport } from '../core/coverage-analyzer.js';

export interface GapOptions {
  iteration?: string;
  output?: string;
}

/**
 * 检测测试覆盖缺口
 * 对比 SpecCore AC 和已生成的测试用例，发现未覆盖的场景
 */
export async function gapCommand(options: GapOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest gap --iteration Q1');
    process.exit(1);
  }

  const spinner = new Spinner(i18n.t('cmd.gap.analyzing'));
  spinner.start();

  try {
    const result = analyzeCoverage({ projectRoot, iteration });

    spinner.stop('');

    // 显示结果
    displayGapResult(result.report.coverageRate, result.report.gapItems.length, result.risks.length);

    // 有缺口时保存报告
    if (result.report.gapItems.length > 0 || result.risks.length > 0) {
      const reportPath = saveCoverageReport(projectRoot, result);
      updateContext({ gapCount: result.report.gapItems.length });
      console.log(`\n📄 详细报告：${reportPath}`);
    }
  } catch (error) {
    spinner.fail(`分析失败：${error}`);
    throw error;
  }
}

/**
 * 显示覆盖分析结果
 */
function displayGapResult(coverageRate: number, gapCount: number, riskCount: number): void {
  console.log('');
  console.log('┌──────────────────────────────────────┐');
  console.log('│       📊 测试覆盖分析结果            │');
  console.log('├──────────────────────────────────────┤');

  // 覆盖率进度条
  const barLength = 20;
  const filled = Math.round((coverageRate / 100) * barLength);
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
  console.log(`│  覆盖率    │  ${bar} ${String(coverageRate).padEnd(3)}% │`);

  if (coverageRate === 100) {
    console.log('│  ✅ 覆盖完整，无需补充！           │');
  } else {
    console.log(`│  覆盖缺口  │  ${String(gapCount).padEnd(18)} │`);
    if (riskCount > 0) {
      console.log(`│  🔴 高风险  │  ${String(riskCount).padEnd(18)} │`);
    }
  }

  console.log('└──────────────────────────────────────┘');
  console.log('');
}
