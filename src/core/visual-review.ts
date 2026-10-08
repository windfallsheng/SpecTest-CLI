import path from 'path';
import fs from 'fs-extra';
import { loadConfig, type VisualConfig } from './config.js';
import { resolveVars } from './environment.js';

/**
 * visual-review.ts —— 视觉模型审查（OpenAI 兼容协议，可选审查器）
 *
 * 边界哲学：像素比对由 playwright 完成（确定性计算，不依赖 AI）；
 * 视觉模型只补「看得懂」的环节——基线确认、失败 diff 分析、语义断言。
 * 报缺不脑补：未配置视觉段 → 如实报缺，人工确认基线。
 */

export interface VisualReviewOptions {
  projectRoot: string;
  iteration: string;
  /** 待审图片路径（支持多张，如基线+新图+diff 图） */
  images: string[];
  /** 审查问题（如「该截图是否符合 UI_SPEC 的页面描述」） */
  question: string;
  /** 补充上下文（如 UI_SPEC 页面描述、AC 文本） */
  context?: string;
}

export interface VisualReviewResult {
  /** 模型判定：pass（符合预期）/ fail（不符合）/ unknown（模型未给出明确判定） */
  verdict: 'pass' | 'fail' | 'unknown';
  reason: string;
  /** 使用的模型名（记录可追溯） */
  model: string;
}

/** 视觉审查不可用的原因（配置缺失 / key 未解析） */
export interface VisualUnavailable {
  available: false;
  reason: string;
}

type ReviewOutcome = { available: true; config: VisualConfig } | VisualUnavailable;

/** 读配置判定可用性：enabled 且 apiKey 解析非空（${VAR} 未解析视为不可用） */
export function loadVisualReviewer(projectRoot: string): ReviewOutcome {
  const visual = loadConfig(projectRoot).visual;
  if (!visual.enabled) {
    return {
      available: false,
      reason: '视觉模型未启用：请 spectest config set visual.enabled true，并配置 visual.apiKey / visual.model',
    };
  }
  const resolvedKey = resolveVars(visual.apiKey);
  if (!resolvedKey || /\$\{[A-Za-z_]/.test(resolvedKey)) {
    return {
      available: false,
      reason: `visual.apiKey 未设置或 ${'${VAR}'} 占位未解析（${visual.apiKey || '空'}）——密钥建议走环境变量注入，不落盘`,
    };
  }
  return { available: true, config: { ...visual, apiKey: resolvedKey } };
}

/** 组装审查 prompt（要求模型以结构化格式输出，保证判定可解析） */
function buildReviewPrompt(question: string, context?: string): string {
  const lines: string[] = [
    '你是专业的 UI 视觉审查员。请仔细查看提供的截图并回答审查问题。',
    `审查问题：${question}`,
  ];
  if (context) {
    lines.push('补充上下文：');
    lines.push(context);
  }
  lines.push('');
  lines.push('请严格按以下格式输出（首行必须是 VERDICT）：');
  lines.push('VERDICT: PASS 或 FAIL');
  lines.push('REASON: 一句话说明判定依据');
  return lines.join('\n');
}

/** 图片转 data URL（base64） */
function imageToDataUrl(imagePath: string): string | null {
  try {
    const buf = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** 送审：OpenAI 兼容 chat/completions（多图 + 文本） */
export async function reviewImages(options: VisualReviewOptions): Promise<VisualReviewResult | VisualUnavailable> {
  const outcome = loadVisualReviewer(options.projectRoot);
  if (!outcome.available) return outcome;

  const { config } = outcome;
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: buildReviewPrompt(options.question, options.context) },
  ];
  for (const img of options.images) {
    const dataUrl = imageToDataUrl(img);
    if (!dataUrl) {
      return {
        available: false,
        reason: `图片读取失败：${img}（文件不存在或不可读）`,
      };
    }
    content.push({ type: 'image_url', image_url: { url: dataUrl } });
  }

  let raw: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content }],
        max_tokens: 300,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { available: false, reason: `视觉模型请求失败：HTTP ${res.status}` };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    raw = data.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    return { available: false, reason: `视觉模型请求失败：${e instanceof Error ? e.message : String(e)}` };
  }

  return parseVerdict(raw, config.model);
}

/** 解析模型输出：VERDICT: PASS/FAIL + REASON */
export function parseVerdict(raw: string, model: string): VisualReviewResult {
  const lines = raw.split('\n').map((l) => l.trim());
  const verdictLine = lines.find((l) => /^VERDICT\s*:/i.test(l)) ?? '';
  const reasonLine = lines.find((l) => /^REASON\s*:/i.test(l)) ?? '';
  const verdict = /PASS/i.test(verdictLine) && !/FAIL/i.test(verdictLine)
    ? 'pass'
    : /FAIL/i.test(verdictLine)
      ? 'fail'
      : 'unknown';
  const reason = reasonLine.replace(/^REASON\s*:\s*/i, '') || raw.slice(0, 200);
  return { verdict, reason, model };
}

/** 审查记录落盘：迭代层 matrix/visual/（执行事实，按期次记账） */
export function saveReviewRecord(
  projectRoot: string,
  iteration: string,
  options: VisualReviewOptions,
  result: VisualReviewResult
): string {
  const dir = path.join(projectRoot, '.spectest', 'iterations', iteration, 'matrix', 'visual');
  fs.ensureDirSync(dir);
  const id = `REVIEW-${Date.now()}`;
  const record = {
    id,
    iteration,
    reviewedAt: new Date().toISOString(),
    question: options.question,
    context: options.context ?? '',
    images: options.images.map((p) => path.basename(p)),
    verdict: result.verdict,
    reason: result.reason,
    model: result.model,
  };
  fs.writeJsonSync(path.join(dir, `${id}.json`), record, { spaces: 2 });
  return path.join(dir, `${id}.json`);
}
