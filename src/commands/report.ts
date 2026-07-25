import path from 'path';
import fs from 'fs-extra';
import { Spinner, logger } from '../utils/logger.js';
import { i18n } from '../i18n/index.js';
import { ensureProjectRoot, loadContext, getTestDir, getSuiteDir } from '../core/context.js';

export interface ReportOptions {
  iteration?: string;
  suite?: string;
  output?: string;
}

/**
 * 生成测试报告
 */
export async function reportCommand(options: ReportOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest report --iteration Q1');
    process.exit(1);
  }

  const spinner = new Spinner(i18n.t('cmd.report.start'));
  spinner.start();

  try {
    const reportContent = generateTestReport(projectRoot, iteration, options.suite);

    const outputDir = options.output || path.join(projectRoot, '.spectest', 'reports');
    fs.ensureDirSync(outputDir);

    const reportPath = path.join(outputDir, `test-report-${iteration}-${Date.now()}.md`);
    fs.writeFileSync(reportPath, reportContent, 'utf-8');

    spinner.stop(i18n.t('cmd.report.success', { path: reportPath }));
  } catch (error) {
    spinner.fail(`生成报告失败：${error}`);
    throw error;
  }
}

/**
 * 生成完整的测试报告
 */
function generateTestReport(projectRoot: string, iteration: string, suiteId?: string): string {
  let md = `# 测试报告 - ${iteration}\n\n`;
  md += `> 生成时间：${new Date().toISOString()}\n\n`;

  const testDir = getTestDir(projectRoot, iteration);
  if (!fs.existsSync(testDir)) {
    md += '⚠️ 该期次暂无测试数据。\n';
    return md;
  }

  // 统计所有套件
  let totalSuites = 0;
  let totalCases = 0;
  const suiteEntries = fs.readdirSync(testDir, { withFileTypes: true });

  md += `## 概览\n\n`;
  md += `| 指标 | 值 |\n`;
  md += `|------|----|\n`;

  for (const entry of suiteEntries) {
    if (!entry.isDirectory()) continue;
    if (suiteId && entry.name !== suiteId) continue;

    totalSuites++;
    const suiteDir = getSuiteDir(projectRoot, iteration, entry.name);
    const casesDir = path.join(suiteDir, 'cases');

    if (fs.existsSync(casesDir)) {
      const caseFiles = fs.readdirSync(casesDir);
      totalCases += caseFiles.length;
    }

    // 读取套件信息
    const suiteYaml = path.join(suiteDir, 'SUITE.yaml');
    if (fs.existsSync(suiteYaml)) {
      const content = fs.readFileSync(suiteYaml, 'utf-8');
      const nameMatch = content.match(/name:\s*(.+)/);
      const typeMatch = content.match(/type:\s*(.+)/);

      md += `## 套件：${nameMatch ? nameMatch[1].trim() : entry.name}\n\n`;
      md += `- **类型**：${typeMatch ? typeMatch[1].trim() : 'N/A'}\n`;
      md += `- **ID**：${entry.name}\n\n`;

      // 列出用例
      if (fs.existsSync(casesDir)) {
        const caseFiles = fs.readdirSync(casesDir);
        md += `### 测试用例 (${caseFiles.length})\n\n`;
        md += `| ID | 名称 | 优先级 |\n`;
        md += `|----|------|--------|\n`;

        for (const file of caseFiles) {
          if (!file.endsWith('.yaml')) continue;
          const caseContent = fs.readFileSync(path.join(casesDir, file), 'utf-8');
          const idMatch = caseContent.match(/id:\s*(.+)/);
          const nameMatch = caseContent.match(/name:\s*(.+)/);
          const priorityMatch = caseContent.match(/priority:\s*(.+)/);

          md += `| ${idMatch ? idMatch[1].trim() : file} | ${nameMatch ? nameMatch[1].trim() : '-'} | ${priorityMatch ? priorityMatch[1].trim() : '-'} |\n`;
        }
        md += '\n';
      }
    }
  }

  md += `| 测试套件 | ${totalSuites} |\n`;
  md += `| 测试用例 | ${totalCases} |\n`;

  return md;
}
