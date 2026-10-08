import path from 'path';
import fs from 'fs-extra';

/**
 * 测试上下文接口
 * 管理当前测试项目状态，存储在 .spectest/local/context.json
 */
export interface TestContext {
  /** 当前期次 */
  currentIteration: string;
  /** 当前测试套件 */
  currentSuite: string;
  /** 项目根目录 */
  projectRoot: string;
  /** 上次更新时间 */
  lastUpdated: string;
  /** 最后执行的操作 */
  lastAction: string;
  /** 总套件数 */
  totalSuites: number;
  /** 总用例数 */
  totalCases: number;
  /** 通过率 */
  passRate: number;
  /** 覆盖缺口数 */
  gapCount: number;
  /** 操作历史 */
  history: ContextHistoryEntry[];
}

export interface ContextHistoryEntry {
  action: string;
  timestamp: string;
  details: string;
}

/**
 * 默认上下文
 */
const DEFAULT_CONTEXT: TestContext = {
  currentIteration: '',
  currentSuite: '',
  projectRoot: '',
  lastUpdated: '',
  lastAction: '',
  totalSuites: 0,
  totalCases: 0,
  passRate: 0,
  gapCount: 0,
  history: [],
};

/**
 * 项目根目录标记文件
 */
const PROJECT_MARKER = '.spectest';

/**
 * 查找项目根目录（向上查找 .spectest 目录）
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    if (fs.existsSync(path.join(current, PROJECT_MARKER))) {
      return current;
    }
    current = path.dirname(current);
  }

  // 如果在 SpecCore 项目中，也可以工作
  if (fs.existsSync(path.join(startDir, '.speccore'))) {
    return startDir;
  }

  return null;
}

/**
 * 确保在 SpecTest 项目根目录中执行
 */
export function ensureProjectRoot(): string {
  const root = findProjectRoot();
  if (!root) {
    throw new Error(
      '未找到 .spectest 项目配置。请先运行 spectest init 初始化测试项目。\n' +
      '如果已在 SpecCore 项目中，SpecTest 也会自动识别 .speccore 目录。'
    );
  }
  return root;
}

/**
 * 加载测试上下文
 */
export function loadContext(projectRoot?: string): TestContext {
  const root = projectRoot || ensureProjectRoot();
  const contextPath = path.join(root, PROJECT_MARKER, 'local', 'context.json');

  if (fs.existsSync(contextPath)) {
    try {
      const data = fs.readJsonSync(contextPath);
      return { ...DEFAULT_CONTEXT, ...data };
    } catch {
      return { ...DEFAULT_CONTEXT, projectRoot: root };
    }
  }

  return { ...DEFAULT_CONTEXT, projectRoot: root };
}

/**
 * 保存测试上下文
 */
export function saveContext(context: TestContext): void {
  const localDir = path.join(context.projectRoot, PROJECT_MARKER, 'local');
  fs.ensureDirSync(localDir);

  const contextPath = path.join(localDir, 'context.json');
  context.lastUpdated = new Date().toISOString();
  fs.writeJsonSync(contextPath, context, { spaces: 2 });
}

/**
 * 更新测试上下文
 */
export function updateContext(updates: Partial<TestContext>): TestContext {
  const context = loadContext();
  const updated = { ...context, ...updates };
  saveContext(updated);
  return updated;
}

/**
 * 记录操作历史（最多保留 100 条）
 */
export function recordHistory(context: TestContext, action: string, details: string): void {
  context.history.push({
    action,
    timestamp: new Date().toISOString(),
    details,
  });

  // 限制历史记录数量
  if (context.history.length > 100) {
    context.history = context.history.slice(-100);
  }

  context.lastAction = action;
  saveContext(context);
}

/**
 * @deprecated 旧平铺测试目录（.spectest/tests/{迭代}/）
 * 新端优先目录为 .spectest/iterations/{迭代}/{端}/{单元}/suites/，
 * 请改用 trace-matrix.getIterationDir + suite-skeleton.getSuiteDir（五参）。
 * Step 6/7 迁移 status/report/archive/gate/summary 后删除本函数。
 */
export function getTestDir(projectRoot: string, iteration: string): string {
  return path.join(projectRoot, PROJECT_MARKER, 'tests', iteration);
}

/**
 * @deprecated 旧三参平铺套件目录。
 * 请改用 suite-skeleton.getSuiteDir(projectRoot, iteration, platform, unitSlug, suiteId)。
 */
export function getSuiteDir(projectRoot: string, iteration: string, suiteId: string): string {
  return path.join(getTestDir(projectRoot, iteration), suiteId);
}
