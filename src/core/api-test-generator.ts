import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { TestCase, TestSuite } from './schemas/index.js';
import { findIterationDir, buildSuiteId, buildApiCaseId } from './spec-reader.js';
import { ensureUnitMatrix, registerCase, rebuildIndex } from './trace-matrix.js';
import { getSuiteDir } from './suite-skeleton.js';

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
  /** 标准端名（服务端，与 SpecCore CONSTITUTION.md 一致） */
  platform: string;
  suiteName?: string;
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
 * API 测试生成引擎（契约面确定性生成）
 *
 * 从 spec-core 产出的 `030-tasks/<Task组>/_shared/API_CONTRACT.yaml` 生成接口测试用例：
 * - 幂等套件 ID：TS-{端}-api-contract-api
 * - 幂等用例 ID：TS-{端}-api-contract-api-EP-{端点编号}（契约面锚端点，不锚 AC）
 * - 五类场景：正常请求 / 缺必填字段 / 字段类型错误 / 约束边界 / 404
 */
export function generateAPITests(options: APITestOptions): APITestResult {
  const { projectRoot, iteration, platform, suiteName } = options;

  // 1. 扫描期次中的 API_CONTRACT.yaml（真实坐标）
  const contracts = scanAPIContracts(projectRoot, iteration);

  if (contracts.length === 0) {
    throw new Error(
      `期次 ${iteration} 中没有找到 API_CONTRACT.yaml 文件。\n` +
      `请确保 spec-core 开发完成后已生成 API 契约文件（030-tasks/<Task组>/_shared/API_CONTRACT.yaml）。`
    );
  }

  // 2. 为每个 API 端点生成测试用例
  const testCases: TestCase[] = [];
  let skippedEndpoints = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < contracts.length; i++) {
    const cases = generateEndpointTests(contracts[i], platform, i + 1, now);
    if (cases.length === 0) {
      skippedEndpoints++;
    }
    testCases.push(...cases);
  }

  // 3. 构建测试套件（幂等 ID）
  const suiteId = buildSuiteId(platform, 'api-contract', 'api');
  const suite: TestSuite = {
    id: suiteId,
    name: suiteName || `${platform} API 契约测试套件`,
    description: `API_CONTRACT.yaml 契约面测试套件 - ${iteration}`,
    iteration,
    platform,
    unit: 'api-contract',
    testCaseIds: testCases.map(tc => tc.id),
    type: 'api',
    tags: ['api', 'contract', 'auto-generated'],
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
 * 扫描期次中的 API Contract 文件（真实坐标：
 * Iteration-NNN/030-tasks/<Task组>/_shared/API_CONTRACT.yaml，回退 00-specs/）
 */
interface ScannedContract extends APIContract {
  filePath: string;
  taskId: string;
}

function scanAPIContracts(projectRoot: string, iteration: string): ScannedContract[] {
  const contracts: ScannedContract[] = [];
  const iterationDir = findIterationDir(projectRoot, iteration);
  if (!iterationDir) return [];

  // 递归收集候选路径
  const candidates: string[] = [];
  collectContractPaths(iterationDir, candidates);

  for (const cp of candidates) {
    const taskId = deriveTaskId(iterationDir, cp);
    try {
      const parsed = parseAPIContract(fs.readFileSync(cp, 'utf-8'), cp, taskId);
      if (parsed) contracts.push(parsed);
    } catch {
      console.warn(`⚠️ 跳过无法解析的 API Contract: ${cp}`);
    }
  }

  return contracts;
}

/** 递归找 API_CONTRACT.yaml（优先 _shared/，兼容 00-specs/ 回退） */
function collectContractPaths(dir: string, out: string[], depth = 0): void {
  if (depth > 4) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      collectContractPaths(path.join(dir, e.name), out, depth + 1);
    } else if ((e.name === 'API_CONTRACT.yaml' || e.name === 'API_CONTRACT.yml') && !out.includes(path.join(dir, e.name))) {
      out.push(path.join(dir, e.name));
    }
  }
}

function deriveTaskId(iterationDir: string, contractPath: string): string {
  const rel = path.relative(iterationDir, contractPath);
  const m = rel.match(/(Task-[^/]+)/);
  return m ? m[1] : 'unknown-task';
}

/**
 * js-yaml 解析契约（结构自适应：支持 endpoints 包装或顶层端点键）
 */
function parseAPIContract(content: string, filePath: string, taskId: string): ScannedContract | null {
  const doc = yaml.load(content, { schema: yaml.CORE_SCHEMA }) as Record<string, unknown> | null;
  if (!doc || typeof doc !== 'object') return null;

  const epRaw = doc.endpoints;
  const endpoints: Record<string, unknown> =
    (epRaw && typeof epRaw === 'object' && !Array.isArray(epRaw))
      ? (epRaw as Record<string, unknown>)
      : Object.fromEntries(Object.entries(doc).filter(([k]) => /^(GET|POST|PUT|DELETE|PATCH)\s+\S+/.test(k)));

  const found: ScannedContract[] = [];
  for (const [key, value] of Object.entries(endpoints)) {
    if (!value || typeof value !== 'object') continue;
    const methodMatch = key.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/);
    if (!methodMatch) continue;

    const ep = value as Record<string, unknown>;
    const req = (ep.request ?? {}) as Record<string, unknown>;
    const responses = (ep.responses ?? {}) as Record<string, unknown>;

    found.push({
      method: methodMatch[1],
      path: methodMatch[2],
      summary: String(ep.summary ?? `${methodMatch[1]} ${methodMatch[2]}`),
      description: ep.description ? String(ep.description) : undefined,
      tags: Array.isArray(ep.tags) ? ep.tags.map(String) : undefined,
      request: {
        headers: normalizeFields(req.headers),
        params: normalizeFields(req.params),
        query: normalizeFields(req.query),
        body: normalizeFields(req.body),
      },
      responses: normalizeResponses(responses),
      filePath,
      taskId,
    });
  }

  return found.length > 0 ? found[0] : null;
}

function normalizeFields(raw: unknown): Record<string, APIField> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const fields: Record<string, APIField> = {};
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const f = v as Record<string, unknown>;
    fields[name] = {
      type: String(f.type ?? 'string'),
      required: f.required === true,
      description: f.description ? String(f.description) : undefined,
      constraints: (f.min !== undefined || f.max !== undefined || f.pattern !== undefined)
        ? {
            min: typeof f.min === 'number' ? f.min : undefined,
            max: typeof f.max === 'number' ? f.max : undefined,
            pattern: f.pattern ? String(f.pattern) : undefined,
          }
        : undefined,
      example: f.example,
    };
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

function normalizeResponses(raw: Record<string, unknown>): Record<string, APIResponse> {
  const responses: Record<string, APIResponse> = {};
  for (const [code, v] of Object.entries(raw)) {
    if (!/^\d{3}$/.test(code) || !v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    responses[code] = {
      description: String(r.description ?? ''),
      body: normalizeFields(r.body),
      headers: normalizeFields(r.headers),
    };
  }
  return responses;
}

/**
 * 为单个 API 端点生成五类场景用例
 */
function generateEndpointTests(
  contract: ScannedContract, platform: string, endpointIndex: number, now: string
): TestCase[] {
  const cases: TestCase[] = [];
  const taskId = contract.taskId;
  const caseId = (n: number) => buildApiCaseId(platform, 'api-contract', endpointIndex * 10 + n);
  let caseIndex = 0;

  // 1. 正常请求测试
  if (contract.responses['200'] || contract.responses['201']) {
    caseIndex++;
    cases.push({
      id: caseId(caseIndex),
      name: `[API] ${contract.method} ${contract.path} - 正常请求`,
      type: 'api',
      status: 'draft',
      priority: 'high',
      scenario: 'happy',
      suiteId: buildSuiteId(platform, 'api-contract', 'api'),
      relatedAC: [],
      preconditions: ['API 服务已启动', '测试数据已准备'],
      testData: buildExecutableRequest(contract, 'happy'),
      steps: [
        { step: 1, action: `发送 ${contract.method} 请求到 ${contract.path}，携带有效请求参数`, expected: '返回 200/201 状态码' },
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

    for (const [fieldName] of requiredFields) {
      caseIndex++;
      cases.push({
        id: caseId(caseIndex),
        name: `[API] ${contract.method} ${contract.path} - 缺少必填字段 ${fieldName}`,
        type: 'api',
        status: 'draft',
        priority: 'high',
        scenario: 'error',
        suiteId: buildSuiteId(platform, 'api-contract', 'api'),
        relatedAC: [],
        preconditions: ['API 服务已启动'],
        testData: buildExecutableRequest(contract, 'missing-field', fieldName),
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
        id: caseId(caseIndex),
        name: `[API] ${contract.method} ${contract.path} - ${fieldName} 类型错误（期望 ${field.type}，发送 ${wrongType}）`,
        type: 'api',
        status: 'draft',
        priority: 'medium',
        scenario: 'error',
        suiteId: buildSuiteId(platform, 'api-contract', 'api'),
        relatedAC: [],
        preconditions: ['API 服务已启动'],
        testData: buildExecutableRequest(contract, 'wrong-type', fieldName),
        steps: [
          { step: 1, action: `发送 ${contract.method} 请求，${fieldName} 传入 ${wrongType} 类型值`, expected: '返回 400 或 422 状态码' },
          { step: 2, action: '验证错误响应', expected: `错误信息提示 ${fieldName} 类型不匹配` },
        ],
        tags: ['api', taskId, 'validation', 'type-check'],
        createdAt: now,
        updatedAt: now,
      });
    }

    // 4. 约束条件测试（min/max）
    for (const [fieldName, field] of Object.entries(contract.request.body)) {
      if (field.constraints?.min !== undefined) {
        caseIndex++;
        const min = field.constraints.min;
        cases.push({
          id: caseId(caseIndex),
          name: `[API] ${contract.method} ${contract.path} - ${fieldName} 边界值（< ${min}）`,
          type: 'api',
          status: 'draft',
          priority: 'medium',
          scenario: 'boundary',
          suiteId: buildSuiteId(platform, 'api-contract', 'api'),
          relatedAC: [],
          preconditions: ['API 服务已启动'],
          testData: buildExecutableRequest(contract, 'boundary', fieldName),
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

  // 5. 404 Not Found 测试（路径含参数）
  if (contract.path.includes('{') || contract.path.includes(':')) {
    caseIndex++;
    cases.push({
      id: caseId(caseIndex),
      name: `[API] ${contract.method} ${contract.path} - 资源不存在（404）`,
      type: 'api',
      status: 'draft',
      priority: 'low',
      scenario: 'edge',
      suiteId: buildSuiteId(platform, 'api-contract', 'api'),
      relatedAC: [],
      preconditions: ['API 服务已启动'],
      testData: buildExecutableRequest(contract, 'not-found'),
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
 * 组装可执行请求信息（契约执行器的单一事实源）
 *
 * 写入用例 testData：method/path/query/body/expectStatus。
 * 契约执行器（contract-runner）直接读 testData 执行，不重新推断。
 */
function buildExecutableRequest(
  contract: ScannedContract,
  kind: 'happy' | 'missing-field' | 'wrong-type' | 'boundary' | 'not-found',
  fieldName?: string
): Record<string, unknown> {
  const body = contract.request.body ? buildDefaultBody(contract.request.body, fieldName, kind) : undefined;
  const path = resolvePathParams(contract.path, kind);

  const expectStatus = (() => {
    switch (kind) {
      case 'happy': return contract.responses['200'] ? 200 : 201;
      case 'not-found': return 404;
      case 'wrong-type': return 422;
      default: return 400;
    }
  })();

  return {
    method: contract.method,
    path,
    ...(body !== undefined ? { body } : {}),
    ...(contract.request.query ? { query: buildDefaultBody(contract.request.query) } : {}),
    expectStatus,
    kind,
  };
}

/** 按字段类型生成默认值；缺必填/类型错误/边界场景按 kind 变形 */
function buildDefaultBody(
  fields: Record<string, APIField>,
  targetField?: string,
  kind?: string
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(fields)) {
    if (kind === 'missing-field' && name === targetField) continue; // 去掉必填字段
    let v = f.example ?? defaultValueFor(f.type);
    if (kind === 'wrong-type' && name === targetField) {
      v = getWrongType(f.type) === 'number' ? 12345 : 'not-a-valid-type';
    }
    if (kind === 'boundary' && name === targetField) {
      v = (f.constraints?.min ?? 1) - 1; // 边界外值 min-1
    }
    out[name] = v;
  }
  return out;
}

/** 类型 → 默认示例值 */
function defaultValueFor(type: string): unknown {
  switch (type) {
    case 'integer':
    case 'number': return 1;
    case 'boolean': return true;
    case 'array': return [];
    case 'object': return {};
    default: return 'test-value';
  }
}

/** 路径参数替换：{id} → 默认值；404 场景用不存在的 ID */
function resolvePathParams(rawPath: string, kind: string): string {
  return rawPath.replace(/\{([^}]+)\}/g, () => (kind === 'not-found' ? '999999-nonexistent' : '1'));
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
 * 保存 API 测试套件（端优先目录 + js-yaml + 矩阵登记）
 */
export function saveAPITestSuite(
  projectRoot: string,
  result: APITestResult
): string {
  const { suite, cases } = result;
  const suiteDir = getSuiteDir(projectRoot, suite.iteration, suite.platform, 'api-contract', suite.id);

  fs.ensureDirSync(suiteDir);

  // 契约面矩阵（无 AC，cases 承载执行状态回填）
  ensureUnitMatrix(projectRoot, suite.iteration, suite.platform, 'API 契约', 'api-contract', []);

  // 保存套件定义
  fs.writeFileSync(path.join(suiteDir, 'SUITE.yaml'), yaml.dump(suite, { noRefs: true }), 'utf-8');

  // 保存用例 + 矩阵登记
  const casesDir = path.join(suiteDir, 'cases');
  fs.ensureDirSync(casesDir);

  for (const tc of cases) {
    fs.writeFileSync(path.join(casesDir, `${tc.id}.yaml`), yaml.dump(tc, { noRefs: true }), 'utf-8');
    registerCase(projectRoot, suite.iteration, suite.platform, 'api-contract', tc.id, [], tc.priority);
  }

  // 保存摘要
  fs.writeFileSync(path.join(suiteDir, 'SUMMARY.md'), generateAPISummaryMarkdown(result), 'utf-8');

  // 重建索引
  try {
    rebuildIndex(projectRoot, suite.iteration);
  } catch {
    // 索引失败不阻塞保存（下次 rebuildIndex 自愈）
  }

  return suiteDir;
}

function generateAPISummaryMarkdown(result: APITestResult): string {
  const { suite, cases, summary } = result;

  let md = `# ${suite.name}\n\n`;
  md += `> 生成于 ${new Date().toISOString()}\n\n`;
  md += `## 概览\n\n`;
  md += `| 指标 | 值 |\n`;
  md += `|------|----|\n`;
  md += `| API 端点 | ${summary.totalEndpoints} |\n`;
  md += `| 生成用例 | ${summary.generatedCases} |\n`;
  md += `| 跳过的端点 | ${summary.skippedEndpoints} |\n\n`;

  md += `## 用例清单\n\n`;
  md += `| ID | 名称 | 场景 | 优先级 |\n`;
  md += `|----|------|------|--------|\n`;

  for (const tc of cases) {
    md += `| ${tc.id} | ${tc.name} | ${tc.scenario} | ${tc.priority} |\n`;
  }

  return md;
}
