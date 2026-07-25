import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import { i18n } from '../i18n/index.js';
import { loadContext, findProjectRoot, getTestDir } from '../core/context.js';

export interface StatusOptions {
  iteration?: string;
}

/**
 * 查看测试状态
 * 展示测试套件、用例数、通过率、覆盖情况
 */
export async function statusCommand(options: StatusOptions): Promise<void> {
  const projectRoot = findProjectRoot();

  if (!projectRoot) {
    logger.warn(i18n.t('cmd.status.no_project'));
    logger.info('请先运行 spectest init 初始化测试项目。');
    return;
  }

  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  console.log('');
  console.log('┌──────────────────────────────────────────────┐');
  console.log('│           📊  SpecTest 状态面板              │');
  console.log('├──────────────────────────────────────────────┤');

  // 项目信息
  console.log(`│  项目      │  ${path.basename(projectRoot).padEnd(26)} │`);

  if (iteration) {
    console.log(`│  当前期次  │  ${iteration.padEnd(26)} │`);
    // 统计期次的测试情况
    const testDir = getTestDir(projectRoot, iteration);
    if (fs.existsSync(testDir)) {
      const stats = getIterationTestStats(testDir);
      console.log(`│  测试套件  │  ${String(stats.suites).padEnd(26)} │`);
      console.log(`│  测试用例  │  ${String(stats.cases).padEnd(26)} │`);
      console.log(`│  已执行    │  ${String(stats.executed).padEnd(26)} │`);
      console.log(`│  通过      │  ${String(stats.passed).padEnd(26)} │`);
      console.log(`│  失败      │  ${String(stats.failed).padEnd(26)} │`);
    }

    // 覆盖情况
    const reportsDir = path.join(projectRoot, '.spectest', 'reports');
    if (fs.existsSync(reportsDir)) {
      const latestReport = findLatestCoverageReport(reportsDir, iteration);
      if (latestReport) {
        console.log(`│  覆盖率    │  ${String(latestReport).padEnd(24)}% │`);
      }
    }
  } else {
    console.log(`│  当前期次  │  ${'未设置'.padEnd(26)} │`);
  }

  console.log('├──────────────────────────────────────────────┤');
  console.log(`│  总套件    │  ${String(context.totalSuites).padEnd(26)} │`);
  console.log(`│  总用例    │  ${String(context.totalCases).padEnd(26)} │`);
  console.log(`│  覆盖缺口  │  ${String(context.gapCount).padEnd(26)} │`);
  console.log('└──────────────────────────────────────────────┘');
  console.log('');
}

interface IterationStats {
  suites: number;
  cases: number;
  executed: number;
  passed: number;
  failed: number;
}

function getIterationTestStats(testDir: string): IterationStats {
  const stats: IterationStats = { suites: 0, cases: 0, executed: 0, passed: 0, failed: 0 };
  const entries = fs.readdirSync(testDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    stats.suites++;

    const casesDir = path.join(testDir, entry.name, 'cases');
    if (fs.existsSync(casesDir)) {
      const caseFiles = fs.readdirSync(casesDir);
      stats.cases += caseFiles.length;
    }
  }

  return stats;
}

function findLatestCoverageReport(reportsDir: string, iteration: string): string | null {
  const files = fs.readdirSync(reportsDir)
    .filter(f => f.startsWith(`coverage-${iteration}`) && f.endsWith('.md'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  const content = fs.readFileSync(path.join(reportsDir, files[0]), 'utf-8');
  const match = content.match(/覆盖率\s*\|\s*(\d+)%/);
  return match ? match[1] : null;
}
