import path from 'path';
import fs from 'fs-extra';
import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext } from '../core/context.js';

export interface TrendOptions {
  iterations?: string;
}

interface TrendPoint {
  iteration: string;
  coverageRate: number;
  passRate: number;
  bugCount: number;
  caseCount: number;
}

/**
 * 测试趋势分析
 * 跨迭代的覆盖率/通过率/缺陷数趋势对比
 */
export async function trendCommand(options: TrendOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();

  const spinner = new Spinner('正在分析趋势数据...');
  spinner.start();

  try {
    const iterations = options.iterations
      ? options.iterations.split(',')
      : detectIterations(projectRoot);

    const trendData = iterations.map(iter => {
      return aggregateTrendPoint(projectRoot, iter.trim());
    }).filter((t): t is TrendPoint => t !== null);

    spinner.stop('');

    if (trendData.length === 0) {
      logger.warn('没有足够的历史数据来进行趋势分析');
      return;
    }

    displayTrend(trendData);
  } catch (error) {
    spinner.fail(`趋势分析失败：${error}`);
    throw error;
  }
}

function detectIterations(projectRoot: string): string[] {
  const iterations: string[] = [];

  // 从 .spectest/tests/ 目录
  const testsDir = path.join(projectRoot, '.spectest', 'tests');
  if (fs.existsSync(testsDir)) {
    const dirs = fs.readdirSync(testsDir, { withFileTypes: true });
    iterations.push(...dirs.filter(d => d.isDirectory()).map(d => d.name));
  }

  // 从 .spectest/plans/ 目录
  const plansDir = path.join(projectRoot, '.spectest', 'plans');
  if (fs.existsSync(plansDir)) {
    const files = fs.readdirSync(plansDir);
    for (const f of files) {
      const match = f.match(/test-plan-(.+)\.md/);
      if (match && !iterations.includes(match[1])) {
        iterations.push(match[1]);
      }
    }
  }

  return iterations.sort();
}

function aggregateTrendPoint(projectRoot: string, iteration: string): TrendPoint | null {
  const reportsDir = path.join(projectRoot, '.spectest', 'reports');
  let coverageRate = 0;
  let passRate = 0;
  let bugCount = 0;
  let caseCount = 0;

  // 覆盖率
  if (fs.existsSync(reportsDir)) {
    const coverageFiles = fs.readdirSync(reportsDir)
      .filter(f => f.startsWith(`coverage-${iteration}`))
      .sort()
      .reverse();

    if (coverageFiles.length > 0) {
      const content = fs.readFileSync(path.join(reportsDir, coverageFiles[0]), 'utf-8');
      const crMatch = content.match(/覆盖率\s*\|\s*(\d+)%/);
      if (crMatch) coverageRate = parseInt(crMatch[1]);
    }
  }

  // 摘要
  if (fs.existsSync(reportsDir)) {
    const summaryFile = path.join(reportsDir, `summary-${iteration}.md`);
    if (fs.existsSync(summaryFile)) {
      const content = fs.readFileSync(summaryFile, 'utf-8');
      const prMatch = content.match(/通过率\s*\|\s*(\d+)%/);
      if (prMatch) passRate = parseInt(prMatch[1]);
      const bcMatch = content.match(/缺陷总数\s*\|\s*(\d+)/);
      if (bcMatch) bugCount = parseInt(bcMatch[1]);
      const ccMatch = content.match(/测试用例\s*\|\s*(\d+)/);
      if (ccMatch) caseCount = parseInt(ccMatch[1]);
    }
  }

  return {
    iteration,
    coverageRate,
    passRate,
    bugCount,
    caseCount,
  };
}

function displayTrend(data: TrendPoint[]): void {
  console.log('');
  console.log('┌────────────────────────────────────────────────────────────┐');
  console.log('│                    📈 测试趋势分析                         │');
  console.log('├────────────────────────────────────────────────────────────┤');
  console.log(`│  期次    │  覆盖率  │  通过率  │  缺陷数  │  用例数      │`);
  console.log('├────────────────────────────────────────────────────────────┤');

  for (const point of data) {
    const coverageBar = renderMiniBar(point.coverageRate);
    const passBar = renderMiniBar(point.passRate);
    console.log(`│  ${point.iteration.padEnd(6)} │  ${String(point.coverageRate).padEnd(4)}% ${coverageBar} │  ${String(point.passRate).padEnd(4)}% ${passBar} │  ${String(point.bugCount).padEnd(6)} │  ${String(point.caseCount).padEnd(4)}      │`);
  }

  console.log('└────────────────────────────────────────────────────────────┘');

  // 趋势分析
  if (data.length >= 2) {
    const first = data[0];
    const last = data[data.length - 1];
    console.log('');
    console.log('📊 趋势变化：');
    const covTrend = last.coverageRate - first.coverageRate;
    const bugTrend = last.bugCount - first.bugCount;
    console.log(`  覆盖率：${covTrend >= 0 ? '📈 ↑' : '📉 ↓'} ${Math.abs(covTrend)}%`);
    console.log(`  缺陷数：${bugTrend <= 0 ? '📉 ↓' : '📈 ↑'} ${Math.abs(bugTrend)} 个`);
  }

  console.log('');
}

function renderMiniBar(percent: number): string {
  const barLength = 6;
  const filled = Math.round((percent / 100) * barLength);
  return '█'.repeat(filled) + '░'.repeat(barLength - filled);
}
