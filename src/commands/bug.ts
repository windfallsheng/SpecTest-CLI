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

export interface BugCloseOptions {
  bugId: string;
}

export interface BugListOptions {
  iteration?: string;
  status?: string;
}

/**
 * 缺陷双类：创建（测试失败 → 记录缺陷）+ 关闭（修复后闭环）
 * 生命周期：open → closed；INDEX.md 幂等重建（从 json 事实反推，不追加幽灵行）。
 */
export async function bugCommand(options: BugOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest bug -i <期次> -c <用例ID> -t "标题"');
    process.exit(1);
  }

  if (!options.caseId) {
    logger.error('请指定失败的测试用例 ID，如：--case-id TS-xxx-AC-001');
    process.exit(1);
  }

  if (!options.title) {
    logger.error('请指定缺陷标题，如：--title "金额精度丢失"');
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

    // 幂等重建缺陷索引
    rebuildBugIndex(bugsDir);

    spinner.stop(`缺陷已创建：${bug.id}`);

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

/** 关闭缺陷：open → closed（修复闭环） */
export async function closeBugCommand(options: BugCloseOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const bugsDir = path.join(projectRoot, '.spectest', 'bugs');

  const bugFile = resolveBugFile(bugsDir, options.bugId);
  if (!bugFile) {
    logger.error(`未找到缺陷：${options.bugId}`);
    process.exit(1);
  }

  const bugPath = path.join(bugsDir, bugFile);
  const bug = fs.readJsonSync(bugPath);

  if (bug.status === 'closed') {
    logger.warn(`缺陷 ${bug.id} 已是 closed 状态，无需重复关闭。`);
    return;
  }

  bug.status = 'closed';
  bug.updatedAt = new Date().toISOString();
  fs.writeJsonSync(bugPath, bug, { spaces: 2 });
  rebuildBugIndex(bugsDir);

  logger.info(`缺陷已关闭：${bug.id}（${bug.title}）`);
  console.log('');
  console.log('🔓 缺陷关闭后，gate 的「未修复缺陷」检查将不再拦截。');
  console.log('');
}

/** 缺陷清单（按状态过滤，默认 open） */
export async function listBugsCommand(options: BugListOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const bugsDir = path.join(projectRoot, '.spectest', 'bugs');
  if (!fs.existsSync(bugsDir)) {
    logger.info('暂无缺陷记录。');
    return;
  }

  const filter = options.status || 'open';
  const bugs: { id: string; severity: string; title: string; caseId: string; status: string; iteration?: string; createdAt?: string }[] = [];

  for (const f of fs.readdirSync(bugsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const bug = fs.readJsonSync(path.join(bugsDir, f));
      if (filter !== 'all' && bug.status !== filter) continue;
      bugs.push(bug);
    } catch { /* 忽略损坏记录 */ }
  }

  bugs.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

  console.log('');
  console.log(`┌────────────────────────────────────────────────────────────┐`);
  console.log(`│  🐛 缺陷清单（${filter}）`.padEnd(60) + '│');
  console.log('├────────────────────────────────────────────────────────────┤');
  if (bugs.length === 0) {
    console.log(`│  无匹配缺陷`.padEnd(60) + '│');
  }
  for (const bug of bugs) {
    const line = `│  ${bug.id.padEnd(18)} [${bug.severity.padEnd(6)}] ${truncateTitle(bug.title, 22)}`;
    console.log(line.padEnd(60) + '│');
    console.log(`│     用例 ${bug.caseId}${bug.iteration ? ' · ' + bug.iteration : ''}`.padEnd(60) + '│');
  }
  console.log('└────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('关闭缺陷：spectest bug close <BUG-ID>');
  console.log('');
}

/** 幂等重建缺陷索引（从 json 事实反推，杜绝幽灵行） */
function rebuildBugIndex(bugsDir: string): void {
  const bugs: { id: string; severity: string; title: string; caseId: string; status: string }[] = [];
  for (const f of fs.readdirSync(bugsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      bugs.push(fs.readJsonSync(path.join(bugsDir, f)));
    } catch { /* 忽略损坏记录 */ }
  }
  bugs.sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''));

  let md = '# 缺陷索引\n\n| ID | 严重程度 | 标题 | 关联用例 | 状态 |\n|----|----------|------|----------|------|\n';
  for (const b of bugs) {
    md += `| ${b.id} | ${b.severity} | ${(b.title ?? '').replace(/\|/g, '\\|')} | ${b.caseId ?? '-'} | ${b.status} |\n`;
  }
  fs.writeFileSync(path.join(bugsDir, 'INDEX.md'), md, 'utf-8');
}

/** 按 ID 或文件名解析缺陷文件 */
function resolveBugFile(bugsDir: string, bugId: string): string | null {
  if (fs.existsSync(path.join(bugsDir, `${bugId}.json`))) return `${bugId}.json`;
  if (fs.existsSync(path.join(bugsDir, bugId))) return bugId;
  for (const f of fs.readdirSync(bugsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const bug = fs.readJsonSync(path.join(bugsDir, f));
      if (bug.id === bugId) return f;
    } catch { /* 忽略 */ }
  }
  return null;
}

function truncateTitle(title: string, len: number): string {
  if (title.length <= len) return title.padEnd(len);
  return title.substring(0, len - 1) + '.';
}
