import path from 'path';
import fs from 'fs-extra';
import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext } from '../core/context.js';

export interface BugOptions {
  iteration?: string;
  caseId: string;
  severity?: 'high' | 'medium' | 'low';
  title: string;
  description?: string;
}

/**
 * 缺陷提交
 * 测试失败 → 创建 bugfix Task 关联到 spec-core
 */
export async function bugCommand(options: BugOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest bug --iteration Q1 --case TC-001 --title "金额精度丢失"');
    process.exit(1);
  }

  if (!options.caseId) {
    logger.error('请指定失败的测试用例 ID，如：--case TC-001');
    process.exit(1);
  }

  const spinner = new Spinner('正在创建缺陷记录...');
  spinner.start();

  try {
    const bug = {
      id: `BUG-${Date.now()}`,
      caseId: options.caseId,
      severity: options.severity || 'medium',
      title: options.title,
      description: options.description || '',
      iteration,
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRoot,
    };

    // 保存缺陷到 .spectest/bugs/
    const bugsDir = path.join(projectRoot, '.spectest', 'bugs');
    fs.ensureDirSync(bugsDir);

    const bugPath = path.join(bugsDir, `${bug.id}.json`);
    fs.writeJsonSync(bugPath, bug, { spaces: 2 });

    // 更新缺陷索引
    const indexPath = path.join(bugsDir, 'INDEX.md');
    updateBugIndex(indexPath, bug);

    spinner.stop(`✅ 缺陷已创建：${bug.id}`);

    console.log('');
    console.log('┌──────────────────────────────────────────┐');
    console.log('│       🐛 缺陷已记录                     │');
    console.log('├──────────────────────────────────────────┤');
    console.log(`│  ID         │  ${bug.id.padEnd(20)} │`);
    console.log(`│  严重程度   │  ${bug.severity.padEnd(20)} │`);
    console.log(`│  关联用例   │  ${bug.caseId.padEnd(20)} │`);
    console.log(`│  标题       │  ${truncateTitle(bug.title, 20)} │`);
    console.log('└──────────────────────────────────────────┘');

    console.log('');
    console.log('📋 下一步：');
    console.log(`  在 spec-core 中创建 bugfix Task：`);
    console.log(`  speccore bugfix --title "${options.title}" --iteration ${iteration}`);
    console.log('');
  } catch (error) {
    spinner.fail(`创建缺陷失败：${error}`);
    throw error;
  }
}

function updateBugIndex(indexPath: string, bug: Record<string, unknown>): void {
  let index = '';
  if (fs.existsSync(indexPath)) {
    index = fs.readFileSync(indexPath, 'utf-8');
  } else {
    index = '# 缺陷索引\n\n| ID | 严重程度 | 标题 | 关联用例 | 状态 |\n|----|----------|------|----------|------|\n';
  }

  const row = `| ${bug.id} | ${bug.severity} | ${bug.title} | ${bug.caseId} | ${bug.status} |\n`;
  fs.appendFileSync(indexPath, row);
}

function truncateTitle(title: string, len: number): string {
  if (title.length <= len) return title.padEnd(len);
  return title.substring(0, len - 1) + '.';
}
