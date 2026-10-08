import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import { ensureProjectRoot, updateContext } from '../core/context.js';
import { runFrameworkTests } from '../core/framework-run.js';
import { runStaticVerify } from '../core/static-verify.js';
import { runContractMatrix } from '../core/contract-runner.js';
import { loadConfig } from '../core/config.js';
import { loadAllMatrices, getIterationDir, getGlobalCasesRoot } from '../core/trace-matrix.js';
import { listIterationsWithData } from '../core/metrics.js';
import { TestRunSchema, type TestRun } from '../core/schemas/test-suite.schema.js';

export interface RunOptions {
  iteration?: string;
  suite?: string;
  /** 兼容保留：run 默认即流水线（三层链），显式声明无行为差异 */
  pipeline?: boolean;
  /** 契约执行环境（--pipeline 时生效，缺省取 config.pipeline.defaultEnv；逗号分隔 = 环境矩阵） */
  env?: string;
  /** 优先级过滤（high = P0，只作用于契约层；宿主框架层用 --args 透传） */
  priority?: 'high' | 'medium' | 'low';
  /** 用例级过滤（幂等 caseId 逗号分隔，只作用于契约层） */
  case?: string;
  /** 失败重试次数（契约层，默认 0） */
  retry?: string;
  /** 人机交互模式（--pipeline 时生效，缺省取 config.pipeline.interactive） */
  interactive?: boolean;
  /** 附加参数透传宿主框架 */
  extraArgs?: string[];
}

/**
 * 执行测试流水线
 *
 * run 就是流水线执行器（与 speccore run 同构）：三层链 静态验证 → 契约执行 → 宿主框架，
 * 先轻后重、失败即停。默认全自动推进；--interactive 或 config.pipeline.interactive 时每层确认。
 * 单层需求自然表达：契约层无环境配置自动跳过，verify 零成本，--suite 透传层 3。
 */
export async function runCommand(options: RunOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  // 无参 = 全量回归（跨期次）；指定 -i = 单期次流水线。不 fallback 当前期次
  // （context.currentIteration 只反映最近一次 gen/run，不能替用户决定回归范围）
  const iteration = options.iteration;

  // ── 全量回归：未指定期次时跨期次逐期推进三层链（用例资产全量层、事实按期次回填） ──
  if (!iteration) {
    const iterations = listIterationsWithData(projectRoot);
    if (iterations.length === 0) {
      logger.error('没有可回归的测试数据：请先 spectest init / gen 生成用例');
      process.exit(1);
    }
    logger.info(`⚙️  全量回归：共 ${iterations.length} 个期次，逐期推进三层链`);
    let allOk = true;
    for (const iter of iterations) {
      console.log('');
      logger.info(`── 期次 ${iter} ──`);
      const ok = await runPipeline(projectRoot, iter, { ...options, interactive: false });
      updateContext({ currentIteration: iter, lastAction: `run:${iter}` });
      if (!ok) allOk = false;
    }
    console.log('');
    if (!allOk) process.exitCode = 1;
    return;
  }

  // 套件存在性检查（全量层用例库扫描，--suite 透传层 3 宿主框架）
  if (options.suite) {
    const exists = suiteExists(projectRoot, iteration, options.suite);
    if (!exists) {
      logger.error(`未找到测试套件：${options.suite}`);
      process.exit(1);
    }
  }

  const ok = await runPipeline(projectRoot, iteration, options);
  updateContext({ currentIteration: iteration, lastAction: `run:${iteration}` });
  if (!ok) process.exitCode = 1;
}

/** 三层链：先轻后重，失败即停；双模式（--interactive 或 config.pipeline.interactive） */
async function runPipeline(projectRoot: string, iteration: string, options: RunOptions): Promise<boolean> {
  const config = loadConfig(projectRoot);
  const interactive = options.interactive ?? config.pipeline.interactive;

  console.log('');
  logger.info(interactive
    ? '⚙️  流水线三层链（人机交互）：静态验证 → 契约执行 → 宿主框架'
    : '⚙️  流水线三层链（全自动）：静态验证 → 契约执行 → 宿主框架');
  console.log('');

  // 层 1：静态验证（零成本，先拦）
  if (interactive && !(await askConfirm('执行 层 1/3 静态验证？'))) {
    logger.warn('用户终止流水线。');
    return false;
  }
  const verify = runStaticVerify(projectRoot, iteration);
  console.log('┌─ 层 1/3 静态验证 ─────────────────────────┐');
  console.log(`│  ${verify.passed ? '✅ 通过' : '❌ 未通过'}（${verify.errorCount} error / ${verify.warningCount} warning）`.padEnd(42) + '│');
  console.log('└───────────────────────────────────────────┘');
  if (!verify.passed) {
    if (interactive) {
      if (!(await askConfirm('静态验证未通过，仍继续 层 2？', false))) {
        logger.warn('用户终止流水线（静态验证未通过）。');
        return false;
      }
    } else {
      logger.error('静态验证未通过，流水线终止（先修复 error 再跑）。');
      return false;
    }
  }

  // 层 2：契约执行（真 HTTP，有环境配置才跑；逗号分隔 --env = 环境矩阵逐行推进）
  if (interactive && !(await askConfirm('执行 层 2/3 契约执行？'))) {
    logger.warn('用户跳过契约层。');
  } else {
    const envs = (options.env || config.pipeline.defaultEnv).split(',').map((e) => e.trim()).filter(Boolean);
    const caseIds = options.case?.split(',').map((c) => c.trim()).filter(Boolean);
    const retry = options.retry !== undefined ? Math.max(0, parseInt(options.retry, 10) || 0) : 0;
    const entries = await runContractMatrix({
      projectRoot,
      iteration,
      envs,
      priority: options.priority,
      caseIds,
      retry,
    });
    const executed = entries.filter((e) => e.result.total > 0);
    if (executed.length > 0) {
      console.log('┌─ 层 2/3 契约执行 ─────────────────────────┐');
      for (const e of executed) {
        const c = e.result;
        console.log(`│  环境 ${e.env}：${c.passed}/${c.total}  通过，${c.failed} 失败`.padEnd(42) + '│');
      }
      console.log('└───────────────────────────────────────────┘');
      const totalFailed = executed.reduce((s, e) => s + e.result.failed, 0);
      if (totalFailed > 0) {
        if (interactive) {
          if (!(await askConfirm('契约执行失败，仍继续 层 3？', false))) {
            logger.warn('用户终止流水线（契约执行失败）。');
            return false;
          }
        } else {
          logger.error('契约执行失败，流水线终止。');
          return false;
        }
      }
    } else {
      for (const e of entries) {
        if (e.result.skippedReasons.length > 0) {
          logger.warn(`契约层跳过（${e.env}）：${e.result.skippedReasons[0]}`);
        }
      }
    }
  }

  // 层 3：宿主框架
  if (interactive && !(await askConfirm('执行 层 3/3 宿主框架测试？'))) {
    logger.warn('用户跳过宿主框架层。');
    console.log('');
    return true;
  }
  const framework = await runFrameworkTests({
    projectRoot,
    iteration,
    suiteId: options.suite,
    extraArgs: options.extraArgs,
  });
  displayFrameworkResult(framework);
  saveRunRecord(projectRoot, iteration, framework);

  // 未接入宿主框架不算绿（防假绿：三层链只跑了前两层时如实报非零）
  return framework.framework !== null && framework.failed === 0;
}

/** 交互模式询问：y 执行 / n 跳过（回车取默认） */
async function askConfirm(question: string, defaultYes = true): Promise<boolean> {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [${defaultYes ? 'Y/n' : 'y/N'}] `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

/** 套件存在性检查（全量层 GLOBAL/cases 扫描） */
function suiteExists(projectRoot: string, _iteration: string, suiteId: string): boolean {
  const casesRoot = getGlobalCasesRoot(projectRoot);
  if (!fs.existsSync(casesRoot)) return false;
  for (const pd of fs.readdirSync(casesRoot, { withFileTypes: true })) {
    if (!pd.isDirectory()) continue;
    for (const ud of fs.readdirSync(path.join(casesRoot, pd.name), { withFileTypes: true })) {
      if (!ud.isDirectory()) continue;
      const suitesDir = path.join(casesRoot, pd.name, ud.name, 'suites');
      if (fs.existsSync(path.join(suitesDir, suiteId))) return true;
    }
  }
  return false;
}

/** 执行记录落盘 runs/（结构化事实，供 gate/report 消费） */
function saveRunRecord(
  projectRoot: string,
  iteration: string,
  result: { framework: string | null; total: number; passed: number; failed: number; skipped: number }
): void {
  if (result.framework === null) return; // 未执行不落记录
  const matrices = loadAllMatrices(projectRoot, iteration);
  const caseResults: TestRun['caseResults'] = [];
  for (const m of matrices) {
    for (const c of m.cases) {
      if (!c.lastRun) continue;
      caseResults.push({ caseId: c.caseId, status: c.status === 'passed' ? 'passed' : c.status === 'skipped' ? 'skipped' : 'failed' });
    }
  }

  const now = new Date().toISOString();
  const run: TestRun = TestRunSchema.parse({
    id: `RUN-${Date.now()}`,
    suiteId: 'framework-run',
    status: result.failed === 0 ? 'completed' : 'failed',
    startedAt: now,
    endedAt: now,
    totalCases: result.total,
    passedCases: result.passed,
    failedCases: result.failed,
    skippedCases: result.skipped,
    caseResults,
    createdAt: now,
  });

  const runsDir = path.join(projectRoot, '.spectest', 'iterations', iteration, 'matrix', 'runs');
  fs.ensureDirSync(runsDir);
  fs.writeJsonSync(path.join(runsDir, `${run.id}.json`), run, { spaces: 2 });
}

function displayFrameworkResult(result: {
  framework: string | null;
  command: string | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  unmatched: number;
  failures: { caseId: string; reason: string }[];
  outputTail: string;
}): void {
  console.log('');
  console.log('┌──────────────────────────────────────────┐');
  console.log('│       🧪 宿主框架执行结果                │');
  console.log('├──────────────────────────────────────────┤');

  if (!result.framework) {
    console.log('│  未接入宿主框架                          │');
    console.log('│  项目 package.json 未声明 vitest/jest/    │');
    console.log('│  playwright/pytest，如实报告不模拟。      │');
    console.log('│  接入方式：AI 生成的框架测试名携带        │');
    console.log('│  幂等 caseId（如 TS-xxx-AC-001）。        │');
  } else {
    console.log(`│  框架       │  ${result.framework.padEnd(20)} │`);
    console.log(`│  命令       │  ${truncate(result.command ?? '', 20)} │`);
    console.log(`│  解析用例   │  ${String(result.total).padEnd(20)} │`);
    console.log(`│  ✅ 通过    │  ${String(result.passed).padEnd(20)} │`);
    if (result.failed > 0) {
      console.log(`│  ❌ 失败    │  ${String(result.failed).padEnd(20)} │`);
    }
    if (result.skipped > 0) {
      console.log(`│  ⏭️  跳过   │  ${String(result.skipped).padEnd(20)} │`);
    }
    if (result.unmatched > 0) {
      console.log(`│  未识别     │  ${String(result.unmatched).padEnd(20)} │`);
    }
  }
  console.log('└──────────────────────────────────────────┘');

  if (result.failures.length > 0) {
    console.log('');
    console.log('❌ 失败用例（矩阵已回填）：');
    for (const f of result.failures) {
      console.log(`  - ${f.caseId}: ${f.reason}`);
    }
  }
  console.log('');
}

function truncate(str: string, len: number): string {
  return str.length <= len ? str : str.slice(0, len - 1) + '…';
}
