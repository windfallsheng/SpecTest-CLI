import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot } from '../core/context.js';
import { aggregateIterationMetrics, listIterationsWithData, type IterationMetrics } from '../core/metrics.js';

export interface TrendOptions {
  iterations?: string;
}

/**
 * 测试趋势分析
 * 数据源为 metrics 聚合层：跨迭代对比覆盖/通过/缺陷，
 * 不解析历史报告 markdown（下游产物不是事实源）。
 */
export async function trendCommand(options: TrendOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();

  const spinner = new Spinner('正在分析趋势数据...');
  spinner.start();

  try {
    const iterations = options.iterations
      ? options.iterations.split(',').map((s) => s.trim())
      : listIterationsWithData(projectRoot);

    const trendData = iterations
      .map((iter) => aggregateIterationMetrics(projectRoot, iter))
      .filter((m) => m.totalCases > 0 || m.totalAC > 0);

    spinner.stop('');

    if (trendData.length === 0) {
      logger.warn('没有足够的矩阵事实来进行趋势分析（请先 gen 生成用例）。');
      return;
    }

    displayTrend(trendData);
  } catch (error) {
    spinner.fail(`趋势分析失败：${error}`);
    throw error;
  }
}

function displayTrend(data: IterationMetrics[]): void {
  console.log('');
  console.log('┌────────────────────────────────────────────────────────────┐');
  console.log('│                    📈 测试趋势分析                         │');
  console.log('├────────────────────────────────────────────────────────────┤');
  console.log(`│  期次    │  覆盖率  │  通过率  │  缺陷(开)  │  用例数     │`);
  console.log('├────────────────────────────────────────────────────────────┤');

  for (const m of data) {
    const cov = m.coverageRate === null ? '-' : `${m.coverageRate}%`;
    const pass = m.passRate === null ? '-' : `${m.passRate}%`;
    console.log(`│  ${m.iteration.padEnd(6)} │  ${String(cov).padEnd(6)} ${renderMiniBar(m.coverageRate ?? 0)} │  ${String(pass).padEnd(6)} ${renderMiniBar(m.passRate ?? 0)} │  ${String(m.bugs.open).padEnd(8)} │  ${String(m.totalCases).padEnd(6)}      │`);
  }

  console.log('└────────────────────────────────────────────────────────────┘');

  // 趋势变化（首尾对比）
  if (data.length >= 2) {
    const first = data[0];
    const last = data[data.length - 1];
    console.log('');
    console.log('📊 趋势变化：');
    const delta = (a: number | null, b: number | null): string =>
      (a === null || b === null) ? '—' : `${b >= a ? '↑' : '↓'} ${Math.abs(b - a)}%`;
    console.log(`  覆盖率：${delta(first.coverageRate, last.coverageRate)}`);
    console.log(`  通过率：${delta(first.passRate, last.passRate)}`);
    console.log(`  缺陷数：${last.bugs.open - first.bugs.open <= 0 ? '↓' : '↑'} ${Math.abs(last.bugs.open - first.bugs.open)} 个`);
    console.log(`  用例数：${last.totalCases - first.totalCases >= 0 ? '↑' : '↓'} ${Math.abs(last.totalCases - first.totalCases)} 个`);
  }

  console.log('');
}

function renderMiniBar(percent: number): string {
  const barLength = 6;
  const filled = Math.round((percent / 100) * barLength);
  return '█'.repeat(filled) + '░'.repeat(barLength - filled);
}
