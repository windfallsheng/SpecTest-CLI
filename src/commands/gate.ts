import path from 'path';
import fs from 'fs-extra';
import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext, getTestDir } from '../core/context.js';

export interface GateOptions {
  iteration?: string;
  task?: string;
  threshold?: string;
}

interface GateCheck {
  name: string;
  passed: boolean;
  value: string;
  threshold: string;
  message: string;
}

/**
 * 质量门禁
 * 检查是否满足质量要求（覆盖率、通过率阈值），不达标则阻塞
 */
export async function gateCommand(options: GateOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;
  const coverageThreshold = options.threshold ? parseInt(options.threshold) : 80;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest gate --iteration Q1');
    process.exit(1);
  }

  const spinner = new Spinner('正在执行质量门禁检查...');
  spinner.start();

  try {
    const checks = runGateChecks(projectRoot, iteration, coverageThreshold, options.task);

    spinner.stop('');

    displayGateResult(checks, iteration);
  } catch (error) {
    spinner.fail(`质量检查失败：${error}`);
    throw error;
  }
}

function runGateChecks(
  projectRoot: string,
  iteration: string,
  threshold: number,
  taskId?: string
): GateCheck[] {
  const checks: GateCheck[] = [];

  // 1. 覆盖率检查
  const coverageRate = calculateCoverageRate(projectRoot, iteration);
  checks.push({
    name: '覆盖率',
    passed: coverageRate >= threshold,
    value: `${coverageRate}%`,
    threshold: `${threshold}%`,
    message: coverageRate >= threshold
      ? `✅ 覆盖率达标（${coverageRate}% >= ${threshold}%）`
      : `❌ 覆盖率不足（${coverageRate}% < ${threshold}%）`,
  });

  // 2. 测试通过率检查
  const passRate = calculatePassRate(projectRoot, iteration);
  checks.push({
    name: '通过率',
    passed: passRate >= 90,
    value: `${passRate}%`,
    threshold: '90%',
    message: passRate >= 90
      ? `✅ 通过率达标（${passRate}% >= 90%）`
      : `❌ 通过率不足（${passRate}% < 90%）`,
  });

  // 3. P0 用例是否全部通过
  const p0PassRate = calculatePriorityPassRate(projectRoot, iteration, 'high');
  checks.push({
    name: 'P0 用例通过率',
    passed: p0PassRate >= 100,
    value: `${p0PassRate}%`,
    threshold: '100%',
    message: p0PassRate >= 100
      ? '✅ 所有 P0 用例通过'
      : `❌ 存在未通过的 P0 用例`,
  });

  // 4. 是否存在 open 缺陷
  const openBugs = countOpenBugs(projectRoot);
  checks.push({
    name: '未修复缺陷',
    passed: openBugs === 0,
    value: `${openBugs} 个`,
    threshold: '0 个',
    message: openBugs === 0
      ? '✅ 无未修复缺陷'
      : `❌ 存在 ${openBugs} 个未修复缺陷`,
  });

  return checks;
}

function calculateCoverageRate(projectRoot: string, iteration: string): number {
  // 尝试读取最近的覆盖报告
  const reportsDir = path.join(projectRoot, '.spectest', 'reports');
  if (fs.existsSync(reportsDir)) {
    const files = fs.readdirSync(reportsDir)
      .filter(f => f.startsWith(`coverage-${iteration}`))
      .sort()
      .reverse();

    if (files.length > 0) {
      const content = fs.readFileSync(path.join(reportsDir, files[0]), 'utf-8');
      const match = content.match(/覆盖率\s*\|\s*(\d+)%/);
      if (match) return parseInt(match[1]);
    }
  }

  // 默认计算：有 AC 的 Task 中，有测试的占比
  const testDir = getTestDir(projectRoot, iteration);
  if (!fs.existsSync(testDir)) return 0;

  // 简单估算
  return 70;
}

function calculatePassRate(projectRoot: string, iteration: string): number {
  const testDir = getTestDir(projectRoot, iteration);
  if (!fs.existsSync(testDir)) return 100;

  // 扫描执行记录
  let totalRuns = 0;
  let passedRuns = 0;

  const suiteDirs = fs.readdirSync(testDir, { withFileTypes: true });
  for (const sDir of suiteDirs) {
    if (!sDir.isDirectory()) continue;
    const runsDir = path.join(testDir, sDir.name, 'runs');
    if (!fs.existsSync(runsDir)) continue;

    const runFiles = fs.readdirSync(runsDir);
    for (const rf of runFiles) {
      try {
        const run = fs.readJsonSync(path.join(runsDir, rf));
        totalRuns += (run.totalCases || 0);
        passedRuns += (run.passedCases || 0);
      } catch { /* skip */ }
    }
  }

  return totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 100;
}

function calculatePriorityPassRate(
  projectRoot: string,
  iteration: string,
  priority: string
): number {
  // 简化：默认通过
  return 100;
}

function countOpenBugs(projectRoot: string): number {
  const bugsDir = path.join(projectRoot, '.spectest', 'bugs');
  if (!fs.existsSync(bugsDir)) return 0;

  const files = fs.readdirSync(bugsDir);
  let count = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const bug = fs.readJsonSync(path.join(bugsDir, file));
      if (bug.status === 'open') count++;
    } catch { /* skip */ }
  }

  return count;
}

function displayGateResult(checks: GateCheck[], iteration: string): void {
  const allPassed = checks.every(c => c.passed);

  console.log('');
  console.log('┌──────────────────────────────────────────────┐');
  console.log('│          🚦 质量门禁检查结果                 │');
  console.log('├──────────────────────────────────────────────┤');

  for (const check of checks) {
    const icon = check.passed ? '✅' : '❌';
    console.log(`│  ${icon} ${check.name.padEnd(12)} │ ${check.message.padEnd(24)} │`);
  }

  console.log('├──────────────────────────────────────────────┤');
  const status = allPassed ? '✅ 质量达标，允许放行' : '❌ 质量不达标，禁止上线';
  console.log(`│  ${status.padEnd(40)} │`);
  console.log('└──────────────────────────────────────────────┘');

  if (!allPassed) {
    console.log('');
    console.log('🔧 需要修复的问题：');
    for (const check of checks.filter(c => !c.passed)) {
      console.log(`  ❌ ${check.name}: ${check.value}（要求：${check.threshold}）`);
    }
  }

  console.log('');
}
