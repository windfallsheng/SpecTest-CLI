import path from 'path';
import fs from 'fs-extra';
import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext } from '../core/context.js';
import { getIterationDir, getGlobalCasesRoot, loadAllMatrices } from '../core/trace-matrix.js';
import { aggregateIterationMetrics } from '../core/metrics.js';

export interface ArchiveOptions {
  iteration?: string;
}

/**
 * 测试数据归档
 * 迭代结束后将端优先目录（矩阵 + 套件 + 执行记录）快照到知识库，
 * 随附 ARCHIVE_METRICS.json（归档时刻的度量事实，供趋势回溯）。
 */
export async function archiveCommand(options: ArchiveOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest archive --iteration Q1');
    process.exit(1);
  }

  const iterDir = getIterationDir(projectRoot, iteration);
  if (!fs.existsSync(iterDir)) {
    logger.error(`期次 ${iteration} 没有测试数据（.spectest/iterations/${iteration} 不存在）`);
    process.exit(1);
  }

  const spinner = new Spinner('正在归档测试数据...');
  spinner.start();

  try {
    const archiveDir = path.join(projectRoot, '.spectest', 'archive', iteration);

    // 快照语义：幂等覆盖（重跑归档 = 刷新快照）
    fs.removeSync(archiveDir);
    fs.ensureDirSync(archiveDir);
    fs.copySync(iterDir, archiveDir);

    // 快照随附该期次涉及单元的全量层用例（GLOBAL/cases 是活资产，归档带用例才自洽）
    const matrices = loadAllMatrices(projectRoot, iteration);
    for (const m of matrices) {
      const src = path.join(getGlobalCasesRoot(projectRoot), m.platform, m.unitSlug);
      if (fs.existsSync(src)) {
        fs.copySync(src, path.join(archiveDir, 'GLOBAL-cases', m.platform, m.unitSlug));
      }
    }

    // 归档时刻的度量事实快照
    const metrics = aggregateIterationMetrics(projectRoot, iteration);
    fs.writeJsonSync(path.join(archiveDir, 'ARCHIVE_METRICS.json'), {
      archivedAt: new Date().toISOString(),
      metrics,
    }, { spaces: 2 });

    spinner.stop('');

    console.log('');
    console.log('┌──────────────────────────────────────────┐');
    console.log('│       📦 归档结果                       │');
    console.log('├──────────────────────────────────────────┤');
    console.log(`│  期次      │  ${iteration.padEnd(20)} │`);
    console.log(`│  功能单元  │  ${String(metrics.totalUnits).padEnd(20)} │`);
    console.log(`│  测试套件  │  ${String(metrics.totalSuites).padEnd(20)} │`);
    console.log(`│  测试用例  │  ${String(metrics.totalCases).padEnd(20)} │`);
    console.log(`│  通过率    │  ${(metrics.passRate === null ? '-' : `${metrics.passRate}%`).padEnd(20)} │`);
    console.log(`│  覆盖率    │  ${(metrics.coverageRate === null ? '-' : `${metrics.coverageRate}%`).padEnd(20)} │`);
    console.log(`│  归档位置  │  .spectest/archive/${iteration.padEnd(10)} │`);
    console.log('└──────────────────────────────────────────┘');
    console.log('');
  } catch (error) {
    spinner.fail(`归档失败：${error}`);
    throw error;
  }
}
