import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  loadVisualReviewer,
  reviewImages,
  parseVerdict,
  saveReviewRecord,
} from '../../src/core/visual-review.js';
import { setConfigValue } from '../../src/core/config.js';

/**
 * 视觉模型审查：config 判定（报缺不脑补）/ OpenAI 兼容送审 / 判定解析 / 审查记录落盘
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-visual-'));
  fs.ensureDirSync(path.join(root, '.spectest'));
  delete process.env.VISUAL_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VISUAL_KEY;
});

/** 造一张可读的假图片（imageToDataUrl 只读字节，不校验图片内容） */
function makeImage(name = 'shot.png'): string {
  const p = path.join(root, name);
  fs.writeFileSync(p, Buffer.from('fake-png-bytes'));
  return p;
}

/** mock fetch：按序返回响应（json 或 status） */
function mockFetchOnce(status: number, content: string | null): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: content === null ? [] : [{ message: { content } }] }),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('loadVisualReviewer：config 判定（报缺不脑补）', () => {
  it('缺省 disabled → available=false', () => {
    const o = loadVisualReviewer(root);
    expect(o.available).toBe(false);
    if (!o.available) expect(o.reason).toMatch(/未启用/);
  });

  it('enabled 但 apiKey 空 → available=false', () => {
    setConfigValue(root, 'visual.enabled', 'true');
    const o = loadVisualReviewer(root);
    expect(o.available).toBe(false);
  });

  it('apiKey 为 ${VAR} 占位且环境变量未注入 → available=false（密钥不落盘）', () => {
    setConfigValue(root, 'visual.enabled', 'true');
    setConfigValue(root, 'visual.apiKey', '${VISUAL_KEY}');
    const o = loadVisualReviewer(root);
    expect(o.available).toBe(false);
    if (!o.available) expect(o.reason).toMatch(/占位未解析/);
  });

  it('enabled + 真实 apiKey → available=true 且 key 解析透传', () => {
    setConfigValue(root, 'visual.enabled', 'true');
    setConfigValue(root, 'visual.apiKey', 'sk-test-123');
    const o = loadVisualReviewer(root);
    expect(o.available).toBe(true);
    if (o.available) expect(o.config.apiKey).toBe('sk-test-123');
  });
});

describe('parseVerdict：模型输出解析', () => {
  it('VERDICT: PASS → pass + reason 提取', () => {
    const r = parseVerdict('VERDICT: PASS\nREASON: 布局与设计稿一致', 'gpt-4o');
    expect(r.verdict).toBe('pass');
    expect(r.reason).toBe('布局与设计稿一致');
    expect(r.model).toBe('gpt-4o');
  });

  it('VERDICT: FAIL → fail', () => {
    expect(parseVerdict('VERDICT: FAIL\nREASON: 按钮错位', 'm').verdict).toBe('fail');
  });

  it('无 VERDICT 行 → unknown（不脑补判定）', () => {
    const r = parseVerdict('我觉得还行', 'm');
    expect(r.verdict).toBe('unknown');
  });
});

describe('reviewImages：OpenAI 兼容送审', () => {
  const opts = (question: string) => ({
    projectRoot: root,
    iteration: 'Iteration-001-mock',
    images: [makeImage()],
    question,
  });

  function enableVisual(): void {
    setConfigValue(root, 'visual.enabled', 'true');
    setConfigValue(root, 'visual.apiKey', 'sk-test-123');
  }

  it('未配置视觉段 → 如实报缺且不发起请求', async () => {
    const fn = mockFetchOnce(200, 'VERDICT: PASS\nREASON: ok');
    const r = await reviewImages(opts('符合吗'));
    expect('available' in r && r.available).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('模型判定 PASS → pass（多图随附）', async () => {
    enableVisual();
    const second = makeImage('diff.png');
    mockFetchOnce(200, 'VERDICT: PASS\nREASON: 一致');
    const r = await reviewImages({ ...opts('一致吗'), images: [makeImage(), second] });
    expect('available' in r).toBe(false);
    expect(r).toMatchObject({ verdict: 'pass', reason: '一致' });
    // 断言请求体带两张图片
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as { body: string }).body);
    const content = body.messages[0].content;
    expect(content.filter((c: { type: string }) => c.type === 'image_url')).toHaveLength(2);
  });

  it('模型判定 FAIL → fail', async () => {
    enableVisual();
    mockFetchOnce(200, 'VERDICT: FAIL\nREASON: 错位');
    const r = await reviewImages(opts('符合吗'));
    expect('available' in r).toBe(false);
    expect(r).toMatchObject({ verdict: 'fail', reason: '错位' });
  });

  it('HTTP 500 → available=false（不崩溃、不脑补）', async () => {
    enableVisual();
    mockFetchOnce(500, null);
    const r = await reviewImages(opts('符合吗'));
    expect('available' in r && r.available).toBe(false);
  });

  it('图片文件不存在 → available=false', async () => {
    enableVisual();
    mockFetchOnce(200, 'VERDICT: PASS');
    const r = await reviewImages({
      projectRoot: root,
      iteration: 'Iteration-001-mock',
      images: [path.join(root, 'not-exist.png')],
      question: '符合吗',
    });
    expect('available' in r && r.available).toBe(false);
  });
});

describe('saveReviewRecord：审查记录落盘（迭代层执行事实）', () => {
  it('落盘 matrix/visual/REVIEW-*.json 且字段齐全', () => {
    const img = makeImage();
    const recordPath = saveReviewRecord(
      root,
      'Iteration-001-mock',
      { projectRoot: root, iteration: 'Iteration-001-mock', images: [img], question: '符合 UI_SPEC 吗', context: '页面：预订列表' },
      { verdict: 'fail', reason: '按钮错位', model: 'gpt-4o' }
    );
    expect(fs.existsSync(recordPath)).toBe(true);
    expect(recordPath).toContain(path.join('.spectest', 'iterations', 'Iteration-001-mock', 'matrix', 'visual'));
    const record = fs.readJsonSync(recordPath);
    expect(record.verdict).toBe('fail');
    expect(record.question).toBe('符合 UI_SPEC 吗');
    expect(record.images).toEqual(['shot.png']);
    expect(record.model).toBe('gpt-4o');
  });
});
