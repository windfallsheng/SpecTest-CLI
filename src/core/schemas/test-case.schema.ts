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
 * 测试用例 Schema
 */
export const TestCaseSchema = z.object({
  /** 用例 ID，如 TC-001 */
  id: z.string().regex(/^TC-\d{3}$/, '用例 ID 格式：TC-001'),
  /** 用例名称 */
  name: z.string().min(1).max(200),
  /** 测试类型 */
  type: TestTypeSchema.default('unit'),
  /** 用例状态 */
  status: TestCaseStatusSchema.default('draft'),
  /** 优先级 */
  priority: PrioritySchema.default('medium'),
  /** 所属测试套件 */
  suiteId: z.string().min(1),
  /** 关联的需求 ID（AC 来源） */
  requirementIds: z.array(z.string()).default([]),
  /** 关联的验收标准 */
  relatedAC: z.array(z.string()).default([]),
  /** 前置条件 */
  preconditions: z.array(z.string()).default([]),
  /** 测试步骤 */
  steps: z.array(z.object({
    step: z.number().int().positive(),
    action: z.string().min(1),
    expected: z.string().min(1),
  })).default([]),
  /** 测试数据 */
  testData: z.record(z.unknown()).optional(),
  /** 标签 */
  tags: z.array(z.string()).default([]),
  /** 预估执行时间（分钟） */
  estimatedMinutes: z.number().int().positive().optional(),
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
