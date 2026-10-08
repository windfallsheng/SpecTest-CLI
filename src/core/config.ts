import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { z } from 'zod';

/**
 * config.ts —— 项目级配置标准（.spectest/config.yaml）
 *
 * 覆盖 init 时代的 config.json 旧格式（项目元信息），新标准只承载
 * 门禁阈值与流水线行为——即「会改变 CLI 判定结果的参数」。
 * 阈值读取优先级：CLI 参数 > config.yaml > 内置默认值。
 */

export const GateConfigSchema = z.object({
  /** AC 覆盖率阈值（%） */
  coverageThreshold: z.number().int().min(0).max(100).default(80),
  /** 执行通过率阈值（%） */
  passRateThreshold: z.number().int().min(0).max(100).default(90),
});

export const PipelineConfigSchema = z.object({
  /** 双模式开关：true = 每层执行前询问，false = 全自动先轻后重失败即停 */
  interactive: z.boolean().default(false),
  /** 契约执行默认环境 */
  defaultEnv: z.string().default('test'),
});

/**
 * 视觉模型配置（OpenAI 兼容协议）——spectest visual-review 的可选审查器。
 * 报缺不脑补：enabled=false 或 apiKey 为空 → visual review 如实报缺，人工确认。
 */
export const VisualConfigSchema = z.object({
  /** 开关（缺省关闭：未显式启用时视觉审查不可用） */
  enabled: z.boolean().default(false),
  /** OpenAI 兼容 API 基址（如 https://api.openai.com/v1） */
  baseUrl: z.string().default('https://api.openai.com/v1'),
  /** API Key（支持 ${VAR} 环境变量占位，敏感值不落盘） */
  apiKey: z.string().default(''),
  /** 视觉模型名 */
  model: z.string().default('gpt-4o'),
});

const DEFAULT_GATE: GateConfig = { coverageThreshold: 80, passRateThreshold: 90 };
const DEFAULT_PIPELINE: PipelineConfig = { interactive: false, defaultEnv: 'test' };
const DEFAULT_VISUAL: VisualConfig = { enabled: false, baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o' };

export const ProjectConfigSchema = z.object({
  gate: GateConfigSchema.default(DEFAULT_GATE),
  pipeline: PipelineConfigSchema.default(DEFAULT_PIPELINE),
  visual: VisualConfigSchema.default(DEFAULT_VISUAL),
});

export type GateConfig = z.infer<typeof GateConfigSchema>;
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
export type VisualConfig = z.infer<typeof VisualConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const DEFAULT_CONFIG: ProjectConfig = {
  gate: DEFAULT_GATE,
  pipeline: DEFAULT_PIPELINE,
  visual: DEFAULT_VISUAL,
};

export function getConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.spectest', 'config.yaml');
}

/** 默认值深拷贝：防止 setConfigValue 污染模块级常量（浅拷贝共享嵌套引用） */
function cloneDefault(): ProjectConfig {
  return {
    gate: { ...DEFAULT_CONFIG.gate },
    pipeline: { ...DEFAULT_CONFIG.pipeline },
    visual: { ...DEFAULT_CONFIG.visual },
  };
}

/** 读取配置：缺文件/字段一律回落默认值（幂等、永不出错） */
export function loadConfig(projectRoot: string): ProjectConfig {
  const p = getConfigPath(projectRoot);
  if (!fs.existsSync(p)) return cloneDefault();
  try {
    const raw = yaml.load(fs.readFileSync(p, 'utf-8'), { schema: yaml.CORE_SCHEMA }) ?? {};
    return ProjectConfigSchema.parse(raw);
  } catch {
    return cloneDefault();
  }
}

/** 写回配置（schema 校验后落盘） */
export function saveConfig(projectRoot: string, config: ProjectConfig): void {
  const p = getConfigPath(projectRoot);
  fs.ensureDirSync(path.dirname(p));
  const parsed = ProjectConfigSchema.parse(config);
  fs.writeFileSync(
    p,
    `# Spectest 项目配置（${new Date().toISOString()}）\n` +
    `# 阈值优先级：CLI 参数 > 本文件 > 内置默认值\n\n` +
    yaml.dump(parsed, { noRefs: true }),
    'utf-8'
  );
}

/** 点路径设置：gate.coverageThreshold / pipeline.interactive ... */
export function setConfigValue(
  projectRoot: string,
  dotKey: string,
  rawValue: string
): ProjectConfig {
  const config = loadConfig(projectRoot);
  const [section, key] = dotKey.split('.');
  const target = section === 'gate' ? config.gate : section === 'pipeline' ? config.pipeline : section === 'visual' ? config.visual : null;
  if (!target || !(key in target)) {
    throw new Error(`未知配置项：${dotKey}（可选：gate.coverageThreshold / gate.passRateThreshold / pipeline.interactive / pipeline.defaultEnv / visual.enabled / visual.baseUrl / visual.apiKey / visual.model）`);
  }
  (target as Record<string, unknown>)[key] = parseValue(rawValue);
  const next = ProjectConfigSchema.parse(config);
  saveConfig(projectRoot, next);
  return next;
}

function parseValue(raw: string): string | number | boolean {
  if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  return raw;
}
