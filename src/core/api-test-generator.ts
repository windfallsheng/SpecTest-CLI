import path from 'path';
import fs from 'fs-extra';
import { TestCase, TestSuite } from './schemas/index.js';
import { getTestDir } from './context.js';

/**
 * API Contract 解析结构
 */
export interface APIContract {
  method: string;
  path: string;
  summary: string;
  description?: string;
  tags?: string[];
  request: {
    headers?: Record<string, APIField>;
    params?: Record<string, APIField>;
    query?: Record<string, APIField>;
    body?: Record<string, APIField>;
  };
  responses: Record<string, APIResponse>;
}

export interface APIField {
  type: string;
  required?: boolean;
  description?: string;
  constraints?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: string[];
  };
  example?: unknown;
}

export interface APIResponse {
  description: string;
  body?: Record<string, APIField>;
  headers?: Record<string, APIField>;
}

export interface APITestOptions {
  projectRoot: string;
  iteration: string;
  suiteId: string;
  suiteName: string;
}

export interface APITestResult {
  suite: TestSuite;
  cases: TestCase[];
  summary: {
    totalEndpoints: number;
    generatedCases: number;
    skippedEndpoints: number;
  };
}

/**
 * API 测试生成引擎
 * 从 spec-core 产出的 API_CONTRACT.yaml 生成接口测试用例
 */
export function generateAPITests(options: APITestOptions): APITestResult {
  const { projectRoot, iteration, suiteId, suiteName } = options;

  // 1. 扫描期次中所有 Task 的 API_CONTRACT.yaml
  const contracts = scanAPIContracts(projectRoot, iteration);

  if (contracts.length === 0) {
    throw new Error(
      `期次 ${iteration} 中没有找到 API_CONTRACT.yaml 文件。\n` +
      `请确保 spec-core 开发完成后已生成 API 契约文件。`
    );
  }

  // 2. 为每个 API 端点生成测试用例
  const testCases: TestCase[] = [];
  let skippedEndpoints = 0;
  const now = new Date().toISOString();

  for (const contract of contracts) {
    const cases = generateEndpointTests(contract, suiteId, now);
    if (cases.length === 0) {
      skippedEndpoints++;
    }
    testCases.push(...cases);
  }

  // 3. 构建测试套件
  const suite: TestSuite = {
    id: suiteId,
    name: suiteName,
    description: `自动生成的 API 测试套件 - ${iteration}`,
    iteration,
    taskIds: contracts.map(c => c.filePath.split('/').slice(-3, -1).join('/')),
    testCaseIds: testCases.map(tc => tc.id),
    type: 'api',
    platform: 'fullstack',
    tags: ['api', 'auto-generated'],
    passRate: 0,
    createdAt: now,
    updatedAt: now,
  };

  return {
    suite,
    cases: testCases,
    summary: {
      totalEndpoints: contracts.length,
      generatedCases: testCases.length,
      skippedEndpoints,
    },
  };
}

/**
 * 扫描期次中的 API Contract 文件
 */
interface ScannedContract extends APIContract {
  filePath: string;
  taskId: string;
}

function scanAPIContracts(projectRoot: string, iteration: string): ScannedContract[] {
  const contracts: ScannedContract[] = [];

  // 路径 1: 期次-XXX/Task-XXX/backend/API_CONTRACT.yaml
  const iterationDir = findIterationDir(projectRoot, iteration);
  if (!iterationDir) return [];

  const taskDirs = fs.readdirSync(iterationDir, { withFileTypes: true });

  for (const entry of taskDirs) {
    if (!entry.isDirectory() || !entry.name.startsWith('Task-')) continue;

    const taskId = entry.name;
    const contractPaths = [
      path.join(iterationDir, taskId, 'backend', 'API_CONTRACT.yaml'),
      path.join(iterationDir, taskId, 'backend', 'API_CONTRACT.yml'),
    ];

    for (const cp of contractPaths) {
      if (!fs.existsSync(cp)) continue;

      try {
        const content = fs.readFileSync(cp, 'utf-8');
        const parsed = parseAPIContract(content, cp, taskId);
        if (parsed) {
          contracts.push(parsed);
        }
      } catch {
        // 跳过解析失败的文件
        console.warn(`⚠️ 跳过无法解析的 API Contract: ${cp}`);
      }
    }
  }

  return contracts;
}

/**
 * 查找期次目录
 */
function findIterationDir(projectRoot: string, iteration: string): string | null {
  const pattern = path.join(projectRoot, `期次-${iteration}`);
  if (fs.existsSync(pattern)) return pattern;

  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.includes(iteration)) {
      return path.join(projectRoot, entry.name);
    }
  }

  return null;
}

/**
 * 简单解析 YAML 格式的 API Contract
 * 注意：这不是完整的 YAML 解析器，但能处理 spec-core 产出的标准格式
 */
function parseAPIContract(content: string, filePath: string, taskId: string): ScannedContract | null {
  const lines = content.split('\n');
  let method = '';
  let apiPath = '';
  let summary = '';
  const responses: Record<string, APIResponse> = {};
  const requestFields: Record<string, APIField> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 提取 HTTP 方法和路径（如：POST /api/orders:）
    const methodMatch = line.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(.+):$/);
    if (methodMatch) {
      method = methodMatch[1];
      apiPath = methodMatch[2];
      continue;
    }

    // 提取摘要
    const summaryMatch = line.match(/^\s+summary:\s*(.+)$/);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
      continue;
    }

    // 提取 body 字段
    if (line.match(/^\s+body:/)) {
      parseFields(lines, i + 1, requestFields);
    }

    // 提取 response
    const respMatch = line.match(/^\s+(\d{3}):/);
    if (respMatch) {
      const statusCode = respMatch[1];
      const responseFields: Record<string, APIField> = {};
      parseFields(lines, i + 1, responseFields);
      responses[statusCode] = {
        description: '',
        body: responseFields,
      };
    }
  }

  if (!method || !apiPath) return null;

  return {
    method,
    path: apiPath,
    summary: summary || `${method} ${apiPath}`,
    request: {
      body: Object.keys(requestFields).length > 0 ? requestFields : undefined,
    },
    responses,
    filePath,
    taskId,
  };
}

/**
 * 从 YAML 行解析字段定义
 */
function parseFields(lines: string[], startIndex: number, fields: Record<string, APIField>): void {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];

    // 匹配字段行（缩进 4 格以上）
    const fieldMatch = line.match(/^\s{4,}(\w+):\s*$/);
    if (fieldMatch) {
      const fieldName = fieldMatch[1];
      const field: APIField = { type: 'string', required: false };
      fields[fieldName] = field;

      // 继续读取子字段
      for (let j = i + 1; j < lines.length; j++) {
        const subLine = lines[j];
        if (/^\s{2}\w/.test(subLine) || subLine.trim() === '') break; // 退出到外层

        const typeMatch = subLine.match(/^\s+type:\s*(.+)$/);
        if (typeMatch) field.type = typeMatch[1].trim();

        const requiredMatch = subLine.match(/^\s+required:\s*(true|false)/);
        if (requiredMatch) field.required = requiredMatch[1] === 'true';

        const descMatch = subLine.match(/^\s+description:\s*(.+)$/);
        if (descMatch) field.description = descMatch[1].trim();
      }
      continue;
    }

    // 如果退出缩进，停止解析
    if (/^\S/.test(line) && line.trim() !== '') break;
  }
}

/**
 * 为单个 API 端点生成测试用例
 */
function generateEndpointTests(contract: ScannedContract, suiteId: string, now: string): TestCase[] {
  const cases: TestCase[] = [];
  let caseIndex = 0;

  const taskId = contract.taskId;

  // 1. 正常请求测试
  if (contract.responses['200'] || contract.responses['201']) {
    const successResp = contract.responses['200'] || contract.responses['201'];
    caseIndex++;
    cases.push({
      id: `${suiteId}-${taskId}-TC-${String(caseIndex).padStart(3, '0')}`,
      name: `[API] ${contract.method} ${contract.path} - 正常请求`,
      type: 'api',
      status: 'draft',
      priority: 'high',
      suiteId,
      requirementIds: [taskId],
      relatedAC: [`验证 ${contract.method} ${contract.path} 正常响应`],
      preconditions: ['API 服务已启动', '测试数据已准备'],
      steps: [
        { step: 1, action: `发送 ${contract.method} 请求到 ${contract.path}，携带有效请求参数`, expected: `返回 ${successResp ? '200/201' : '2xx'} 状态码` },
        { step: 2, action: '验证响应体结构', expected: '响应体包含必要字段，类型正确' },
        { step: 3, action: '验证响应数据', expected: '返回数据与请求一致' },
      ],
      tags: ['api', taskId, 'happy-path'],
      createdAt: now,
      updatedAt: now,
    });
  }

  // 2. 必填字段缺失测试
  if (contract.request.body) {
    const requiredFields = Object.entries(contract.request.body)
      .filter(([, field]) => field.required);

    for (const [fieldName, field] of requiredFields) {
      caseIndex++;
      cases.push({
        id: `${suiteId}-${taskId}-TC-${String(caseIndex).padStart(3, '0')}`,
        name: `[API] ${contract.method} ${contract.path} - 缺少必填字段 ${fieldName}`,
        type: 'api',
        status: 'draft',
        priority: 'high',
        suiteId,
        requirementIds: [taskId],
        relatedAC: [`验证 ${fieldName} 为必填时的错误处理`],
        preconditions: ['API 服务已启动'],
        steps: [
          { step: 1, action: `发送 ${contract.method} 请求，不传 ${fieldName} 字段`, expected: '返回 400 状态码' },
          { step: 2, action: '验证错误响应格式', expected: `错误信息明确提示 ${fieldName} 为必填` },
          { step: 3, action: '验证系统状态未变更', expected: '数据未被错误修改' },
        ],
        tags: ['api', taskId, 'validation', 'error'],
        createdAt: now,
        updatedAt: now,
      });
    }

    // 3. 字段类型错误测试
    const typeValidFields = Object.entries(contract.request.body)
      .filter(([, field]) => ['number', 'integer', 'boolean', 'array'].includes(field.type));

    for (const [fieldName, field] of typeValidFields) {
      caseIndex++;
      const wrongType = getWrongType(field.type);
      cases.push({
        id: `${suiteId}-${taskId}-TC-${String(caseIndex).padStart(3, '0')}`,
        name: `[API] ${contract.method} ${contract.path} - ${fieldName} 类型错误（期望 ${field.type}，发送 ${wrongType}）`,
        type: 'api',
        status: 'draft',
        priority: 'medium',
        suiteId,
        requirementIds: [taskId],
        relatedAC: [`验证 ${fieldName} 类型校验（${field.type}）`],
        preconditions: ['API 服务已启动'],
        steps: [
          { step: 1, action: `发送 ${contract.method} 请求，${fieldName} 传入 ${wrongType} 类型值`, expected: '返回 400 或 422 状态码' },
          { step: 2, action: '验证错误响应', expected: `错误信息提示 ${fieldName} 类型不匹配` },
        ],
        tags: ['api', taskId, 'validation', 'type-check'],
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 4. 约束条件测试（min/max/pattern）
  if (contract.request.body) {
    for (const [fieldName, field] of Object.entries(contract.request.body)) {
      if (field.constraints?.min !== undefined) {
        caseIndex++;
        const min = field.constraints.min;
        cases.push({
          id: `${suiteId}-${taskId}-TC-${String(caseIndex).padStart(3, '0')}`,
          name: `[API] ${contract.method} ${contract.path} - ${fieldName} 边界值（< ${min}）`,
          type: 'api',
          status: 'draft',
          priority: 'medium',
          suiteId,
          requirementIds: [taskId],
          relatedAC: [`验证 ${fieldName} 最小值约束（min: ${min}）`],
          preconditions: ['API 服务已启动'],
          steps: [
            { step: 1, action: `发送 ${contract.method} 请求，${fieldName} 传入 ${min - 1}`, expected: '返回 400 状态码' },
            { step: 2, action: '验证错误响应', expected: `错误信息提示 ${fieldName} 不能小于 ${min}` },
          ],
          tags: ['api', taskId, 'boundary'],
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  // 5. 404 Not Found 测试（如果路径包含参数）
  if (contract.path.includes('{') || contract.path.includes(':')) {
    caseIndex++;
    cases.push({
      id: `${suiteId}-${taskId}-TC-${String(caseIndex).padStart(3, '0')}`,
      name: `[API] ${contract.method} ${contract.path} - 资源不存在（404）`,
      type: 'api',
      status: 'draft',
      priority: 'low',
      suiteId,
      requirementIds: [taskId],
      relatedAC: ['验证不存在的资源返回 404'],
      preconditions: ['API 服务已启动'],
      steps: [
        { step: 1, action: `发送 ${contract.method} 请求，使用不存在的资源 ID`, expected: '返回 404 状态码' },
        { step: 2, action: '验证错误响应', expected: '返回友好的 404 错误信息' },
      ],
      tags: ['api', taskId, 'error', '404'],
      createdAt: now,
      updatedAt: now,
    });
  }

  return cases;
}

/**
 * 获取相反的类型（用于类型错误测试）
 */
function getWrongType(type: string): string {
  const map: Record<string, string> = {
    number: 'string',
    integer: 'string',
    boolean: 'number',
    array: 'string',
    string: 'number',
  };
  return map[type] || 'string';
}

/**
 * 将生成的 API 测试套件和用例保存到文件
 */
export function saveAPITestSuite(
  projectRoot: string,
  result: APITestResult
): string {
  const { suite, cases } = result;
  const suiteDir = getTestDir(projectRoot, suite.iteration);
  const apiSuiteDir = path.join(suiteDir, suite.id);

  fs.ensureDirSync(apiSuiteDir);

  // 保存套件定义
  const suitePath = path.join(apiSuiteDir, 'SUITE.yaml');
  fs.writeFileSync(suitePath, toSimpleYaml(suite), 'utf-8');

  // 保存用例
  const casesDir = path.join(apiSuiteDir, 'cases');
  fs.ensureDirSync(casesDir);

  for (const tc of cases) {
    const casePath = path.join(casesDir, `${tc.id}.yaml`);
    fs.writeFileSync(casePath, toSimpleYaml(tc), 'utf-8');
  }

  // 保存摘要
  const summaryPath = path.join(apiSuiteDir, 'SUMMARY.md');
  const summaryMd = generateAPISummaryMarkdown(result);
  fs.writeFileSync(summaryPath, summaryMd, 'utf-8');

  return apiSuiteDir;
}

function generateAPISummaryMarkdown(result: APITestResult): string {
  const { suite, cases, summary } = result;

  let md = `# ${suite.name}\n\n`;
  md += `> 自动生成于 ${new Date().toISOString()}\n\n`;
  md += `## 概览\n\n`;
  md += `| 指标 | 值 |\n`;
  md += `|------|----|\n`;
  md += `| API 端点 | ${summary.totalEndpoints} |\n`;
  md += `| 生成用例 | ${summary.generatedCases} |\n`;
  md += `| 跳过的端点 | ${summary.skippedEndpoints} |\n\n`;

  md += `## 用例清单\n\n`;
  md += `| ID | 名称 | 优先级 |\n`;
  md += `|----|------|--------|\n`;

  for (const tc of cases) {
    md += `| ${tc.id} | ${tc.name} | ${tc.priority} |\n`;
  }

  return md;
}

/**
 * 简单的对象转 YAML（不依赖 js-yaml）
 */
function toSimpleYaml(obj: Record<string, unknown>, indent = 0): string {
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
      yaml += toSimpleYaml(value as Record<string, unknown>, indent + 1);
    } else {
      yaml += `${prefix}${key}: ${String(value)}\n`;
    }
  }
  return yaml;
}
