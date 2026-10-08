import path from 'path';
import fs from 'fs-extra';
import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext } from '../core/context.js';
import { aggregateIterationMetrics, type IterationMetrics } from '../core/metrics.js';

export interface SummaryOptions {
  iteration?: string;
  output?: string;
}

/**
 * 测试总结
 * 迭代结束后的质量度量汇总——数据源为 metrics 聚合层（矩阵执行事实），
 * 无执行事实如实显示「-」，不伪造 100%。
 */
export async function summaryCommand(options: SummaryOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest summary --iteration Q1');
    process.exit(1);
  }

  const spinner = new Spinner('正在汇总测试数据...');
  spinner.start();

  try {
    const metrics = aggregateIterationMetrics(projectRoot, iteration);

    spinner.stop('');

    displaySummary(metrics);

    // 保存报告
    const reportPath = saveSummaryReport(projectRoot, metrics);
    logger.info(`总结报告已保存：${reportPath}`);
  } catch (error) {
    spinner.fail(`汇总失败：${error}`);
    throw error;
  }
}

function displaySummary(metrics: IterationMetrics): void {
  console.log('');
  console.log('┌──────────────────────────────────────────────┐');
  console.log('│          📊 测试总结 - ' + metrics.iteration.padEnd(18) + '│');
  console.log('├──────────────────────────────────────────────┤');
  console.log(`│  功能单元    │  ${String(metrics.totalUnits).padEnd(26)} │`);
  console.log(`│  测试套件    │  ${String(metrics.totalSuites).padEnd(26)} │`);
  console.log(`│  测试用例    │  ${String(metrics.totalCases).padEnd(26)} │`);
  console.log(`│  已执行      │  ${String(metrics.executedCases).padEnd(26)} │`);
  console.log('├──────────────────────────────────────────────┤');
  console.log(`│  ✅ 通过     │  ${String(metrics.passedCases).padEnd(26)} │`);
  if (metrics.failedCases > 0) {
    console.log(`│  ❌ 失败     │  ${String(metrics.failedCases).padEnd(26)} │`);
  }
  if (metrics.skippedCases > 0) {
    console.log(`│  ⏭️ 跳过     │  ${String(metrics.skippedCases).padEnd(26)} │`);
  }
  if (metrics.pendingCases > 0) {
    console.log(`│  ⏳ 未执行   │  ${String(metrics.pendingCases).padEnd(26)} │`);
  }
  console.log(`│  通过率      │  ${String(metrics.passRate === null ? '-' : `${metrics.passRate}%`).padEnd(25)} │`);
  console.log(`│  覆盖率      │  ${String(metrics.coverageRate === null ? '-' : `${metrics.coverageRate}%`).padEnd(25)} │`);
  console.log(`│  P0 通过     │  ${String(`${metrics.p0.passed}/${metrics.p0.total}`).padEnd(25)} │`);
  console.log('├──────────────────────────────────────────────┤');
  console.log(`│  🐛 缺陷总数 │  ${String(metrics.bugs.total).padEnd(26)} │`);
  console.log(`│     未修复   │  ${String(metrics.bugs.open).padEnd(26)} │`);
  console.log(`│     已修复   │  ${String(metrics.bugs.closed).padEnd(26)} │`);
  console.log('└──────────────────────────────────────────────┘');
  console.log('');
}

function saveSummaryReport(projectRoot: string, metrics: IterationMetrics): string {
  const reportsDir = path.join(projectRoot, '.spectest', 'reports');
  fs.ensureDirSync(reportsDir);

  const reportPath = path.join(reportsDir, `summary-${metrics.iteration}.md`);
  const rate = (v: number | null): string => (v === null ? '-' : `${v}%`);

  let md = `# 测试总结报告 - ${metrics.iteration}\n\n`;
  md += `> 生成时间：${new Date().toISOString()}\n\n`;

  md += `## 质量度量\n\n`;
  md += `| 指标 | 值 |\n`;
  md += `|------|----|\n`;
  md += `| 功能单元 | ${metrics.totalUnits} |\n`;
  md += `| 测试套件 | ${metrics.totalSuites} |\n`;
  md += `| 测试用例 | ${metrics.totalCases} |\n`;
  md += `| 已执行 | ${metrics.executedCases} |\n`;
  md += `| 通过 | ${metrics.passedCases} |\n`;
  md += `| 失败 | ${metrics.failedCases} |\n`;
  md += `| 跳过 | ${metrics.skippedCases} |\n`;
  md += `| 未执行 | ${metrics.pendingCases} |\n`;
  md += `| 通过率 | ${rate(metrics.passRate)} |\n`;
  md += `| 覆盖率（${metrics.coveredAC}/${metrics.totalAC} AC） | ${rate(metrics.coverageRate)} |\n`;
  md += `| P0 通过 | ${metrics.p0.passed}/${metrics.p0.total} |\n`;
  md += `| 缺陷总数 | ${metrics.bugs.total} |\n`;
  md += `| 未修复缺陷 | ${metrics.bugs.open} |\n`;
  md += `| 已修复缺陷 | ${metrics.bugs.closed} |\n`;
  md += `| 规格缺口 | ${metrics.specGaps} |\n`;
  md += `| 规格漂移套件 | ${metrics.driftSuites} |\n`;

  fs.writeFileSync(reportPath, md, 'utf-8');
  return reportPath;
}
