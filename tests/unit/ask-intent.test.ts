/**
 * ask-intent.test.ts —— ask 意图引擎 + 命令分层执行测试
 *
 * 与 SpecCore ask 风格统一验证：
 *   1. 词典命中（trigger +25 / pattern +35 / priority ×0.2 加成）
 *   2. 置信度分层边界（high ≥70 / medium 45~69 / low <45）
 *   3. 参数提取（caseId/bugId/task/iteration/env/threshold/title/severity/status）
 *   4. 分层执行协议：high → [SPECTEST_EXEC] 执行；缺参 → [SPECTEST_NEEDS_INFO] 不执行
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  recognizeTestIntent, getConfidenceLevel, getIntentLabel, getAllTestMappings,
} from '../../src/core/ask-intent.js';
import { askCommand, showAllIntents } from '../../src/commands/ask.js';

// ============================================================
// 1. 意图命中（表驱动：输入 → 命令 + 置信度分层）
// ============================================================

describe('意图词典命中（与 speccore ask 同构评分）', () => {
  const hitCases: Array<[string, string, 'high' | 'medium' | 'low']> = [
    ['跑一下测试', 'run', 'high'],
    ['执行测试', 'run', 'high'],
    ['生成测试用例', 'gen', 'high'],
    ['写测试用例', 'gen', 'high'],
    ['生成接口测试用例', 'api', 'high'],
    ['质量门禁能不能放行', 'gate', 'high'],
    ['跑契约', 'contract-run', 'high'],
    ['执行契约测试，环境 test', 'contract-run', 'high'],
    ['改了 Task-001 的代码跑回归', 'regress', 'high'],
    ['回归测试', 'regress', 'high'],
    ['变更影响分析', 'impact', 'high'],
    ['有没有覆盖缺口', 'gap', 'high'],
    ['看看测试状态', 'status', 'high'],
    ['生成测试报告', 'report', 'high'],
    ['总结一下', 'summary', 'high'],
    ['趋势对比一下', 'trend', 'high'],
    ['归档测试数据', 'archive', 'high'],
    ['测试计划制定一下', 'plan', 'high'],
    ['记录缺陷 --case-id TS-Q1-AC-001 --title "金额精度丢失"', 'bug', 'high'],
    ['关闭缺陷 BUG-123', 'bug-close', 'high'],
    ['缺陷清单', 'bug-list', 'high'],
    ['静态验证文档', 'verify', 'high'],
    ['设置覆盖率为 85', 'config-set', 'high'],
    ['初始化', 'init', 'high'],
    ['初始化测试项目', 'init', 'high'],
  ];

  it.each(hitCases)('「%s」→ %s（%s）', (input, command, level) => {
    const results = recognizeTestIntent(input);
    expect(results.length).toBeGreaterThan(0);
    const top = results[0];
    expect(top.command).toBe(command);
    expect(getConfidenceLevel(top.confidence)).toBe(level);
  });

  it('未知输入返回空结果（报缺不脑补）', () => {
    expect(recognizeTestIntent('帮我看看今天的天气')).toEqual([]);
  });

  it('歧义输入给出候选排序（第一名置信度最高）', () => {
    const results = recognizeTestIntent('执行测试');
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].confidence).toBeGreaterThanOrEqual(results[i].confidence);
    }
  });
});

// ============================================================
// 2. 参数提取
// ============================================================

describe('参数提取（全局正则，不依赖 pattern 捕获组）', () => {
  it('提取 caseId / title / goal', () => {
    const [r] = recognizeTestIntent('记录缺陷 --case-id TS-h5-mobile-booking-unit-AC-001 --title "金额精度丢失"');
    expect(r.extractedParams.caseId).toBe('TS-h5-mobile-booking-unit-AC-001');
    expect(r.extractedParams.title).toBe('金额精度丢失');
    expect(r.extractedParams.goal).toBe('金额精度丢失');
  });

  it('提取 bugId（大写归一化）', () => {
    const [r] = recognizeTestIntent('关闭缺陷 bug-1720000000000');
    expect(r.extractedParams.bugId).toBe('BUG-1720000000000');
  });

  it('提取 task / iteration', () => {
    const [r] = recognizeTestIntent('改了 Task-001 的代码跑回归，迭代 Q1');
    expect(r.extractedParams.task).toBe('Task-001');
    expect(r.extractedParams.iteration).toBe('Q1');
  });

  it('提取 env / suite', () => {
    const [r] = recognizeTestIntent('执行契约测试，环境 test，套件 booking');
    expect(r.extractedParams.env).toBe('test');
    expect(r.extractedParams.suite).toBe('booking');
  });

  it('提取 threshold（容忍空格：覆盖率为 85 / 阈值 90）', () => {
    const [a] = recognizeTestIntent('设置覆盖率为 85');
    expect(a.extractedParams.threshold).toBe('85');
    const [b] = recognizeTestIntent('配置阈值 90');
    expect(b.extractedParams.threshold).toBe('90');
  });

  it('提取 severity 归一化（严重→high）', () => {
    const [r] = recognizeTestIntent('记录缺陷 严重 bug --case-id TS-x-AC-001 --title "崩溃"');
    expect(r.extractedParams.severity).toBe('high');
  });

  it('提取缺陷状态（已关闭→closed / 全部→all）', () => {
    const [a] = recognizeTestIntent('查看已关闭缺陷列表');
    expect(a.extractedParams.status).toBe('closed');
    const [b] = recognizeTestIntent('查看全部缺陷');
    expect(b.extractedParams.status).toBe('all');
  });
});

// ============================================================
// 3. 置信度分层边界
// ============================================================

describe('置信度分层（high ≥70 / medium 45~69 / low <45）', () => {
  it.each([
    [69, 'medium'], [70, 'high'],
    [44, 'low'], [45, 'medium'],
    [100, 'high'], [0, 'low'],
  ] as const)('%d → %s', (confidence, level) => {
    expect(getConfidenceLevel(confidence)).toBe(level);
  });
});

// ============================================================
// 4. 词典完整性
// ============================================================

describe('词典完整性', () => {
  it('覆盖 20 个意图，id 唯一且示例以 spectest 开头', () => {
    const mappings = getAllTestMappings();
    expect(mappings).toHaveLength(20);
    const ids = mappings.map((m) => m.id);
    expect(new Set(ids).size).toBe(20);
    for (const m of mappings) {
      expect(m.example.startsWith('spectest ')).toBe(true);
      expect(m.triggers.length).toBeGreaterThan(0);
      expect(getIntentLabel(m.intent)).not.toBeUndefined();
    }
  });
});

// ============================================================
// 5. askCommand 分层执行协议
// ============================================================

describe('askCommand 分层执行（[SPECTEST_EXEC] / [SPECTEST_NEEDS_INFO] 协议）', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const captured = (): string => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('空输入 → 用法提示', async () => {
    await askCommand('  ');
    expect(captured()).toContain('用法：spectest ask');
  });

  it('未命中 → 提示可说的说法', async () => {
    await askCommand('帮我看看今天的天气');
    expect(captured()).toContain('没有匹配到合适的命令');
    expect(captured()).toContain('你可以这样说');
  });

  it('缺参意图（记录缺陷，无 caseId/title）→ [SPECTEST_NEEDS_INFO] 不执行', async () => {
    await askCommand('记录缺陷');
    const out = captured();
    expect(out).toContain('[SPECTEST_NEEDS_INFO]');
    expect(out).toContain('[/SPECTEST_NEEDS_INFO]');
    expect(out).toContain('还缺参数');
    expect(out).not.toContain('[SPECTEST_EXEC');
  });

  it('低置信度 → 列候选 + 用法示例，不执行', async () => {
    await askCommand('存档');
    const out = captured();
    expect(out).toContain('置信度较低');
    expect(out).not.toContain('[SPECTEST_EXEC');
  });

  it('高置信度 config-set（覆盖率为 85）→ 归一化点路径 + [SPECTEST_EXEC] 真实执行', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-ask-'));
    fs.ensureDirSync(path.join(root, '.spectest', 'local'));
    fs.writeJsonSync(path.join(root, '.spectest', 'local', 'context.json'), {
      currentIteration: 'Iteration-001-mock',
      currentSuite: '',
      projectRoot: root,
    });
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      await askCommand('设置覆盖率为 85');
      const out = captured();
      expect(out).toContain('[SPECTEST_EXEC: spectest config set gate.coverageThreshold 85]');
      // 真实执行 configCommand → 落盘 config.yaml
      const configPath = path.join(root, '.spectest', 'config.yaml');
      expect(fs.existsSync(configPath)).toBe(true);
      expect(fs.readFileSync(configPath, 'utf-8')).toContain('coverageThreshold');
      expect(fs.readFileSync(configPath, 'utf-8')).toContain('85');
    } finally {
      process.chdir(originalCwd);
      fs.removeSync(root);
    }
  });
});

// ============================================================
// 6. showAllIntents 意图清单
// ============================================================

describe('showAllIntents（ask --list）', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('按六组分类展示全部 20 个意图', () => {
    showAllIntents();
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    for (const group of ['⚙️ 生成面', '▶️ 执行面', '🚧 门禁面', '📊 度量面', '🐛 缺陷面', '🛠️ 配置与状态']) {
      expect(out).toContain(group);
    }
    const cliName: Record<string, string> = {
      'bug-close': 'bug close', 'bug-list': 'bug list', 'config-set': 'config set',
    };
    for (const m of getAllTestMappings()) {
      expect(out).toContain(`spectest ${cliName[m.id] || m.id}`);
    }
  });
});
