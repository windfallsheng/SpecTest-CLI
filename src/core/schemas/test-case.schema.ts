import { z } from 'zod';

/**
 * 测试用例状态
 */
export const TestCaseStatusSchema = z.enum([
  'draft',        // 草稿
  'ready',        // 就绪
  'running',      // 执行中
  'passed',       // 通过
  'failed',       // 失败
  'skipped',      // 跳过
  'blocked',      // 阻塞
]);

/**
 * 测试类型
 */
export const TestTypeSchema = z.enum([
  'unit',         // 单元测试
  'integration',  // 集成测试
  'e2e',          // 端到端测试
  'api',          // API 测试
  'performance',  // 性能测试
  'security',     // 安全测试
]);

/**
 * 测试优先级
 */
export const PrioritySchema = z.enum(['high', 'medium', 'low']);

/**
 * 场景四象限（与 AC 场景检测对齐）
 */
export const ScenarioSchema = z.enum(['happy', 'error', 'edge', 'boundary']);

/**
 * 幂等用例 ID：
 * - AC 锚定（unit/integration/e2e/performance/security）：TS-{端}-{单元}-{类型}-AC-{编号}
 * - 端点锚定（api，契约面无 AC）：TS-{端}-{单元}-api-EP-{编号}
 */
export const CaseIdSchema = z.string().regex(
  /^TS-[a-z0-9-]+-[a-z0-9-]+-(?:(?:unit|integration|e2e|performance|security)-AC-\d{3}|api-EP-\d{3})$/,
  '用例 ID 格式：TS-{端}-{单元}-{类型}-AC-{编号}（api 类型为 TS-{端}-{单元}-api-EP-{编号}）'
);

/**
 * 测试用例 Schema
 */
export const TestCaseSchema = z.object({
  /** 用例 ID（锚定 AC，幂等） */
  id: CaseIdSchema,
  /** 用例名称 */
  name: z.string().min(1).max(200),
  /** 测试类型 */
  type: TestTypeSchema.default('unit'),
  /** 用例状态 */
  status: TestCaseStatusSchema.default('draft'),
  /** 优先级 */
  priority: PrioritySchema.default('medium'),
  /** 场景四象限 */
  scenario: ScenarioSchema.default('happy'),
  /** 所属测试套件 */
  suiteId: z.string().min(1),
  /** 关联的 AC 编号列表（追溯矩阵的证词） */
  relatedAC: z.array(z.string().regex(/^AC-\d{3}$/)).default([]),
  /** @deprecated 旧字段，Step 3 迁移消费方后删除 */
  requirementIds: z.array(z.string()).optional(),
  /** 前置条件 */
  preconditions: z.array(z.string()).default([]),
  /** 测试步骤（四段齐全：前置/步骤/数据/断言） */
  steps: z.array(z.object({
    step: z.number().int().positive(),
    action: z.string().min(1),
    expected: z.string().min(1),
  })).default([]),
  /** 测试数据 */
  testData: z.record(z.string(), z.unknown()).optional(),
  /** 标签 */
  tags: z.array(z.string()).default([]),
  /** 预估执行时间（分钟） */
  estimatedMinutes: z.number().int().positive().optional(),

  // ── 端专属扩展（按端取用，CLI 端级检查清单把关）──
  /** backend：事务边界 */
  transactionBoundary: z.string().optional(),
  /** backend：幂等场景 */
  idempotency: z.string().optional(),
  /** backend：并发场景 */
  concurrency: z.string().optional(),
  /** h5：元素选择器 */
  selector: z.string().optional(),
  /** h5：响应式视口 */
  viewport: z.string().optional(),
  /** h5：状态流转 */
  stateFlow: z.string().optional(),
  /** miniapp：生命周期时机 */
  lifecycle: z.string().optional(),
  /** app：机型矩阵 */
  deviceMatrix: z.string().optional(),
  /** app：弱网场景 */
  network: z.string().optional(),

  /** 实际执行结果 */
  actualResult: z.string().optional(),
  /** 失败原因 */
  failureReason: z.string().optional(),
  /** 创建时间 */
  createdAt: z.string().datetime(),
  /** 更新时间 */
  updatedAt: z.string().datetime(),
});

export type TestCase = z.infer<typeof TestCaseSchema>;
export type TestCaseStatus = z.infer<typeof TestCaseStatusSchema>;
export type TestType = z.infer<typeof TestTypeSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
