/**
 * ask-intent.ts —— SpecTest 意图识别引擎（ask 命令的词典层）
 *
 * 与 SpecCore ask / SpecProt 意图识别同构：
 *   - 词典匹配：trigger 命中 +25/词，pattern 命中 +35/式，priority ×0.2 加成，封顶 100
 *   - 置信度分层：high ≥70 直接执行；medium 45~69 列候选；low 提示
 *   - 报缺不脑补：参数缺失 → [SPECTEST_NEEDS_INFO] 交互式提示，不执行
 *
 * LLM 兜底为占位符（与 SpecCore 现状一致）：词典未命中时不伪装理解，
 * 如实输出候选命令与用法示例，把理解权交还宿主 AI。
 */

// ============================================================
// 类型定义
// ============================================================

/** 测试侧意图类型 */
export type TestIntent =
  | 'init'            // 初始化测试项目
  | 'plan'            // 测试计划
  | 'gen'             // 生成测试用例（AI 接力）
  | 'api'             // 接口测试用例生成
  | 'gap'             // 覆盖缺口检测
  | 'run'             // 执行测试
  | 'verify'          // 文档静态验证
  | 'contract_run'    // 契约执行
  | 'regress'         // 回归测试
  | 'impact'          // 变更影响分析
  | 'bug_create'      // 记录缺陷
  | 'bug_close'       // 关闭缺陷
  | 'bug_list'        // 缺陷清单
  | 'gate'            // 质量门禁
  | 'report'          // 测试报告
  | 'summary'         // 测试总结
  | 'trend'           // 趋势分析
  | 'archive'         // 测试归档
  | 'status'          // 测试状态
  | 'config_set';     // 配置设置

/** 意图匹配结果 */
export interface TestIntentResult {
  intent: TestIntent;
  command: string;
  confidence: number;
  priority: number;
  matchedTriggers: string[];
  extractedParams: Record<string, string>;
}

/** 命令映射 */
export interface TestCommandMapping {
  id: string;
  intent: TestIntent;
  priority: number;
  triggers: string[];
  patterns: string[];
  description: string;
  example: string;
}

// ============================================================
// 命令映射表（词典）
// ============================================================

const TEST_COMMAND_MAPPINGS: TestCommandMapping[] = [
  {
    id: 'run',
    intent: 'run',
    priority: 100,
    triggers: ['跑测试', '执行测试', '运行测试', '跑一下测试', '跑一遍测试', '测试跑起来', '执行用例'],
    patterns: ['跑(.+)?测试', '执行(.+)?测试', '运行(.+)?测试'],
    description: '执行测试流水线 — 静态验证 → 契约执行 → 宿主框架（三层链先轻后重）',
    example: 'spectest run -i Q1',
  },
  {
    id: 'gen',
    intent: 'gen',
    priority: 98,
    triggers: ['生成测试用例', '生成用例', '补用例', '写测试用例', '补测试用例'],
    patterns: ['生成(.+)用例', '补(.+)用例', '给(.+)写测试', '写(.+)用例'],
    description: '生成测试用例 — 骨架预建 + [SPECTEST_PROMPT] AI 接力（exitCode 10）',
    example: 'spectest gen -i Q1 --type unit',
  },
  {
    id: 'gate',
    intent: 'gate',
    priority: 98,
    triggers: ['质量门禁', '门禁检查', '门禁', '质量检查', '能不能放行', '可否放行'],
    patterns: ['跑(.+)门禁', '(.+)门禁检查'],
    description: '质量门禁 — 七项检查（覆盖/规格/执行完备/通过率/P0/漂移/缺陷），不达标 exitCode 1',
    example: 'spectest gate -i Q1',
  },
  {
    id: 'api',
    intent: 'api',
    priority: 92,
    triggers: ['接口测试', '接口用例', '契约测试用例', 'API 测试用例'],
    patterns: ['生成接口(.+)', '生成(.+)接口'],
    description: '接口测试用例 — 解析 API_CONTRACT.yaml 确定性生成五类契约场景',
    example: 'spectest api -i Q1 -p booking-service',
  },
  {
    id: 'contract-run',
    intent: 'contract_run',
    priority: 92,
    triggers: ['契约执行', '执行契约', '跑契约', '契约测试执行', '契约跑一下'],
    patterns: ['执行契约(.+)?', '跑契约(.+)?'],
    description: '契约执行 — 从 testData 组装真实 HTTP 请求 → 断言 → 矩阵回填',
    example: 'spectest contract-run -i Q1 --env test',
  },
  {
    id: 'status',
    intent: 'status',
    priority: 88,
    triggers: ['测试状态', '看看状态', '测试进展', '状态面板', '现在啥情况', '啥情况'],
    patterns: ['(.+)测试状态', '查看(.+)状态', '看看(.+)?状态', '(.+)测试进展'],
    description: '查看测试状态 — metrics 度量面板（矩阵事实）',
    example: 'spectest status',
  },
  {
    id: 'report',
    intent: 'report',
    priority: 88,
    triggers: ['测试报告', '出报告', '生成报告', '出测试报告'],
    patterns: ['(.+)?测试报告', '生成(.+)报告'],
    description: '生成测试报告 — AC 覆盖矩阵 + 套件明细（矩阵视角）',
    example: 'spectest report -i Q1',
  },
  {
    id: 'verify',
    intent: 'verify',
    priority: 86,
    triggers: ['静态验证', '验证文档', '校验 AC', '文档校验'],
    patterns: ['静态验证(.+)', '验证(.+)文档'],
    description: '文档静态验证 — 零成本第一道闸（AC 格式/四段/端级专项/契约一致）',
    example: 'spectest verify -i Q1',
  },
  {
    id: 'bug',
    intent: 'bug_create',
    priority: 84,
    triggers: ['记录缺陷', '记 bug', '报缺陷', '提交缺陷', '建缺陷', '报 bug', '缺陷记录'],
    patterns: ['记录(.+)?缺陷', '报(.+)bug', '记录(.+)bug'],
    description: '记录缺陷 — open 状态落盘 .spectest/bugs/（需 --case-id + --title）',
    example: 'spectest bug --case-id TS-xxx-AC-001 --title "金额精度丢失"',
  },
  {
    id: 'gap',
    intent: 'gap',
    priority: 83,
    triggers: ['覆盖缺口', '没覆盖', '漏测', '测试缺口', '覆盖不全'],
    patterns: ['检查(.+)缺口', '(.+)覆盖缺口', '(.+)缺口(.+)'],
    description: '覆盖缺口检测 — 对比 AC 与矩阵 traces 找出未覆盖场景',
    example: 'spectest gap -i Q1',
  },
  {
    id: 'bug-list',
    intent: 'bug_list',
    priority: 82,
    triggers: ['缺陷清单', '缺陷列表', '看 bug', '还有啥 bug', '有哪些 bug', 'bug 列表'],
    patterns: ['(.+)?缺陷清单', '(.+)缺陷列表', '查看(.+)缺陷', '看(.+)?bug'],
    description: '缺陷清单 — 按状态过滤（open/closed/all，默认 open）',
    example: 'spectest bug list --status all',
  },
  {
    id: 'regress',
    intent: 'regress',
    priority: 80,
    triggers: ['回归测试', '跑回归', '回归', '变了代码'],
    patterns: ['跑(.+)?回归', '(.+)?回归测试'],
    description: '回归测试 — 变更后执行受影响用例（依赖矩阵 traces）',
    example: 'spectest regress --task Task-001',
  },
  {
    id: 'impact',
    intent: 'impact',
    priority: 78,
    triggers: ['影响分析', '影响范围', '变更影响', '改了啥'],
    patterns: ['(.+)影响范围', '分析(.+)影响(.+)', '(.+)?影响分析'],
    description: '变更影响分析 — 需求变更后定位需更新/新增的测试',
    example: 'spectest impact --task Task-001',
  },
  {
    id: 'bug-close',
    intent: 'bug_close',
    priority: 76,
    triggers: ['关闭缺陷', '关 bug', '修复缺陷', '缺陷修复', '关掉 bug'],
    patterns: ['关闭(.+)?缺陷', '关掉(.+)bug'],
    description: '关闭缺陷 — open → closed 修复闭环（gate 缺陷检查随之放行）',
    example: 'spectest bug close BUG-1720000000000',
  },
  {
    id: 'summary',
    intent: 'summary',
    priority: 72,
    triggers: ['测试总结', '总结', '汇总', '出总结'],
    patterns: ['总结(.+)?测试', '总结(.+)?', '(.+)测试总结', '汇总(.+)测试'],
    description: '测试总结 — 迭代质量度量汇总 + 落盘 summary-*.md',
    example: 'spectest summary -i Q1',
  },
  {
    id: 'plan',
    intent: 'plan',
    priority: 70,
    triggers: ['测试计划', '测试策略', '制定测试计划', '生成测试计划'],
    patterns: ['(.+)?测试计划', '测试计划(.+)'],
    description: '测试计划 — 从期次目标 + 需求范围生成测试策略/风险/时间线',
    example: 'spectest plan --iteration Q1 --goal "订单导出"',
  },
  {
    id: 'archive',
    intent: 'archive',
    priority: 70,
    triggers: ['测试归档', '归档', '存档'],
    patterns: ['(.+)?归档', '归档(.+)'],
    description: '测试归档 — 迭代快照 + ARCHIVE_METRICS.json 度量随附',
    example: 'spectest archive -i Q1',
  },
  {
    id: 'trend',
    intent: 'trend',
    priority: 68,
    triggers: ['趋势分析', '测试趋势', '走势', '对比期次', '趋势对比'],
    patterns: ['(.+)?趋势(.+)', '趋势(.+)', '(.+)走势'],
    description: '趋势分析 — 跨迭代覆盖/通过/缺陷对比',
    example: 'spectest trend',
  },
  {
    id: 'config-set',
    intent: 'config_set',
    priority: 64,
    triggers: ['设置覆盖率', '改覆盖率', '覆盖率为', '设置阈值', '配置阈值', '改配置', '覆盖率要求'],
    patterns: ['覆盖率\\s*[为到达到]*\\s*(\\d+)', '阈值[：:\\s]*(\\d+)'],
    description: '配置设置 — 点路径写入 config.yaml（gate.coverageThreshold 等）',
    example: 'spectest config set gate.coverageThreshold 85',
  },
  {
    id: 'init',
    intent: 'init',
    priority: 62,
    triggers: ['初始化测试', '接入测试', '开始测试', '搭建测试底座', '初始化'],
    patterns: ['初始化(.+)?'],
    description: '初始化测试项目 — 创建 .spectest/ 目录结构（与 .speccore/ 同级）',
    example: 'spectest init --iteration Q1',
  },
];

// ============================================================
// 意图识别（词典匹配 + 置信度评分）
// ============================================================

export function recognizeTestIntent(input: string): TestIntentResult[] {
  const results: TestIntentResult[] = [];
  const inputLower = input.toLowerCase();

  for (const mapping of TEST_COMMAND_MAPPINGS) {
    let totalScore = 0;
    const matched: string[] = [];

    // 1. 关键词直接匹配（权重 25）
    for (const trigger of mapping.triggers) {
      if (input.includes(trigger) || inputLower.includes(trigger.toLowerCase())) {
        totalScore += 25;
        matched.push(`关键词:"${trigger}"`);
      }
    }

    // 2. 正则模式匹配（权重 35）
    for (const pattern of mapping.patterns) {
      try {
        if (new RegExp(pattern).test(input)) {
          totalScore += 35;
          matched.push(`模式:"${pattern}"`);
        }
      } catch { /* 忽略无效正则 */ }
    }

    // 3. 优先级加成（权重 0.2）
    totalScore += mapping.priority * 0.2;

    if (totalScore > mapping.priority * 0.2) {
      results.push({
        intent: mapping.intent,
        command: mapping.id,
        confidence: Math.min(100, Math.round(totalScore)),
        priority: mapping.priority,
        matchedTriggers: matched,
        extractedParams: extractTestParams(input),
      });
    }
  }

  return results.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.priority - a.priority;
  });
}

/**
 * 参数提取（全局正则，不依赖 pattern 捕获组）
 * 提取失败不报错——缺参由 ask 命令层以 [SPECTEST_NEEDS_INFO] 提示补齐。
 */
function extractTestParams(input: string): Record<string, string> {
  const params: Record<string, string> = {};

  // 引号内容（标题/目标）
  const quoted = input.match(/["""]([^"""]+)[""']/);
  if (quoted) {
    params.title = quoted[1];
    params.goal = quoted[1];
  }

  // 期次名：期次 Q1 / 迭代 Q1
  const iterMatch = input.match(/期次[：:\s]*([^,，\s]+)/) || input.match(/迭代[：:\s]*([^,，\s]+)/);
  if (iterMatch) params.iteration = iterMatch[1];

  // 用例 ID / 缺陷 ID / Task ID
  const caseMatch = input.match(/TS-[a-z0-9-]+/i);
  if (caseMatch) params.caseId = caseMatch[0];
  const bugMatch = input.match(/BUG-\d+/i);
  if (bugMatch) params.bugId = bugMatch[0].toUpperCase();
  const taskMatch = input.match(/Task-[A-Za-z0-9-]+/i);
  if (taskMatch) params.task = taskMatch[0];

  // 套件 ID
  const suiteMatch = input.match(/套件[：:\s]*([^,，\s]+)/);
  if (suiteMatch) params.suite = suiteMatch[1];

  // 阈值数字（覆盖率/阈值语义）
  const thresholdMatch = input.match(/覆盖率[为到达到≥>]*\s*(\d+)/) || input.match(/阈值[：:\s]*(\d+)/);
  if (thresholdMatch) params.threshold = thresholdMatch[1];

  // 严重程度归一化（bug 上下文使用）
  if (input.includes('严重') || input.includes('高优')) params.severity = 'high';
  else if (input.includes('低')) params.severity = 'low';
  else if (input.includes('中')) params.severity = 'medium';

  // 缺陷状态（bug-list 上下文使用）
  if (input.includes('已关闭') || input.includes('closed')) params.status = 'closed';
  else if (input.includes('全部') || input.includes('所有') || input.includes('all')) params.status = 'all';

  // 执行环境（contract-run 上下文使用）
  const envMatch = input.match(/环境[：:\s]*([^,，\s]+)/);
  if (envMatch) params.env = envMatch[1];

  return params;
}

// ============================================================
// 分层与展示辅助
// ============================================================

export function getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 70) return 'high';
  if (confidence >= 45) return 'medium';
  return 'low';
}

export function getIntentLabel(intent: TestIntent): string {
  const labels: Record<TestIntent, string> = {
    init: '🧱 初始化测试项目',
    plan: '📋 生成测试计划',
    gen: '⚙️ 生成测试用例',
    api: '🔌 生成接口测试用例',
    gap: '🕳️ 检测覆盖缺口',
    run: '▶️ 执行测试',
    verify: '📐 文档静态验证',
    contract_run: '🌐 契约执行',
    regress: '↩️ 回归测试',
    impact: '🧭 变更影响分析',
    bug_create: '🐛 记录缺陷',
    bug_close: '🔓 关闭缺陷',
    bug_list: '📜 缺陷清单',
    gate: '🚧 质量门禁检查',
    report: '📊 生成测试报告',
    summary: '📝 生成测试总结',
    trend: '📈 趋势分析',
    archive: '📦 测试归档',
    status: '🖥️ 查看测试状态',
    config_set: '🔧 配置设置',
  };
  return labels[intent];
}

/** 获取所有命令映射（help 展示用） */
export function getAllTestMappings(): TestCommandMapping[] {
  return [...TEST_COMMAND_MAPPINGS];
}
