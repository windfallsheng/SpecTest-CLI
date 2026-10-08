import { z } from 'zod';

/**
 * 幂等套件 ID：TS-{端}-{单元slug}-{类型}
 * 重跑覆盖不新增（废除时间戳 ID）。
 */
export const SuiteIdSchema = z.string().regex(
  /^TS-[a-z0-9-]+-[a-z0-9-]+-(unit|integration|e2e|api|performance|security)$/,
  '套件 ID 格式：TS-{端}-{单元}-{类型}'
);

/**
 * 测试套件 Schema
 */
export const TestSuiteSchema = z.object({
  /** 套件 ID（幂等） */
  id: SuiteIdSchema,
  /** 套件名称 */
  name: z.string().min(1).max(200),
  /** 套件描述 */
  description: z.string().max(500).default(''),
  /** 关联的期次（最近一次骨架预建/回写的期次） */
  iteration: z.string().min(1),
  /** 诞生期次（用例资产项目级复用：首次预建该套件的期次） */
  bornIteration: z.string().optional(),
  /** 目标端（标准端名，与 SpecCore CONSTITUTION.md 端列表一致，禁止 api/web/frontend 简写） */
  platform: z.string().min(1),
  /** 功能单元 */
  unit: z.string().min(1),
  /** 套件负责人（源自 SpecCore 任务分配/STAFFING；未登记时缺省） */
  owner: z.string().max(50).optional(),
  /** 包含的用例 ID 列表 */
  testCaseIds: z.array(z.string()).default([]),
  /** @deprecated 旧字段，Step 3 迁移消费方后删除 */
  taskIds: z.array(z.string()).optional(),
  /** 测试类型 */
  type: z.enum(['unit', 'integration', 'e2e', 'api', 'performance', 'security']).default('unit'),
  /** 标签 */
  tags: z.array(z.string()).default([]),
  /** 通过率 */
  passRate: z.number().min(0).max(100).default(0),
  /** 双产物版本锚：spec 源路径 + 内容 hash（AC 变化检测的事实依据） */
  specSource: z.object({
    testPath: z.string(),
    contentHash: z.string(),
    acCount: z.number().int().nonnegative(),
  }).optional(),
  /** 创建时间 */
  createdAt: z.string().datetime(),
  /** 更新时间 */
  updatedAt: z.string().datetime(),
});

/**
 * 测试执行记录 Schema
 */
export const TestRunSchema = z.object({
  /** 执行 ID */
  id: z.string().min(1),
  /** 关联的套件 ID */
  suiteId: z.string().min(1),
  /** 执行状态 */
  status: z.enum(['running', 'completed', 'failed', 'aborted']),
  /** 开始时间 */
  startedAt: z.string().datetime(),
  /** 结束时间 */
  endedAt: z.string().datetime().optional(),
  /** 总用例数 */
  totalCases: z.number().int().nonnegative().default(0),
  /** 通过数 */
  passedCases: z.number().int().nonnegative().default(0),
  /** 失败数 */
  failedCases: z.number().int().nonnegative().default(0),
  /** 跳过数 */
  skippedCases: z.number().int().nonnegative().default(0),
  /** 用例执行结果 */
  caseResults: z.array(z.object({
    caseId: z.string(),
    status: z.enum(['passed', 'failed', 'skipped', 'blocked']),
    duration: z.number().optional(),
    error: z.string().optional(),
  })).default([]),
  /** 创建时间 */
  createdAt: z.string().datetime(),
});

/**
 * 覆盖分析报告 Schema
 */
export const CoverageReportSchema = z.object({
  /** 报告 ID */
  id: z.string().min(1),
  /** 期次 */
  iteration: z.string().min(1),
  /** 总 AC 数 */
  totalAC: z.number().int().nonnegative().default(0),
  /** 已覆盖 AC 数（有 caseIds 的 AC） */
  coveredAC: z.number().int().nonnegative().default(0),
  /** AC 覆盖率百分比 */
  coverageRate: z.number().min(0).max(100).default(0),
  /** 规格缺口（TEST.md 骨架/缺失） */
  specGaps: z.array(z.object({
    platform: z.string(),
    unit: z.string(),
    reason: z.string(),
  })).default([]),
  /** 覆盖缺口（AC 在而用例无） */
  gapItems: z.array(z.object({
    platform: z.string(),
    unit: z.string(),
    acId: z.string(),
    acDesc: z.string(),
    scenario: z.string(),
    /** @deprecated 旧结构字段，Step 4 迁移 coverage-analyzer 后删除 */
    requirementId: z.string().optional(),
    requirementName: z.string().optional(),
    missingAC: z.array(z.string()).optional(),
    suggestedTests: z.array(z.string()).optional(),
  })).default([]),
  /** @deprecated 旧字段，Step 4 迁移后删除 */
  totalRequirements: z.number().int().nonnegative().optional(),
  /** @deprecated 旧字段，Step 4 迁移后删除 */
  coveredRequirements: z.number().int().nonnegative().optional(),
  /** @deprecated 旧字段，Step 4 迁移后删除 */
  risks: z.array(z.object({
    requirementId: z.string(),
    riskLevel: z.enum(['high', 'medium', 'low']),
    reason: z.string(),
  })).optional(),
  /** 生成时间 */
  generatedAt: z.string().datetime(),
});

export type TestSuite = z.infer<typeof TestSuiteSchema>;
export type TestRun = z.infer<typeof TestRunSchema>;
export type CoverageReport = z.infer<typeof CoverageReportSchema>;
