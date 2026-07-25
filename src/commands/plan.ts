import { Spinner, logger } from '../utils/logger.js';
import { i18n } from '../i18n/index.js';
import { ensureProjectRoot, loadContext, updateContext } from '../core/context.js';
import { generateTestPlan, saveTestPlan, TestPlan } from '../core/test-planner.js';

export interface PlanOptions {
  iteration?: string;
  goal?: string;
}

/**
 * 生成测试计划
 * 从期次目标 + 需求范围自动生成测试策略
 */
export async function planCommand(options: PlanOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest plan --iteration Q1');
    process.exit(1);
  }

  const spinner = new Spinner('正在分析期次需求...');
  spinner.start();

  try {
    const plan = generateTestPlan({
      projectRoot,
      iteration,
      iterationGoal: options.goal,
    });

    spinner.update('正在生成测试计划...');
    const planPath = saveTestPlan(projectRoot, plan);

    spinner.stop('');

    // 显示计划摘要
    displayPlanSummary(plan);

    console.log(`\n📄 详细计划：${planPath}\n`);
  } catch (error) {
    spinner.fail(`生成测试计划失败：${error}`);
    throw error;
  }
}

/**
 * 显示计划摘要
 */
function displayPlanSummary(plan: TestPlan): void {
  console.log('');
  console.log('┌──────────────────────────────────────────────┐');
  console.log('│       📋 测试计划摘要                        │');
  console.log('├──────────────────────────────────────────────┤');
  console.log(`│  期次      │  ${plan.iteration.padEnd(26)} │`);
  console.log(`│  目标      │  ${truncate(plan.iterationGoal, 26)} │`);
  console.log(`│  Task 数   │  ${String(plan.overview.totalTasks).padEnd(26)} │`);
  console.log(`│  AC 数     │  ${String(plan.overview.totalAC).padEnd(26)} │`);

  const highRisk = plan.overview.highRiskTasks;
  if (highRisk > 0) {
    console.log(`│  🔴 高风险  │  ${String(highRisk).padEnd(26)} │`);
  }
  console.log('└──────────────────────────────────────────────┘');

  // 策略速览
  if (plan.strategies.length > 0) {
    console.log('');
    console.log('📊 测试策略速览：');
    for (const s of plan.strategies) {
      const emoji = s.riskLevel === 'high' ? '🔴' : s.riskLevel === 'medium' ? '🟡' : '🟢';
      const types = s.recommendedTests.map(t => t.type).join(', ');
      console.log(`  ${emoji} ${s.taskId} → ${types}`);
    }
  }
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str.padEnd(len);
  return str.substring(0, len - 1) + '.' + ' '.repeat(len - str.length + 1);
}
