import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { runContractTests, runContractMatrix } from '../../src/core/contract-runner.js';
import { ensureUnitMatrix, registerCase } from '../../src/core/trace-matrix.js';

/**
 * 契约执行扩展能力：priority（P0）/ 用例级过滤 / 失败重试 / 环境矩阵
 */

const CASE_HIGH = 'TS-booking-service-api-contract-api-EP-001'; // priority high，期望 201
const CASE_LOW = 'TS-booking-service-api-contract-api-EP-005';  // priority low，期望 404

afterEach(() => {
  vi.unstubAllGlobals();
});

/** mock 全局 fetch：按调用顺序依次返回状态码（耗尽后返回 500） */
function mockFetchSequence(statuses: number[]): void {
  const queue = [...statuses];
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: queue.shift() ?? 500 })));
}

function writeCase(casesDir: string, caseId: string, priority: 'high' | 'low', expectStatus: number): void {
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(casesDir, `${caseId}.yaml`),
    `id: ${caseId}
name: "[API] 契约用例"
type: api
status: draft
priority: ${priority}
scenario: happy
suiteId: TS-booking-service-api-contract-api
relatedAC: []
preconditions: ['API 服务已启动']
steps:
  - step: 1
    action: 发送请求
    expected: 返回 ${expectStatus}
testData:
  method: GET
  path: /api/ping
  expectStatus: ${expectStatus}
tags: [api]
createdAt: ${now}
updatedAt: ${now}
`,
    'utf-8'
  );
}

/** 造项目：GLOBAL 用例资产（全量层）+ 迭代层矩阵 + test 环境 */
function setupProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-filter-'));
  const iteration = 'Iteration-002-mock';

  // 迭代层矩阵登记（执行事实落点）
  ensureUnitMatrix(root, iteration, 'booking-service', 'API 契约', 'api-contract', []);
  registerCase(root, iteration, 'booking-service', 'api-contract', CASE_HIGH, []);
  registerCase(root, iteration, 'booking-service', 'api-contract', CASE_LOW, []);

  // 全量层用例资产（GLOBAL/cases）
  const casesDir = path.join(
    root, '.spectest', 'GLOBAL', 'cases', 'booking-service', 'api-contract',
    'suites', 'TS-booking-service-api-contract-api', 'cases'
  );
  fs.ensureDirSync(casesDir);
  writeCase(casesDir, CASE_HIGH, 'high', 201);
  writeCase(casesDir, CASE_LOW, 'low', 404);

  // 环境：test 有配置；uat 故意缺（矩阵测试用）
  fs.ensureDirSync(path.join(root, '.spectest', 'environments'));
  fs.writeFileSync(path.join(root, '.spectest', 'environments', 'test.yaml'), 'baseUrl: http://mock.local\n');

  return { root, iteration };
}

describe('契约执行扩展：过滤 / 重试 / 环境矩阵', () => {
  it('priority=high 只跑 P0 用例（与 gate 的 P0 定义一致）', async () => {
    const env = setupProject();
    mockFetchSequence([201, 201]);
    const result = await runContractTests({
      projectRoot: env.root, iteration: env.iteration, env: 'test', priority: 'high',
    });
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(vi.mocked(fetch as unknown as (...a: unknown[]) => unknown).mock.calls).toHaveLength(1);
  });

  it('caseIds 用例级过滤：只执行白名单内的用例', async () => {
    const env = setupProject();
    mockFetchSequence([404]);
    const result = await runContractTests({
      projectRoot: env.root, iteration: env.iteration, env: 'test', caseIds: [CASE_LOW],
    });
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
  });

  it('retry=1：首次失败、重试成功 → 通过且 retried 计数', async () => {
    const env = setupProject();
    mockFetchSequence([500, 201]);
    const result = await runContractTests({
      projectRoot: env.root, iteration: env.iteration, env: 'test',
      priority: 'high', retry: 1,
    });
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.retried).toBe(1);
    expect(vi.mocked(fetch as unknown as (...a: unknown[]) => unknown).mock.calls).toHaveLength(2);
  });

  it('retry=1：重试仍失败 → failed 且原因标注重试', async () => {
    const env = setupProject();
    mockFetchSequence([500, 500]);
    const result = await runContractTests({
      projectRoot: env.root, iteration: env.iteration, env: 'test',
      priority: 'high', retry: 1,
    });
    expect(result.total).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.retried).toBe(1);
    expect(result.failures[0].reason).toContain('重试 1 次后仍失败');
  });

  it('环境矩阵：test 全通过、uat 缺配置如实 skipped（互不影响）', async () => {
    const env = setupProject();
    mockFetchSequence([201, 404]);
    const entries = await runContractMatrix({
      projectRoot: env.root, iteration: env.iteration, envs: ['test', 'uat'],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].env).toBe('test');
    expect(entries[0].result.total).toBe(2);
    expect(entries[0].result.passed).toBe(2);
    expect(entries[1].env).toBe('uat');
    expect(entries[1].result.total).toBe(0);
    expect(entries[1].result.skippedReasons[0]).toContain('环境配置 uat 不存在');
  });
});
