import path from 'path';
import fs from 'fs-extra';
import { ParsedRequirement, readIterationRequirements } from './spec-reader.js';
import { CoverageReport } from './schemas/index.js';

/**
 * 测试计划选项
 */
export interface TestPlanOptions {
  projectRoot: string;
  iteration: string;
  iterationGoal?: string;
}

/**
 * 测试策略（每个 Task 的测试建议）
 */
export interface TestStrategy {
  taskId: string;
  taskName: string;
  acCount: number;
  recommendedTests: TestTypeAssignment[];
  riskLevel: 'high' | 'medium' | 'low';
  riskReasons: string[];
}

/**
 * 测试类型分配
 */
export interface TestTypeAssignment {
  type: 'unit' | 'integration' | 'api' | 'e2e' | 'performance';
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * 测试数据建议
 */
export interface TestDataSuggestion {
  category: 'normal' | 'boundary' | 'error' | 'edge';
  description: string;
  count: number;
}

/**
 * 完整测试计划
 */
export interface TestPlan {
  iteration: string;
  iterationGoal: string;
  generatedAt: string;
  overview: {
    totalTasks: number;
    totalAC: number;
    highRiskTasks: number;
  };
  strategies: TestStrategy[];
  testData: TestDataSuggestion[];
  timeline: TestPlanTimeline;
}

export interface TestPlanTimeline {
  phases: TestPhase[];
}

export interface TestPhase {
  phase: string;
  action: string;
  when: string;
  duration: string;
}

/**
 * 测试计划引擎
 * 从期次目标 + 需求范围自动生成测试策略
 */
export function generateTestPlan(options: TestPlanOptions): TestPlan {
  const { projectRoot, iteration, iterationGoal } = options;

  // 1. 读取所有需求
  const requirements = readIterationRequirements(projectRoot, iteration);

  if (requirements.length === 0) {
    throw new Error(`期次 ${iteration} 中没有找到任何需求。`);
  }

  // 2. 为每个 Task 制定测试策略
  const strategies = requirements.map(req => buildStrategy(req));

  // 3. 汇总测试数据建议
  const testData = buildTestDataSuggestions(requirements);

  // 4. 汇总
  const highRiskTasks = strategies.filter(s => s.riskLevel === 'high').length;

  return {
    iteration,
    iterationGoal: iterationGoal || '未指定',
    generatedAt: new Date().toISOString(),
    overview: {
      totalTasks: requirements.length,
      totalAC: requirements.reduce((sum, r) => sum + r.acceptanceCriteria.length, 0),
      highRiskTasks,
    },
    strategies,
    testData,
    timeline: buildTimeline(iteration),
  };
}

/**
 * 为单个 Task 制定测试策略
 */
function buildStrategy(req: ParsedRequirement): TestStrategy {
  const acCount = req.acceptanceCriteria.length;
  const recommendedTests: TestTypeAssignment[] = [];
  const riskReasons: string[] = [];

  // 所有 Task 都需要单元测试
  recommendedTests.push({
    type: 'unit',
    reason: '验证核心业务逻辑',
    priority: 'high',
  });

  // 有 API 的需求需要 API 测试
  if (req.id.includes('backend') || hasAPIRelatedAC(req)) {
    recommendedTests.push({
      type: 'api',
      reason: '验证 API 接口契约（请求/响应/状态码）',
      priority: 'high',
    });
  }

  // 用户故事较多 → 需要 E2E
  if (req.userStories.length >= 2) {
    recommendedTests.push({
      type: 'e2e',
      reason: `包含 ${req.userStories.length} 个用户故事，建议端到端验证`,
      priority: 'medium',
    });
  }

  // 数据密集型 → 需要性能测试
  if (hasDataIntensiveAC(req)) {
    recommendedTests.push({
      type: 'performance',
      reason: '涉及批量数据处理或大量查询，建议性能测试',
      priority: 'medium',
    });
  }

  // 有外部依赖 → 需要集成测试
  if (req.dependencies.length > 0) {
    recommendedTests.push({
      type: 'integration',
      reason: `依赖 ${req.dependencies.length} 个其他 Task，建议集成测试`,
      priority: 'medium',
    });
  }

  // 风险评估
  let riskLevel: 'high' | 'medium' | 'low' = 'low';

  if (req.dependencies.length >= 3) {
    riskLevel = 'high';
    riskReasons.push(`依赖链较长（${req.dependencies.length} 个），变更影响大`);
  } else if (req.dependencies.length >= 1) {
    riskLevel = 'medium';
    riskReasons.push(`存在外部依赖（${req.dependencies.length} 个）`);
  }

  if (acCount === 0) {
    riskLevel = 'high';
    riskReasons.push('无验收标准（AC），测试范围不明确');
  } else if (acCount <= 2) {
    riskReasons.push('AC 数量较少，可能存在覆盖不足');
    if (riskLevel === 'low') riskLevel = 'medium';
  }

  if (hasErrorOnlyAC(req)) {
    riskReasons.push('仅包含异常场景 AC，缺少正向流程验证');
    if (riskLevel === 'low') riskLevel = 'medium';
  }

  return {
    taskId: req.id,
    taskName: req.name,
    acCount,
    recommendedTests,
    riskLevel,
    riskReasons,
  };
}

/**
 * 检测是否包含 API 相关 AC
 */
function hasAPIRelatedAC(req: ParsedRequirement): boolean {
  const apiKeywords = ['API', '接口', '请求', '响应', '状态码', 'HTTP', 'endpoint', 'request', 'response'];
  return req.acceptanceCriteria.some(ac =>
    apiKeywords.some(kw => ac.description.toLowerCase().includes(kw.toLowerCase()))
  );
}

/**
 * 检测是否包含数据密集型 AC
 */
function hasDataIntensiveAC(req: ParsedRequirement): boolean {
  const dataKeywords = ['批量', '大量', '导出', '导入', '列表', '分页', '查询', '统计', 'batch', 'export', 'import', 'list', 'query'];
  return req.acceptanceCriteria.some(ac =>
    dataKeywords.some(kw => ac.description.toLowerCase().includes(kw.toLowerCase()))
  );
}

/**
 * 检测是否只有异常场景 AC
 */
function hasErrorOnlyAC(req: ParsedRequirement): boolean {
  if (req.acceptanceCriteria.length === 0) return false;
  return req.acceptanceCriteria.every(ac => ac.scenario !== 'happy');
}

/**
 * 生成测试数据建议
 */
function buildTestDataSuggestions(requirements: ParsedRequirement[]): TestDataSuggestion[] {
  const suggestions: TestDataSuggestion[] = [];

  // 正常数据
  suggestions.push({
    category: 'normal',
    description: `准备 ${requirements.length} 个 Task 的正常业务数据`,
    count: requirements.length * 5,
  });

  // 边界数据
  const hasBusinessRules = requirements.some(r => r.businessRules.length > 0);
  if (hasBusinessRules) {
    suggestions.push({
      category: 'boundary',
      description: '根据业务规则准备边界值数据（最大/最小/临界值）',
      count: 10,
    });
  }

  // 异常数据
  suggestions.push({
    category: 'error',
    description: '准备异常输入数据（空值、超长字符串、特殊字符、越权操作）',
    count: 15,
  });

  // 极端场景数据
  suggestions.push({
    category: 'edge',
    description: '准备极端场景数据（并发操作、大量数据、网络异常）',
    count: 5,
  });

  return suggestions;
}

/**
 * 生成测试时间线
 */
function buildTimeline(iteration: string): TestPlanTimeline {
  return {
    phases: [
      {
        phase: '测试计划',
        action: '执行 spectest plan，确认测试范围、策略、数据',
        when: '期次启动后',
        duration: '0.5 天',
      },
      {
        phase: '测试设计',
        action: '执行 spectest gen + spectest api，生成用例并评审',
        when: '需求分析完成后',
        duration: '1-2 天',
      },
      {
        phase: '测试执行',
        action: '执行 spectest run，跟踪缺陷',
        when: '开发完成后',
        duration: '视需求规模',
      },
      {
        phase: '回归测试',
        action: '执行 spectest regress，覆盖变更影响',
        when: '每次变更/修复后',
        duration: '0.5-1 天',
      },
      {
        phase: '质量门禁',
        action: '执行 spectest gate，确认质量达标',
        when: '提测/上线前',
        duration: '0.5 天',
      },
      {
        phase: '测试总结',
        action: '执行 spectest report + spectest summary，输出测试报告',
        when: '期次结束时',
        duration: '0.5 天',
      },
    ],
  };
}

/**
 * 将测试计划保存为 Markdown 文件
 */
export function saveTestPlan(projectRoot: string, plan: TestPlan): string {
  const planDir = path.join(projectRoot, '.spectest', 'plans');
  fs.ensureDirSync(planDir);

  const planPath = path.join(planDir, `test-plan-${plan.iteration}.md`);
  const md = renderTestPlanMarkdown(plan);
  fs.writeFileSync(planPath, md, 'utf-8');

  return planPath;
}

/**
 * 渲染测试计划 Markdown
 */
function renderTestPlanMarkdown(plan: TestPlan): string {
  let md = `# 测试计划 - ${plan.iteration}\n\n`;
  md += `> 期次目标：${plan.iterationGoal}\n`;
  md += `> 生成时间：${plan.generatedAt}\n\n`;

  // 概览
  md += `## 概览\n\n`;
  md += `| 指标 | 值 |\n`;
  md += `|------|----|\n`;
  md += `| Task 数 | ${plan.overview.totalTasks} |\n`;
  md += `| AC 总数 | ${plan.overview.totalAC} |\n`;
  md += `| 高风险 Task | ${plan.overview.highRiskTasks} |\n\n`;

  // 测试策略
  md += `## 测试策略\n\n`;

  for (const s of plan.strategies) {
    const emoji = s.riskLevel === 'high' ? '🔴' : s.riskLevel === 'medium' ? '🟡' : '🟢';
    md += `### ${emoji} ${s.taskId}: ${s.taskName}\n\n`;
    md += `| 风险等级 | AC 数 |\n`;
    md += `|----------|------|\n`;
    md += `| ${s.riskLevel} | ${s.acCount} |\n\n`;

    if (s.riskReasons.length > 0) {
      md += `**风险原因：**\n`;
      for (const r of s.riskReasons) {
        md += `- ${r}\n`;
      }
      md += '\n';
    }

    md += `**推荐测试类型：**\n\n`;
    md += `| 类型 | 原因 | 优先级 |\n`;
    md += `|------|------|--------|\n`;
    for (const t of s.recommendedTests) {
      md += `| ${t.type} | ${t.reason} | ${t.priority} |\n`;
    }
    md += '\n';
  }

  // 测试数据
  md += `## 测试数据准备\n\n`;
  md += `| 类别 | 说明 | 建议数量 |\n`;
  md += `|------|------|----------|\n`;
  for (const d of plan.testData) {
    md += `| ${d.category} | ${d.description} | ${d.count} |\n`;
  }
  md += '\n';

  // 时间线
  md += `## 测试时间线\n\n`;
  md += `| 阶段 | 动作 | 时机 | 预估时长 |\n`;
  md += `|------|------|------|----------|\n`;
  for (const p of plan.timeline.phases) {
    md += `| ${p.phase} | ${p.action} | ${p.when} | ${p.duration} |\n`;
  }
  md += '\n';

  return md;
}
