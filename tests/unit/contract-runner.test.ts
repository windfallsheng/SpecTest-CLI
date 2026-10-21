import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { runContractTests } from '../../src/core/contract-runner';

/**
 * 契约执行器（SpecTest 唯一「真能自己跑」的层）集成测试：
 * 本地 HTTP server 驱动真实请求 + 状态码断言 + 矩阵回填。
 */
describe('runContractTests 契约执行', () => {
  let root: string;
  let server: http.Server;
  let port: number;
  /** 服务端行为：status 返回码 */
  let respondStatus: number;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-contract-'));
    fs.ensureDirSync(path.join(root, '.spectest'));
    respondStatus = 200;

    server = http.createServer((_req, res) => {
      res.statusCode = respondStatus;
      res.end('{"ok": true}');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.removeSync(root);
  });

  function writeEnv(): void {
    const dir = path.join(root, '.spectest', 'environments');
    fs.ensureDirSync(dir);
    fs.writeFileSync(path.join(dir, 'test.yaml'), `baseUrl: http://127.0.0.1:${port}\ntimeoutMs: 2000\nheaders:\n  Content-Type: application/json\n`, 'utf-8');
  }

  function writeContractCase(expectStatus: number, file = 'TS-backend-service-api-contract-api-EP-001.yaml'): void {
    const mDir = path.join(root, '.spectest', 'iterations', 'Q1', 'backend-service', 'api-contract', 'matrix');
    fs.ensureDirSync(mDir);
    fs.writeFileSync(path.join(mDir, 'trace.yaml'), `unit: api-contract
unitSlug: api-contract
platform: backend-service
updatedAt: 2026-01-01T00:00:00.000Z
traces: []
cases:
  - caseId: TS-backend-service-api-contract-api-EP-001
    status: ready
    priority: high
`);

    const cDir = path.join(root, '.spectest', 'GLOBAL', 'cases', 'backend-service', 'api-contract', 'suites', 'TS-backend-service-api-contract-api', 'cases');
    fs.ensureDirSync(cDir);
    fs.writeFileSync(path.join(cDir, file), `id: TS-backend-service-api-contract-api-EP-001
name: 获取用户列表
type: api
priority: high
scenario: happy
suiteId: TS-backend-service-api-contract-api
preconditions: []
steps:
  - step: 1
    action: GET /users
    expected: '${expectStatus}'
testData:
  method: GET
  path: /users
  expectStatus: ${expectStatus}
createdAt: 2026-01-01T00:00:00.000Z
updatedAt: 2026-01-01T00:00:00.000Z
`);
  }

  it('环境配置缺失 → 如实报缺 skipped，不造假', async () => {
    writeContractCase(200);
    const result = await runContractTests({ projectRoot: root, iteration: 'Q1', env: 'test' });
    expect(result.total).toBe(0);
    expect(result.skippedReasons.some((r) => r.includes('环境配置'))).toBe(true);
  });

  it('状态码匹配 → passed 并回填矩阵', async () => {
    writeEnv();
    writeContractCase(200);
    const result = await runContractTests({ projectRoot: root, iteration: 'Q1', env: 'test' });
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);

    // 结果归一回填：矩阵 cases 状态已更新
    const matrix = fs.readFileSync(
      path.join(root, '.spectest', 'iterations', 'Q1', 'backend-service', 'api-contract', 'matrix', 'trace.yaml'),
      'utf-8'
    );
    expect(matrix).toContain('status: passed');
  });

  it('状态码不匹配（服务端 404 vs expectStatus 200）→ failed', async () => {
    writeEnv();
    writeContractCase(200);
    respondStatus = 404;
    const result = await runContractTests({ projectRoot: root, iteration: 'Q1', env: 'test' });
    expect(result.failed).toBe(1);
    expect(result.failures[0].caseId).toBe('TS-backend-service-api-contract-api-EP-001');
  });

  it('优先级过滤：--priority high 只跑 P0 契约用例', async () => {
    writeEnv();
    writeContractCase(200);
    // 再放一个 low 优先级用例（不应执行）
    writeContractCase(200, 'TS-backend-service-api-contract-api-EP-002.yaml');
    const lowCasePath = path.join(
      root, '.spectest', 'GLOBAL', 'cases', 'backend-service', 'api-contract',
      'suites', 'TS-backend-service-api-contract-api', 'cases',
      'TS-backend-service-api-contract-api-EP-002.yaml'
    );
    let low = fs.readFileSync(lowCasePath, 'utf-8')
      .replace('TS-backend-service-api-contract-api-EP-001', 'TS-backend-service-api-contract-api-EP-002')
      .replace('priority: high', 'priority: low')
      .replace('name: 获取用户列表', 'name: 低频用例');
    fs.writeFileSync(lowCasePath, low, 'utf-8');

    const result = await runContractTests({
      projectRoot: root, iteration: 'Q1', env: 'test', priority: 'high',
    });
    expect(result.total).toBe(1);
  });
});
