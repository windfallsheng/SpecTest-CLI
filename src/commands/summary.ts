import path from 'path';
import fs from 'fs-extra';
import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext, getTestDir } from '../core/context.js';

export interface SummaryOptions {
  iteration?: string;
  output?: string;
}

interface IterationMetrics {
  iteration: string;
  totalSuites: number;
  totalCases: number;
  executedCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  coverageRate: number;
  bugs: { total: number; open: number; fixed: number };
  duration: string;
}

/**
 * 测试总结
 * 迭代结束后的质量度量汇总
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
    const metrics = aggregateMetrics(projectRoot, iteration);

    spinner.stop('');

    displaySummary(metrics);

    // 保存报告
    const reportPath = saveSummaryReport(projectRoot, metrics);
    console.log(`📄 完整报告：${reportPath}\n`);
  } catch (error) {
    spinner.fail(`汇总失败：${error}`);
    throw error;
  }
}

function aggregateMetrics(projectRoot: string, iteration: string): IterationMetrics {
  const testDir = getTestDir(projectRoot, iteration);
  let totalSuites = 0;
  let totalCases = 0;
  let passedCases = 0;
  let failedCases = 0;

  if (fs.existsSync(testDir)) {
    const suiteDirs = fs.readdirSync(testDir, { withFileTypes: true });

    for (const sDir of suiteDirs) {
      if (!sDir.isDirectory()) continue;
      totalSuites++;

      const casesDir = path.join(testDir, sDir.name, 'cases');
      if (fs.existsSync(casesDir)) {
        totalCases += fs.readdirSync(casesDir).length;
      }

      const runsDir = path.join(testDir, sDir.name, 'runs');
      if (fs.existsSync(runsDir)) {
        const runFiles = fs.readdirSync(runsDir);
        for (const rf of runFiles) {
          try {
            const run = fs.readJsonSync(path.join(runsDir, rf));
            passedCases += (run.passedCases || 0);
            failedCases += (run.failedCases || 0);
          } catch { /* skip */ }
        }
      }
    }
  }

  const executedCases = passedCases + failedCases;
  const passRate = executedCases > 0 ? Math.round((passedCases / executedCases) * 100) : 100;

  // 覆盖率
  const coverageRate = getCoverageRate(projectRoot, iteration);

  // 缺陷统计
  const bugs = getBugStats(projectRoot, iteration);

  return {
    iteration,
    totalSuites,
    totalCases,
    executedCases,
    passedCases,
    failedCases,
    passRate,
    coverageRate,
    bugs,
    duration: `${calculateDuration(projectRoot, iteration)} 天`,
  };
}

function getCoverageRate(projectRoot: string, iteration: string): number {
  const reportsDir = path.join(projectRoot, '.spectest', 'reports');
  if (!fs.existsSync(reportsDir)) return 0;

  const files = fs.readdirSync(reportsDir)
    .filter(f => f.startsWith(`coverage-${iteration}`))
    .sort()
    .reverse();

  if (files.length > 0) {
    const content = fs.readFileSync(path.join(reportsDir, files[0]), 'utf-8');
    const match = content.match(/覆盖率\s*\|\s*(\d+)%/);
    if (match) return parseInt(match[1]);
  }

  return 0;
}

function getBugStats(projectRoot: string, iteration: string): { total: number; open: number; fixed: number } {
  const bugsDir = path.join(projectRoot, '.spectest', 'bugs');
  if (!fs.existsSync(bugsDir)) return { total: 0, open: 0, fixed: 0 };

  const files = fs.readdirSync(bugsDir).filter(f => f.endsWith('.json'));
  let open = 0;
  let fixed = 0;

  for (const f of files) {
    try {
      const bug = fs.readJsonSync(path.join(bugsDir, f));
      if (bug.iteration !== iteration) continue;
      if (bug.status === 'open') open++;
      else if (bug.status === 'fixed') fixed++;
    } catch { /* skip */ }
  }

  return {
    total: open + fixed,
    open,
    fixed,
  };
}

function calculateDuration(projectRoot: string, iteration: string): number {
  // 简化：从期次目录的创建时间到今天
  const testDir = getTestDir(projectRoot, iteration);
  if (fs.existsSync(testDir)) {
    const stat = fs.statSync(testDir);
    const days = Math.ceil((Date.now() - stat.birthtimeMs) / (1000 * 60 * 60 * 24));
    return Math.max(days, 1);
  }
  return 1;
}

function displaySummary(metrics: IterationMetrics): void {
  console.log('');
  console.log('┌──────────────────────────────────────────────┐');
  console.log('│          📊 测试总结报告                     │');
  console.log('├──────────────────────────────────────────────┤');
  console.log(`│  期次        │  ${metrics.iteration.padEnd(26)} │`);
  console.log(`│  测试套件    │  ${String(metrics.totalSuites).padEnd(26)} │`);
  console.log(`│  测试用例    │  ${String(metrics.totalCases).padEnd(26)} │`);
  console.log(`│  已执行      │  ${String(metrics.executedCases).padEnd(26)} │`);
  console.log('├──────────────────────────────────────────────┤');
  console.log(`│  ✅ 通过     │  ${String(metrics.passedCases).padEnd(26)} │`);
  if (metrics.failedCases > 0) {
    console.log(`│  ❌ 失败     │  ${String(metrics.failedCases).padEnd(26)} │`);
  }
  console.log(`│  通过率      │  ${String(metrics.passRate).padEnd(25)}% │`);
  console.log(`│  覆盖率      │  ${String(metrics.coverageRate).padEnd(25)}% │`);
  console.log('├──────────────────────────────────────────────┤');
  console.log(`│  🐛 缺陷总数 │  ${String(metrics.bugs.total).padEnd(26)} │`);
  console.log(`│     未修复   │  ${String(metrics.bugs.open).padEnd(26)} │`);
  console.log(`│     已修复   │  ${String(metrics.bugs.fixed).padEnd(26)} │`);
  console.log('└──────────────────────────────────────────────┘');
  console.log('');
}

function saveSummaryReport(projectRoot: string, metrics: IterationMetrics): string {
  const reportsDir = path.join(projectRoot, '.spectest', 'reports');
  fs.ensureDirSync(reportsDir);

  const reportPath = path.join(reportsDir, `summary-${metrics.iteration}.md`);

  let md = `# 测试总结报告 - ${metrics.iteration}\n\n`;
  md += `> 生成时间：${new Date().toISOString()}\n\n`;

  md += `## 质量度量\n\n`;
  md += `| 指标 | 值 |\n`;
  md += `|------|----|\n`;
  md += `| 测试套件 | ${metrics.totalSuites} |\n`;
  md += `| 测试用例 | ${metrics.totalCases} |\n`;
  md += `| 已执行 | ${metrics.executedCases} |\n`;
  md += `| 通过 | ${metrics.passedCases} |\n`;
  md += `| 失败 | ${metrics.failedCases} |\n`;
  md += `| 通过率 | ${metrics.passRate}% |\n`;
  md += `| 覆盖率 | ${metrics.coverageRate}% |\n`;
  md += `| 缺陷总数 | ${metrics.bugs.total} |\n`;
  md += `| 未修复缺陷 | ${metrics.bugs.open} |\n`;
  md += `| 已修复缺陷 | ${metrics.bugs.fixed} |\n`;
  md += `| 测试时长 | ${metrics.duration} |\n`;

  fs.writeFileSync(reportPath, md, 'utf-8');
  return reportPath;
}
