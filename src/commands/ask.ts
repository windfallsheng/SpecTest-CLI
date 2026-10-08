/**
 * ask — SpecTest 自然语言智能入口
 *
 * 与 speccore ask 风格统一：
 *   高置信度（≥70）→ 输出 [SPECTEST_EXEC: spectest <cmd>] 标记 + 进程内直接执行
 *   中置信度（45~69）→ 列候选 + [SPECTEST_NEEDS_INFO] 请补充明确
 *   低置信度（<45）→ 列候选 + 用法示例（不伪装理解，交还宿主 AI）
 *
 * 参数缺失 → [SPECTEST_NEEDS_INFO]...[/SPECTEST_NEEDS_INFO]，不执行。
 * 执行方式为 CLI 进程内动态 import 命令处理器（与 SpecProt ask 同构）：
 * AI 接力段（gen/api 的 [SPECTEST_PROMPT]）输出与直接跑命令一致，宿主 AI 无缝接力。
 */

import { recognizeTestIntent, getConfidenceLevel, getIntentLabel, getAllTestMappings, type TestIntentResult } from '../core/ask-intent.js';

export async function askCommand(input: string): Promise<void> {
  if (!input || !input.trim()) {
    showUsage();
    return;
  }

  console.log(`🔍 正在理解你的意图...`);
  console.log('');

  const results = recognizeTestIntent(input);

  if (results.length === 0) {
    showNoMatch(input);
    return;
  }

  const best = results[0];
  const level = getConfidenceLevel(best.confidence);

  if (level === 'high') {
    await executeHigh(best, input);
  } else if (level === 'medium') {
    showMediumConfidence(results.slice(0, 3));
  } else {
    showLowConfidence(results.slice(0, 3), input);
  }
}

// ============================================================
// 高置信度：直接执行
// ============================================================

/** 意图 id → 真实 CLI 命令词（标记输出可被宿主 AI 直接复现） */
const CLI_CMD: Record<string, string> = {
  'bug': 'bug',
  'bug-close': 'bug close',
  'bug-list': 'bug list',
  'config-set': 'config set',
};

/** 意图 → 必需参数（缺任一则输出 [SPECTEST_NEEDS_INFO]，不执行） */
const REQUIRED_PARAMS: Record<string, string[]> = {
  'bug': ['caseId', 'title'],
  'bug-close': ['bugId'],
  'config-set': ['key', 'value'],
};

/** 参数中文名（提示用） */
const PARAM_LABELS: Record<string, string> = {
  caseId: '失败的测试用例 ID（如 TS-h5-mobile-booking-unit-AC-001）',
  title: '缺陷标题（如 "金额精度丢失"）',
  bugId: '缺陷 ID（如 BUG-1720000000000）',
  key: '配置键（如 gate.coverageThreshold）',
  value: '配置值（如 85）',
};

async function executeHigh(result: TestIntentResult, input: string): Promise<void> {
  const params: Record<string, any> = { ...result.extractedParams };

  // 参数归一化：config-set 的覆盖率语义 → 点路径键
  if (result.command === 'config-set') {
    if (!params.key && params.threshold) {
      params.key = 'gate.coverageThreshold';
      params.value = params.threshold;
    }
  }

  const required = REQUIRED_PARAMS[result.command] || [];
  const missing = required.filter((k) => !params[k]);
  if (missing.length > 0) {
    showNeedsInfo(result, missing);
    return;
  }

  const cliArgs = buildCliArgs(result.command, params);
  console.log(`✅ 我理解你想：${getIntentLabel(result.intent)}（置信度 ${result.confidence}%）`);
  console.log(`[SPECTEST_EXEC: spectest ${CLI_CMD[result.command] || result.command}${cliArgs ? ` ${cliArgs}` : ''}]`);
  console.log('');
  await executeIntent(result.command, params);
}

/** 参数缺失：交互式提示，请宿主 AI/用户补充后重试 */
function showNeedsInfo(result: TestIntentResult, missing: string[]): void {
  console.log('[SPECTEST_NEEDS_INFO]');
  console.log(`我理解你想：${getIntentLabel(result.intent)}，但还缺参数：`);
  for (const k of missing) {
    console.log(`   · ${PARAM_LABELS[k] || k}`);
  }
  console.log('');
  console.log(`请补充后重试，例如：spectest ask "记录缺陷 ${result.extractedParams.caseId ? `--case-id ${result.extractedParams.caseId} ` : ''}标题 金额精度丢失"`);
  console.log(`或直接执行：spectest ${CLI_CMD[result.command] || result.command} --help 查看完整参数`);
  console.log('[/SPECTEST_NEEDS_INFO]');
}

// ============================================================
// 中/低置信度：候选展示（不执行）
// ============================================================

function showMediumConfidence(results: TestIntentResult[]): void {
  console.log('🔍 你的输入可能有多重含义：');
  console.log('');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`  ${i + 1}. ${getIntentLabel(r.intent)}（置信度 ${r.confidence}%）→ spectest ${CLI_CMD[r.command] || r.command}`);
  }
  console.log('');
  console.log('[SPECTEST_NEEDS_INFO]');
  console.log('请把话说得更明确（带上对象名与参数），或直接执行：');
  for (const r of results) {
    console.log(`   · spectest ${CLI_CMD[r.command] || r.command} --help`);
  }
  console.log('[/SPECTEST_NEEDS_INFO]');
}

function showLowConfidence(results: TestIntentResult[], input: string): void {
  console.log(`🤔 对「${input}」的识别置信度较低。`);

  if (results.length > 0) {
    console.log('');
    console.log('你可能想说的是：');
    for (const r of results) {
      console.log(`  - ${getIntentLabel(r.intent)}（spectest ${CLI_CMD[r.command] || r.command}）`);
    }
  }

  console.log('');
  console.log('你可以这样说：');
  console.log('  - "生成测试用例"');
  console.log('  - "跑一下测试"');
  console.log('  - "质量门禁能不能放行"');
  console.log('  - "记录缺陷 --case-id TS-xxx-AC-001 标题 金额精度丢失"');
  console.log('  - "看看测试状态"');
}

function showNoMatch(input: string): void {
  console.log(`🤔 对「${input}」没有匹配到合适的命令。`);
  console.log('');
  console.log('你可以这样说：');
  console.log('  - "初始化测试项目"');
  console.log('  - "生成测试用例" / "生成接口测试"');
  console.log('  - "跑一下测试" / "跑契约" / "跑回归"');
  console.log('  - "质量门禁" / "看看测试状态"');
  console.log('  - "记录缺陷 --case-id TS-xxx-AC-001 标题 xxx"');
}

function showUsage(): void {
  console.log('用法：spectest ask "自然语言描述测试意图"');
  console.log('');
  console.log('示例：');
  console.log('  spectest ask "生成测试用例"');
  console.log('  spectest ask "跑一下测试"');
  console.log('  spectest ask "质量门禁能不能放行"');
  console.log('  spectest ask "记录缺陷 --case-id TS-xxx-AC-001 标题 金额精度丢失"');
  console.log('  spectest ask "关闭缺陷 BUG-1720000000000"');
  console.log('  spectest ask "设置覆盖率为 85"');
  console.log('');
  console.log('更多意图：spectest ask --list');
}

// ============================================================
// 意图 → 命令处理器（CLI 进程内直接调用，不 spawn 子进程）
// ============================================================

async function executeIntent(id: string, p: Record<string, any>): Promise<void> {
  switch (id) {
    case 'init': {
      const { initCommand } = await import('./init.js');
      await initCommand({ iteration: p.iteration, force: p.force });
      break;
    }
    case 'plan': {
      const { planCommand } = await import('./plan.js');
      await planCommand({ iteration: p.iteration, goal: p.goal });
      break;
    }
    case 'gen': {
      const { genCommand } = await import('./gen.js');
      await genCommand({ iteration: p.iteration, platform: p.platform, unit: p.unit });
      break;
    }
    case 'api': {
      const { apiCommand } = await import('./api.js');
      await apiCommand({ iteration: p.iteration, platform: p.platform });
      break;
    }
    case 'gap': {
      const { gapCommand } = await import('./gap.js');
      await gapCommand({ iteration: p.iteration });
      break;
    }
    case 'run': {
      const { runCommand } = await import('./run.js');
      await runCommand({ iteration: p.iteration, suite: p.suite });
      break;
    }
    case 'verify': {
      const { verifyCommand } = await import('./verify.js');
      await verifyCommand({ iteration: p.iteration, platform: p.platform });
      break;
    }
    case 'contract-run': {
      const { contractRunCommand } = await import('./contract-run.js');
      await contractRunCommand({ iteration: p.iteration, env: p.env });
      break;
    }
    case 'regress': {
      const { regressCommand } = await import('./regress.js');
      await regressCommand({ iteration: p.iteration, task: p.task });
      break;
    }
    case 'impact': {
      const { impactCommand } = await import('./impact.js');
      await impactCommand({ iteration: p.iteration, task: p.task });
      break;
    }
    case 'bug': {
      const { bugCommand } = await import('./bug.js');
      await bugCommand({ iteration: p.iteration, caseId: p.caseId, title: p.title, severity: p.severity });
      break;
    }
    case 'bug-close': {
      const { closeBugCommand } = await import('./bug.js');
      await closeBugCommand({ bugId: p.bugId });
      break;
    }
    case 'bug-list': {
      const { listBugsCommand } = await import('./bug.js');
      await listBugsCommand({ status: p.status });
      break;
    }
    case 'gate': {
      const { gateCommand } = await import('./gate.js');
      await gateCommand({ iteration: p.iteration, threshold: p.threshold });
      break;
    }
    case 'report': {
      const { reportCommand } = await import('./report.js');
      await reportCommand({ iteration: p.iteration });
      break;
    }
    case 'summary': {
      const { summaryCommand } = await import('./summary.js');
      await summaryCommand({ iteration: p.iteration });
      break;
    }
    case 'trend': {
      const { trendCommand } = await import('./trend.js');
      await trendCommand({});
      break;
    }
    case 'archive': {
      const { archiveCommand } = await import('./archive.js');
      await archiveCommand({ iteration: p.iteration });
      break;
    }
    case 'status': {
      const { statusCommand } = await import('./status.js');
      await statusCommand({ iteration: p.iteration });
      break;
    }
    case 'config-set': {
      const { configCommand } = await import('./config.js');
      await configCommand({ key: p.key, value: p.value });
      break;
    }
    default:
      console.log(`⚠️ 「${id}」暂未接入自动执行，请直接用命令：spectest ${id}`);
  }
}

/** 参数 → CLI 参数串（[SPECTEST_EXEC] 标记内容，供宿主 AI 复现） */
function buildCliArgs(id: string, p: Record<string, any>): string {
  const parts: string[] = [];
  const flag = (name: string, v: any): void => {
    if (v !== undefined && v !== '' && v !== null) {
      parts.push(`${name} ${String(v).includes(' ') ? `"${v}"` : v}`);
    }
  };
  switch (id) {
    case 'init': flag('-i', p.iteration); break;
    case 'plan': flag('-i', p.iteration); flag('--goal', p.goal); break;
    case 'gen': flag('-i', p.iteration); flag('-p', p.platform); flag('-u', p.unit); break;
    case 'api': flag('-i', p.iteration); flag('-p', p.platform); break;
    case 'gap': flag('-i', p.iteration); break;
    case 'run': flag('-i', p.iteration); flag('--suite', p.suite); break;
    case 'verify': flag('-i', p.iteration); flag('-p', p.platform); break;
    case 'contract-run': flag('-i', p.iteration); flag('--env', p.env); break;
    case 'regress': flag('-i', p.iteration); flag('--task', p.task); break;
    case 'impact': flag('-i', p.iteration); flag('--task', p.task); break;
    case 'bug': flag('-i', p.iteration); flag('--case-id', p.caseId); flag('-s', p.severity); flag('-t', p.title); break;
    case 'bug-close': parts.push(String(p.bugId)); break;
    case 'bug-list': flag('--status', p.status); break;
    case 'gate': flag('-i', p.iteration); flag('--threshold', p.threshold); break;
    case 'report': case 'summary': case 'archive': flag('-i', p.iteration); break;
    case 'trend': break;
    case 'status': flag('-i', p.iteration); break;
    case 'config-set': parts.push(String(p.key), String(p.value)); break; // 'set' 已由 CLI_CMD 提供
  }
  return parts.join(' ');
}

// ============================================================
// 意图清单（ask --list）
// ============================================================

export function showAllIntents(): void {
  const mappings = getAllTestMappings();
  console.log('📋 SpecTest 支持的意图类型：');
  console.log('');

  const groups: Record<string, typeof mappings> = {
    '⚙️ 生成面': [],
    '▶️ 执行面': [],
    '🚧 门禁面': [],
    '📊 度量面': [],
    '🐛 缺陷面': [],
    '🛠️ 配置与状态': [],
  };
  for (const m of mappings) {
    if (['init', 'plan', 'gen', 'api'].includes(m.id)) groups['⚙️ 生成面'].push(m);
    else if (['run', 'verify', 'contract-run', 'regress', 'impact', 'gap'].includes(m.id)) groups['▶️ 执行面'].push(m);
    else if (['gate'].includes(m.id)) groups['🚧 门禁面'].push(m);
    else if (['report', 'summary', 'trend', 'archive'].includes(m.id)) groups['📊 度量面'].push(m);
    else if (['bug', 'bug-close', 'bug-list'].includes(m.id)) groups['🐛 缺陷面'].push(m);
    else groups['🛠️ 配置与状态'].push(m);
  }
  for (const [group, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    console.log(group);
    for (const item of items) {
      console.log(`  ${getIntentLabel(item.intent).padEnd(20)} → spectest ${CLI_CMD[item.id] || item.id}`);
    }
    console.log('');
  }
}
