import path from 'path';
import fs from 'fs-extra';
import { Spinner, ProgressBar, logger } from '../utils/logger.js';
import { i18n } from '../i18n/index.js';
import { ensureProjectRoot, loadContext, getSuiteDir } from '../core/context.js';
import { TestRun } from '../core/schemas/index.js';

export interface RunOptions {
  iteration?: string;
  suite?: string;
}

/**
 * 执行测试套件
 * 注意：当前版本为模拟执行，实际执行需要接入具体的测试框架
 */
export async function runCommand(options: RunOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest run --iteration Q1');
    process.exit(1);
  }

  if (!options.suite) {
    logger.error('请指定测试套件 ID，如：spectest run --suite TS-123456');
    process.exit(1);
  }

  const suiteDir = getSuiteDir(projectRoot, iteration, options.suite);
  if (!fs.existsSync(suiteDir)) {
    logger.error(`未找到测试套件：${options.suite}`);
    process.exit(1);
  }

  const casesDir = path.join(suiteDir, 'cases');
  if (!fs.existsSync(casesDir)) {
    logger.warn('该套件中没有测试用例');
    return;
  }

  const caseFiles = fs.readdirSync(casesDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  if (caseFiles.length === 0) {
    logger.warn('该套件中没有测试用例');
    return;
  }

  const spinner = new Spinner(i18n.t('cmd.run.start'));
  spinner.start();

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // 模拟执行测试
  for (let i = 0; i < caseFiles.length; i++) {
    const caseFile = caseFiles[i];
    spinner.update(`执行中：${i + 1}/${caseFiles.length} - ${caseFile}`);

    // 模拟执行延迟
    await sleep(200 + Math.random() * 300);

    // 模拟结果（90% 通过率）
    const random = Math.random();
    if (random < 0.9) {
      passed++;
    } else if (random < 0.95) {
      failed++;
    } else {
      skipped++;
    }
  }

  // 生成执行记录
  const runRecord: TestRun = {
    id: `RUN-${Date.now()}`,
    suiteId: options.suite,
    status: failed === 0 ? 'completed' : 'completed',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    totalCases: caseFiles.length,
    passedCases: passed,
    failedCases: failed,
    skippedCases: skipped,
    caseResults: [
      { caseId: 'TC-001', status: 'passed', duration: 120 },
      { caseId: 'TC-002', status: 'passed', duration: 85 },
    ],
    createdAt: new Date().toISOString(),
  };

  // 保存执行记录
  const runsDir = path.join(suiteDir, 'runs');
  fs.ensureDirSync(runsDir);
  fs.writeJsonSync(path.join(runsDir, `${runRecord.id}.json`), runRecord, { spaces: 2 });

  spinner.stop('');

  // 输出结果
  console.log('');
  console.log('┌──────────────────────────────────────┐');
  console.log('│       🧪 测试执行结果                │');
  console.log('├──────────────────────────────────────┤');
  console.log(`│  总用例    │  ${String(caseFiles.length).padEnd(18)} │`);
  console.log(`│  ✅ 通过   │  ${String(passed).padEnd(18)} │`);
  if (failed > 0) {
    console.log(`│  ❌ 失败   │  ${String(failed).padEnd(18)} │`);
  }
  if (skipped > 0) {
    console.log(`│  ⏭️  跳过  │  ${String(skipped).padEnd(18)} │`);
  }
  const rate = Math.round((passed / caseFiles.length) * 100);
  console.log(`│  通过率    │  ${String(rate).padEnd(17)}% │`);
  console.log('└──────────────────────────────────────┘');
  console.log('');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
