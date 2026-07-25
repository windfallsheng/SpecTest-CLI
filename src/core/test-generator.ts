import path from 'path';
import fs from 'fs-extra';
import { TestCase, TestSuite } from './schemas/index.js';
import { ParsedRequirement, readIterationRequirements } from './spec-reader.js';
import { getSuiteDir } from './context.js';

/**
 * 生成选项
 */
export interface GenerateOptions {
  projectRoot: string;
  iteration: string;
  suiteId: string;
  suiteName: string;
  testType: 'unit' | 'integration' | 'e2e' | 'api';
  platform: 'backend' | 'frontend' | 'fullstack';
}

/**
 * 生成结果
 */
export interface GenerateResult {
  suite: TestSuite;
  cases: TestCase[];
  skippedRequirements: string[];
  summary: {
    totalRequirements: number;
    totalAC: number;
    generatedCases: number;
  };
}

/**
 * 测试用例生成引擎
 * 从 SpecCore 的 AC（验收标准）自动生成测试用例
 */
export function generateTestSuite(options: GenerateOptions): GenerateResult {
  const { projectRoot, iteration, suiteId, suiteName, testType, platform } = options;

  // 1. 读取期次中的所有需求
  const requirements = readIterationRequirements(projectRoot, iteration);

  if (requirements.length === 0) {
    throw new Error(`期次 ${iteration} 中没有找到任何需求。请确认 SpecCore 项目中存在该期次。`);
  }

  // 2. 为每个需求的每个 AC 生成测试用例
  const testCases: TestCase[] = [];
  const skippedRequirements: string[] = [];
  let totalAC = 0;

  const now = new Date().toISOString();

  for (const req of requirements) {
    if (req.acceptanceCriteria.length === 0) {
      skippedRequirements.push(req.id);
      continue;
    }

    totalAC += req.acceptanceCriteria.length;

    for (const ac of req.acceptanceCriteria) {
      const tc = generateTestCase(req, ac, suiteId, testType, now);
      testCases.push(tc);
    }
  }

  // 3. 构建测试套件
  const suite: TestSuite = {
    id: suiteId,
    name: suiteName,
    description: `自动生成的测试套件 - ${iteration}`,
    iteration,
    taskIds: requirements.map(r => r.id),
    testCaseIds: testCases.map(tc => tc.id),
    type: testType,
    platform,
    tags: [],
    passRate: 0,
    createdAt: now,
    updatedAt: now,
  };

  return {
    suite,
    cases: testCases,
    skippedRequirements,
    summary: {
      totalRequirements: requirements.length,
      totalAC,
      generatedCases: testCases.length,
    },
  };
}

/**
 * 从单个 AC 生成测试用例
 */
function generateTestCase(
  req: ParsedRequirement,
  ac: ACItem,
  suiteId: string,
  testType: string,
  now: string
): TestCase {
  const caseId = `${suiteId}-${ac.id}`;

  const steps = buildTestSteps(req, ac);
  const preconditions = buildPreconditions(req, ac);

  return {
    id: caseId,
    name: `[${req.name}] ${ac.description}`,
    type: testType as TestCase['type'],
    status: 'draft',
    priority: ac.priority,
    suiteId,
    requirementIds: [req.id],
    relatedAC: [ac.description],
    preconditions,
    steps,
    tags: [req.id, ac.scenario, testType],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 构建测试步骤
 */
function buildTestSteps(req: ParsedRequirement, ac: {
  description: string;
  scenario: string;
}): { step: number; action: string; expected: string }[] {
  const steps: { step: number; action: string; expected: string }[] = [];
  let stepNum = 1;

  // 前置步骤
  steps.push({
    step: stepNum++,
    action: '准备测试环境',
    expected: '环境就绪，依赖服务可用',
  });

  // 根据 AC 描述生成执行步骤
  if (ac.scenario === 'happy') {
    steps.push({
      step: stepNum++,
      action: `执行操作：${ac.description}`,
      expected: `操作成功，返回预期结果`,
    });

    // 验证步骤
    steps.push({
      step: stepNum++,
      action: '验证返回数据的正确性',
      expected: '数据与预期一致，关键字段值正确',
    });
  } else if (ac.scenario === 'error') {
    steps.push({
      step: stepNum++,
      action: `使用异常输入执行操作：${ac.description}`,
      expected: '返回明确的错误信息，不暴露系统内部细节',
    });

    steps.push({
      step: stepNum++,
      action: '验证系统状态未被异常操作破坏',
      expected: '系统状态保持不变，相关数据未受影响',
    });
  } else if (ac.scenario === 'boundary') {
    steps.push({
      step: stepNum++,
      action: `使用边界值测试：${ac.description}`,
      expected: '边界值被正确处理，不出现溢出或异常',
    });
  } else if (ac.scenario === 'edge') {
    steps.push({
      step: stepNum++,
      action: `使用极端场景测试：${ac.description}`,
      expected: '系统能正确处理极端情况，返回合理结果或友好提示',
    });
  }

  // 清理步骤
  steps.push({
    step: stepNum++,
    action: '清理测试数据',
    expected: '测试数据清理完成',
  });

  return steps;
}

/**
 * 构建前置条件
 */
function buildPreconditions(req: ParsedRequirement, ac: {
  description: string;
  scenario: string;
}): string[] {
  const preconditions: string[] = [
    '测试环境已部署并可用',
  ];

  if (ac.scenario === 'error') {
    preconditions.push('准备异常测试数据（无效输入、越权操作等）');
  } else if (ac.scenario === 'boundary') {
    preconditions.push('准备边界值测试数据（最大值、最小值、临界值）');
  } else if (ac.scenario === 'edge') {
    preconditions.push('准备极端场景测试数据');
  }

  if (req.dependencies.length > 0) {
    preconditions.push(`依赖任务已完成：${req.dependencies.join(', ')}`);
  }

  return preconditions;
}

/**
 * 将生成的测试套件和用例保存到文件
 */
export function saveTestSuite(
  projectRoot: string,
  result: GenerateResult
): string {
  const { suite, cases } = result;
  const suiteDir = getSuiteDir(projectRoot, suite.iteration, suite.id);

  fs.ensureDirSync(suiteDir);

  // 保存套件定义
  const suitePath = path.join(suiteDir, 'SUITE.yaml');
  fs.writeFileSync(suitePath, toYaml(suite), 'utf-8');

  // 保存用例
  const casesDir = path.join(suiteDir, 'cases');
  fs.ensureDirSync(casesDir);

  for (const tc of cases) {
    const casePath = path.join(casesDir, `${tc.id}.yaml`);
    fs.writeFileSync(casePath, toYaml(tc), 'utf-8');
  }

  // 保存生成摘要
  const summaryPath = path.join(suiteDir, 'SUMMARY.md');
  const summaryContent = generateSummaryMarkdown(result);
  fs.writeFileSync(summaryPath, summaryContent, 'utf-8');

  return suiteDir;
}

/**
 * 生成摘要 Markdown
 */
function generateSummaryMarkdown(result: GenerateResult): string {
  const { suite, cases, skippedRequirements, summary } = result;

  let md = `# ${suite.name}\n\n`;
  md += `> 自动生成于 ${new Date().toISOString()}\n\n`;
  md += `## 概览\n\n`;
  md += `| 指标 | 值 |\n`;
  md += `|------|----|\n`;
  md += `| 总需求数 | ${summary.totalRequirements} |\n`;
  md += `| 总 AC 数 | ${summary.totalAC} |\n`;
  md += `| 生成用例数 | ${summary.generatedCases} |\n`;
  md += `| 测试类型 | ${suite.type} |\n`;
  md += `| 目标平台 | ${suite.platform} |\n\n`;

  md += `## 用例清单\n\n`;
  md += `| ID | 名称 | 优先级 | 场景 |\n`;
  md += `|----|------|--------|------|\n`;

  for (const tc of cases) {
    md += `| ${tc.id} | ${tc.name} | ${tc.priority} | ${tc.relatedAC.join(', ')} |\n`;
  }

  if (skippedRequirements.length > 0) {
    md += `\n## ⚠️ 跳过的需求（无 AC）\n\n`;
    for (const req of skippedRequirements) {
      md += `- ${req}\n`;
    }
  }

  return md;
}

/**
 * 简单的 YAML 序列化（不依赖 js-yaml 的复杂功能）
 */
function toYaml(obj: Record<string, unknown>, indent = 0): string {
  const prefix = '  '.repeat(indent);
  let yaml = '';

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      yaml += `${prefix}${key}: null\n`;
    } else if (Array.isArray(value)) {
      yaml += `${prefix}${key}:\n`;
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          yaml += `${prefix}  - ${JSON.stringify(item)}\n`;
        } else {
          yaml += `${prefix}  - ${String(item)}\n`;
        }
      }
    } else if (typeof value === 'object') {
      yaml += `${prefix}${key}:\n`;
      yaml += toYaml(value as Record<string, unknown>, indent + 1);
    } else {
      yaml += `${prefix}${key}: ${String(value)}\n`;
    }
  }

  return yaml;
}

// Re-export needed types
import { ACItem } from './spec-reader.js';
