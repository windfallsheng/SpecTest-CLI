import { z } from 'zod';

/**
 * 测试套件 Schema
 */
export const TestSuiteSchema = z.object({
  /** 套件 ID，如 TS-001 */
  id: z.string().regex(/^TS-\d{3}$/, '套件 ID 格式：TS-001'),
  /** 套件名称 */
  name: z.string().min(1).max(200),
  /** 套件描述 */
  description: z.string().max(500).default(''),
  /** 关联的期次 */
  iteration: z.string().min(1),
  /** 关联的任务列表 */
  taskIds: z.array(z.string()).default([]),
  /** 包含的用例 ID 列表 */
  testCaseIds: z.array(z.string()).default([]),
  /** 测试类型 */
  type: z.enum(['unit', 'integration', 'e2e', 'api', 'performance', 'security']).default('unit'),
  /** 目标平台 */
  platform: z.enum(['backend', 'frontend', 'fullstack']).default('fullstack'),
  /** 标签 */
  tags: z.array(z.string()).default([]),
  /** 通过率 */
  passRate: z.number().min(0).max(100).default(0),
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
  /** 总需求数 */
  totalRequirements: z.number().int().nonnegative().default(0),
  /** 已覆盖需求数 */
  coveredRequirements: z.number().int().nonnegative().default(0),
  /** 覆盖率百分比 */
  coverageRate: z.number().min(0).max(100).default(0),
  /** 总 AC 数 */
  totalAC: z.number().int().nonnegative().default(0),
  /** 已覆盖 AC 数 */
  coveredAC: z.number().int().nonnegative().default(0),
  /** 缺失的测试场景 */
  gapItems: z.array(z.object({
    requirementId: z.string(),
    requirementName: z.string(),
    missingAC: z.array(z.string()),
    suggestedTests: z.array(z.string()),
  })).default([]),
  /** 风险标注 */
  risks: z.array(z.object({
    requirementId: z.string(),
    riskLevel: z.enum(['high', 'medium', 'low']),
    reason: z.string(),
  })).default([]),
  /** 生成时间 */
  generatedAt: z.string().datetime(),
});

export type TestSuite = z.infer<typeof TestSuiteSchema>;
export type TestRun = z.infer<typeof TestRunSchema>;
export type CoverageReport = z.infer<typeof CoverageReportSchema>;
