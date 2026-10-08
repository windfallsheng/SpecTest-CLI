import path from 'path';
import { logger } from '../utils/logger.js';
import { i18n } from '../i18n/index.js';
import { loadContext, findProjectRoot } from '../core/context.js';
import { aggregateIterationMetrics } from '../core/metrics.js';

export interface StatusOptions {
  iteration?: string;
}

/**
 * 查看测试状态
 * 度量收敛于矩阵：套件/用例/执行/覆盖全部来自 metrics 聚合层，
 * 不再扫描平铺目录或解析历史报告。
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
    const m = aggregateIterationMetrics(projectRoot, iteration);
    console.log(`│  当前期次  │  ${iteration.padEnd(26)} │`);
    console.log('├──────────────────────────────────────────────┤');
    console.log(`│  功能单元  │  ${String(m.totalUnits).padEnd(26)} │`);
    console.log(`│  测试套件  │  ${String(m.totalSuites).padEnd(26)} │`);
    console.log(`│  测试用例  │  ${String(m.totalCases).padEnd(26)} │`);
    console.log(`│  已执行    │  ${String(m.executedCases).padEnd(26)} │`);
    console.log(`│  通过      │  ${String(m.passedCases).padEnd(26)} │`);
    console.log(`│  失败      │  ${String(m.failedCases).padEnd(26)} │`);
    console.log(`│  通过率    │  ${(m.passRate === null ? '-' : `${m.passRate}%`).padEnd(26)} │`);
    console.log(`│  覆盖率    │  ${(m.coverageRate === null ? '-' : `${m.coverageRate}%`).padEnd(26)} │`);
    console.log(`│  P0 通过   │  ${`${m.p0.passed}/${m.p0.total}`.padEnd(26)} │`);
    console.log(`│  未修缺陷  │  ${String(m.bugs.open).padEnd(26)} │`);
    console.log('├──────────────────────────────────────────────┤');
    console.log(`│  规格缺口  │  ${String(m.specGaps).padEnd(26)} │`);
    console.log(`│  漂移套件  │  ${String(m.driftSuites).padEnd(26)} │`);
    console.log('└──────────────────────────────────────────────┘');
  } else {
    console.log(`│  当前期次  │  ${'未设置'.padEnd(26)} │`);
    console.log('└──────────────────────────────────────────────┘');
  }
  console.log('');
}
