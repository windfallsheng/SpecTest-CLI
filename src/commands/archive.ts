import path from 'path';
import fs from 'fs-extra';
import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext, getTestDir } from '../core/context.js';

export interface ArchiveOptions {
  iteration?: string;
}

/**
 * 测试用例归档
 * 迭代结束后，将测试用例归档到知识库
 */
export async function archiveCommand(options: ArchiveOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest archive --iteration Q1');
    process.exit(1);
  }

  const spinner = new Spinner('正在归档测试数据...');
  spinner.start();

  try {
    const testDir = getTestDir(projectRoot, iteration);
    if (!fs.existsSync(testDir)) {
      spinner.fail(`期次 ${iteration} 没有测试数据`);
      return;
    }

    // 1. 创建归档目录
    const archiveDir = path.join(projectRoot, '.spectest', 'archive', iteration);
    fs.ensureDirSync(archiveDir);

    // 2. 复制测试套件
    const suiteDirs = fs.readdirSync(testDir, { withFileTypes: true });
    let archivedSuites = 0;
    let archivedCases = 0;

    for (const sDir of suiteDirs) {
      if (!sDir.isDirectory()) continue;
      archivedSuites++;

      const sourceDir = path.join(testDir, sDir.name);
      const targetDir = path.join(archiveDir, sDir.name);

      // 跳过 runs 目录（执行记录不归档）
      fs.copySync(sourceDir, targetDir, {
        filter: (src: string) => !src.includes('/runs/') && !src.endsWith('/runs'),
      });

      const casesDir = path.join(sourceDir, 'cases');
      if (fs.existsSync(casesDir)) {
        archivedCases += fs.readdirSync(casesDir).length;
      }
    }

    // 3. 生成归档索引
    generateArchiveIndex(archiveDir, iteration, archivedSuites, archivedCases);

    spinner.stop(`✅ 归档完成：${archivedSuites} 个套件，${archivedCases} 个用例`);

    console.log('');
    console.log('┌──────────────────────────────────────────┐');
    console.log('│       📦 归档结果                       │');
    console.log('├──────────────────────────────────────────┤');
    console.log(`│  期次      │  ${iteration.padEnd(20)} │`);
    console.log(`│  测试套件  │  ${String(archivedSuites).padEnd(20)} │`);
    console.log(`│  测试用例  │  ${String(archivedCases).padEnd(20)} │`);
    console.log(`│  归档位置  │  .spectest/archive/${iteration.padEnd(10)} │`);
    console.log('└──────────────────────────────────────────┘');
    console.log('');
  } catch (error) {
    spinner.fail(`归档失败：${error}`);
    throw error;
  }
}

function generateArchiveIndex(
  archiveDir: string,
  iteration: string,
  suites: number,
  cases: number
): void {
  let md = `# 测试归档索引 - ${iteration}\n\n`;
  md += `> 归档时间：${new Date().toISOString()}\n\n`;
  md += `## 概览\n\n`;
  md += `| 指标 | 值 |\n`;
  md += `|------|----|\n`;
  md += `| 测试套件 | ${suites} |\n`;
  md += `| 测试用例 | ${cases} |\n\n`;
  md += `## 套件列表\n\n`;

  const suiteDirs = fs.readdirSync(archiveDir, { withFileTypes: true });
  for (const sDir of suiteDirs) {
    if (!sDir.isDirectory()) continue;
    const casesDir = path.join(archiveDir, sDir.name, 'cases');
    const caseCount = fs.existsSync(casesDir)
      ? fs.readdirSync(casesDir).length
      : 0;
    md += `- **${sDir.name}**（${caseCount} 个用例）\n`;
  }

  fs.writeFileSync(path.join(archiveDir, 'INDEX.md'), md);
}
