import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import http from 'http';
import { loadEnvironment, unresolvedVars } from '../../src/core/environment.js';
import { runContractTests } from '../../src/core/contract-runner.js';
import { detectFramework, parseCaseOutcomes, CASE_ID_RE } from '../../src/core/framework-run.js';
import { runStaticVerify } from '../../src/core/static-verify.js';
import { ensureUnitMatrix, registerCase, getIterationDir } from '../../src/core/trace-matrix.js';

// ── 真实 HTTP 服务器（契约执行的目标）──
let server: http.Server;
let serverPort: number;
let serverHitCount = 0;

beforeEach(() => {
  serverHitCount = 0;
});

afterAll(() => {
  if (server) server.close();
});

async function startMockServer(): Promise<void> {
  if (server) await new Promise((r) => server.close(r));
  server = http.createServer((req, res) => {
    serverHitCount++;
    const url = req.url ?? '';
    if (req.method === 'POST' && url === '/api/orders' && !url.includes('missing')) {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 1 }));
    } else if (url.includes('999999-nonexistent')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad request' }));
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = (server.address() as { port: number }).port;
      resolve();
    });
  });
}

function setupProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-step5-'));
  const iteration = 'Iteration-002-mock';
  const iterDir = path.join(root, iteration);

  // SpecCore 侧规格
  fs.ensureDirSync(path.join(iterDir, '020-specs', 'booking', 'booking-service'));
  fs.writeFileSync(
    path.join(iterDir, '020-specs', 'booking', 'booking-service', 'TEST.md'),
    `# 测试规格\n- [ ] AC-1: 当用户提交预订时，系统应创建订单\n`,
    'utf-8'
  );

  // 矩阵：api-contract 契约面
  ensureUnitMatrix(root, iteration, 'booking-service', 'API 契约', 'api-contract', []);

  // 契约用例（带 testData 可执行信息）
  const suiteDir = path.join(getIterationDir(root, iteration), 'booking-service', 'api-contract', 'suites', 'TS-booking-service-api-contract-api');
  fs.ensureDirSync(path.join(suiteDir, 'cases'));
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(suiteDir, 'cases', 'TS-booking-service-api-contract-api-EP-001.yaml'),
    `id: TS-booking-service-api-contract-api-EP-001
name: "[API] POST /api/orders - 正常请求"
type: api
status: draft
priority: high
scenario: happy
suiteId: TS-booking-service-api-contract-api
relatedAC: []
preconditions: ['API 服务已启动']
steps:
  - step: 1
    action: 发送 POST 请求
    expected: 返回 201 状态码
testData:
  method: POST
  path: /api/orders
  body:
    userId: 1
    amount: 100
  expectStatus: 201
tags: [api, happy-path]
createdAt: ${now}
updatedAt: ${now}
`,
    'utf-8'
  );
  // 404 用例
  fs.writeFileSync(
    path.join(suiteDir, 'cases', 'TS-booking-service-api-contract-api-EP-005.yaml'),
    `id: TS-booking-service-api-contract-api-EP-005
name: "[API] GET /api/orders/{id} - 资源不存在"
type: api
status: draft
priority: low
scenario: edge
suiteId: TS-booking-service-api-contract-api
relatedAC: []
preconditions: ['API 服务已启动']
steps:
  - step: 1
    action: 请求不存在的资源
    expected: 返回 404
testData:
  method: GET
  path: /api/orders/999999-nonexistent
  expectStatus: 404
tags: [api, '404']
createdAt: ${now}
updatedAt: ${now}
`,
    'utf-8'
  );
  registerCase(root, iteration, 'booking-service', 'api-contract', 'TS-booking-service-api-contract-api-EP-001', []);
  registerCase(root, iteration, 'booking-service', 'api-contract', 'TS-booking-service-api-contract-api-EP-005', []);

  return { root, iteration, iterDir };
}

describe('Step5 三层执行链', () => {
  describe('environment 环境配置', () => {
    it('loadEnvironment 解析 baseUrl + ${VAR} 占位', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-env-'));
      const envDir = path.join(root, '.spectest', 'environments');
      fs.ensureDirSync(envDir);
      fs.writeFileSync(path.join(envDir, 'test.yaml'), 'baseUrl: http://localhost:8080\ntimeoutMs: 3000\nheaders:\n  Authorization: "Bearer ${TOKEN}"\n', 'utf-8');

      process.env.TOKEN = 'secret123';
      const env = loadEnvironment(root, 'test');
      expect(env?.baseUrl).toBe('http://localhost:8080');
      expect(env?.headers.Authorization).toBe('Bearer secret123');
      expect(unresolvedVars(env!.headers)).toHaveLength(0);

      delete process.env.TOKEN;
      const env2 = loadEnvironment(root, 'test');
      expect(env2?.headers.Authorization).toBe('Bearer ${TOKEN}');
      expect(unresolvedVars(env2!.headers)).toHaveLength(1);
    });

    it('无环境配置 → null（报缺不脑补）', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-noenv-'));
      expect(loadEnvironment(root, 'test')).toBeNull();
    });
  });

  describe('contract-runner 契约执行器（真实 HTTP）', () => {
    it('真实请求 + 状态码断言：201 通过 / 404 通过', async () => {
      await startMockServer();
      const env = setupProject();
      fs.ensureDirSync(path.join(env.root, '.spectest', 'environments'));
      fs.writeFileSync(
        path.join(env.root, '.spectest', 'environments', 'test.yaml'),
        `baseUrl: http://127.0.0.1:${serverPort}\n`,
        'utf-8'
      );

      const result = await runContractTests({ projectRoot: env.root, iteration: env.iteration, env: 'test' });
      expect(result.total).toBe(2);
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(0);
      expect(serverHitCount).toBe(2);
    });

    it('无环境配置 → 如实 skipped，不造假', async () => {
      const env = setupProject();
      const result = await runContractTests({ projectRoot: env.root, iteration: env.iteration, env: 'test' });
      expect(result.total).toBe(0);
      expect(result.skippedReasons.length).toBeGreaterThan(0);
      expect(result.skippedReasons[0]).toContain('不存在');
    });
  });

  describe('framework-run 宿主框架调度', () => {
    it('detectFramework：vitest 依赖识别', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-fw-'));
      fs.writeJsonSync(path.join(root, 'package.json'), { devDependencies: { vitest: '^1.0.0' } });
      fs.ensureDirSync(path.join(root, 'tests'));
      const fw = detectFramework(root);
      expect(fw?.name).toBe('vitest');
      expect(fw?.testDir).toBe('tests');
    });

    it('detectFramework：无宿主框架 → null（如实）', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-nofw-'));
      fs.writeJsonSync(path.join(root, 'package.json'), {});
      expect(detectFramework(root)).toBeNull();
    });

    it('parseCaseOutcomes：解析 vitest 风格输出', () => {
      const output = [
        ' ✓ TS-h5-mobile-booking-unit-AC-001 预订成功',
        ' × TS-h5-mobile-booking-unit-AC-002 余额不足拒绝',
        ' - TS-h5-mobile-booking-unit-AC-003 取消预订（跳过）',
      ].join('\n');
      const parsed = parseCaseOutcomes(output);
      expect(parsed.get('TS-h5-mobile-booking-unit-AC-001')).toBe('passed');
      expect(parsed.get('TS-h5-mobile-booking-unit-AC-002')).toBe('failed');
      expect(parsed.get('TS-h5-mobile-booking-unit-AC-003')).toBe('skipped');
    });
  });

  describe('static-verify 静态验证', () => {
    it('矩阵 AC 有证 → 通过；制造缺口 → error', () => {
      const env = setupProject();
      // 骨架缺口 + 无 AC 证明（api-contract 无 traces）→ 应有 error 或提示
      const r1 = runStaticVerify(env.root, env.iteration);
      expect(r1.checks).toHaveLength(5);

      // 制造一个 AC 未覆盖：给 booking-service/booking 建 AC 矩阵但无证
      const unitDir = path.join(env.iterDir, '020-specs', 'booking', 'booking-service');
      const root = env.root;
      const iter = env.iteration;
      // ensureUnitMatrix 在 booking 单元（非 api-contract）
      // 注意矩阵 key 用 unitSlug 定位，需和 suite 目录一致
      const matrix = ensureUnitMatrix(root, iter, 'booking-service', 'booking', 'booking', [
        { id: 'AC-001', description: '创建订单', scenario: 'happy' },
      ]);
      expect(matrix.traces).toHaveLength(1);

      const r2 = runStaticVerify(root, iter);
      const coverage = r2.checks.find((c) => c.name === 'AC 用例证明');
      expect(coverage?.passed).toBe(false); // AC-001 无证
      expect(r2.passed).toBe(false);
    });
  });
});
