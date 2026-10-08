import path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { loadAllMatrices, updateCaseResult } from './trace-matrix.js';

/**
 * framework-run.ts —— 业务测试调度层（借宿主框架之手执行）
 *
 * 边界哲学：SpecTest 不内置业务测试运行时，但让调度像内置一样顺滑。
 * 流程：探测宿主框架（vitest/jest/playwright/pytest）→ 组装命令 → 执行 →
 * 解析输出中携带 caseId 的测试名 → 结果归一 → 回填矩阵。
 *
 * 无宿主框架时如实报「未接入」，绝不模拟通过率。
 */

export const CASE_ID_RE = /TS-[a-z0-9-]+-[a-z0-9-]+-(?:(?:unit|integration|e2e|performance|security)-AC-\d{3}|api-EP-\d{3})/;

export interface FrameworkRunOptions {
  projectRoot: string;
  iteration: string;
  /** 只跑指定套件（过滤测试文件/用例） */
  suiteId?: string;
  /** 附加参数透传（如 --update） */
  extraArgs?: string[];
  /** 执行超时（毫秒） */
  timeoutMs?: number;
}

export interface FrameworkRunResult {
  /** 探测到的宿主框架 */
  framework: string | null;
  /** 执行命令 */
  command: string | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** 未解析到 caseId 的测试（如实报告，不脑补归属） */
  unmatched: number;
  failures: { caseId: string; reason: string }[];
  outputTail: string;
}

interface DetectedFramework {
  name: string;
  command: string;
  args: string[];
  testDir: string;
}

/**
 * 探测宿主框架：读 package.json 依赖 + 测试目录
 */
export function detectFramework(projectRoot: string): DetectedFramework | null {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
  try {
    pkg = fs.readJsonSync(pkgPath);
  } catch {
    return null;
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  const pickTestDir = (candidates: string[]): string =>
    candidates.find((d) => fs.existsSync(path.join(projectRoot, d))) ?? '';

  if (deps['vitest'] || pkg.scripts?.test?.includes('vitest')) {
    // verbose reporter：默认 reporter 只输出文件级汇总，测试名（携带 caseId）解析不到
    return { name: 'vitest', command: 'npx', args: ['vitest', 'run', '--reporter=verbose'], testDir: pickTestDir(['tests', 'src', 'test']) };
  }
  if (deps['@playwright/test'] || deps['playwright']) {
    return { name: 'playwright', command: 'npx', args: ['playwright', 'test'], testDir: pickTestDir(['tests', 'e2e']) };
  }
  if (deps['jest']) {
    return { name: 'jest', command: 'npx', args: ['jest'], testDir: pickTestDir(['tests', '__tests__', 'src']) };
  }
  if (deps['pytest']) {
    return { name: 'pytest', command: 'pytest', args: [], testDir: pickTestDir(['tests', 'test']) };
  }
  return null;
}

/**
 * 调度宿主框架执行，解析输出回填矩阵
 */
export async function runFrameworkTests(options: FrameworkRunOptions): Promise<FrameworkRunResult> {
  const { projectRoot, iteration, suiteId, extraArgs = [], timeoutMs = 120000 } = options;

  const framework = detectFramework(projectRoot);
  const result: FrameworkRunResult = {
    framework: framework?.name ?? null,
    command: null,
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    unmatched: 0,
    failures: [],
    outputTail: '',
  };

  if (!framework) {
    return result; // 未接入：framework=null，命令层如实报告
  }

  const args = [...framework.args, ...(framework.testDir ? [framework.testDir] : []), ...extraArgs];
  result.command = [framework.command, ...args].join(' ');

  const output = await executeCommand(framework.command, args, projectRoot, timeoutMs);
  result.outputTail = output.slice(-2000);

  // 解析输出中的 caseId 与状态
  const parsed = parseCaseOutcomes(output);

  // 与矩阵登记的用例对齐（矩阵是唯一事实）
  const matrices = loadAllMatrices(projectRoot, iteration);
  const registered = new Map<string, { platform: string; unitSlug: string }>();
  for (const m of matrices) {
    if (suiteId) {
      // 套件过滤：只回填该套件的用例（套件 ID 前缀 = TS-{端}-{单元}-{类型}，用例 ID 以其为前缀）
      for (const c of m.cases) {
        if (c.caseId.startsWith(`${suiteId}-`)) registered.set(c.caseId, { platform: m.platform, unitSlug: m.unitSlug });
      }
    } else {
      for (const c of m.cases) {
        registered.set(c.caseId, { platform: m.platform, unitSlug: m.unitSlug });
      }
    }
  }

  for (const [caseId, outcome] of parsed) {
    const reg = registered.get(caseId);
    if (!reg) {
      result.unmatched++;
      continue;
    }
    result.total++;
    if (outcome === 'passed') result.passed++;
    else if (outcome === 'skipped') result.skipped++;
    else {
      result.failed++;
      result.failures.push({ caseId, reason: '宿主框架判定失败' });
    }
    updateCaseResult(
      projectRoot, iteration, reg.platform, reg.unitSlug, caseId,
      outcome === 'passed' ? 'passed' : outcome === 'skipped' ? 'skipped' : 'failed',
      outcome === 'passed' ? '宿主框架通过' : outcome === 'skipped' ? '宿主框架跳过' : '宿主框架失败'
    );
  }

  return result;
}

/** 执行命令并捕获合并输出（超时 kill） */
function executeCommand(
  command: string, args: string[], cwd: string, timeoutMs: number
): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, env: { ...process.env } });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      out += `\n[SPECTEST] 启动失败: ${e.message}`;
      resolve(out);
    });
  });
}

/**
 * 从框架输出解析用例结果
 *
 * 协议约定（relay-prompt 端模板）：AI 生成的框架测试，测试名必须携带
 * 幂等 caseId（如 `test('TS-h5-mobile-booking-unit-AC-001 预订成功', ...)`）。
 * 解析器按「状态前缀 + 名称」行匹配，兼容 vitest/jest/pytest 的 verbose 输出：
 *   ✓ TS-...  /  √ TS-... / passed · TS-... / PASS TS-...
 *   ✗ TS-...  /  × TS-... / FAIL TS-... / ✕ TS-...
 *   - TS-...  /  skipped TS-...
 */
export function parseCaseOutcomes(output: string): Map<string, 'passed' | 'failed' | 'skipped'> {
  const map = new Map<string, 'passed' | 'failed' | 'skipped'>();
  const lines = output.split('\n');

  for (const line of lines) {
    const m = line.match(CASE_ID_RE);
    if (!m) continue;
    const caseId = m[0];
    // 剥离 ANSI 颜色转义：verbose 输出行首是 ESC 序列而非 ✓，不剥离则状态判定全失
    const t = line.replace(/\u001b\[[0-9;]*m/g, '').trim();

    let status: 'passed' | 'failed' | 'skipped' | null = null;
    if (/^[✓√✔]|passed|PASS|\.ok\b/i.test(t) && !/fail/i.test(t)) status = 'passed';
    else if (/^[✗×✕]|fail|FAIL|✘|error/i.test(t)) status = 'failed';
    else if (/^[-–]|skip|SKIP|pending|todo/i.test(t)) status = 'skipped';

    if (status) map.set(caseId, status);
  }
  return map;
}
