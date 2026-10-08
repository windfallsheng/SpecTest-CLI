import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';

/**
 * environment.ts —— 契约执行环境配置
 *
 * 独立于迭代：.spectest/environments/{env}.yaml
 * 支持变量占位 ${TOKEN}（从 process.env 解析，未解析则如实报缺）。
 */

export interface TestEnvironment {
  /** 环境名（dev/test/staging/prod） */
  name: string;
  /** 契约执行目标基址 */
  baseUrl: string;
  /** 请求超时（毫秒） */
  timeoutMs: number;
  /** 公共请求头 */
  headers: Record<string, string>;
}

const DEFAULT_TIMEOUT = 5000;

export function getEnvironmentsDir(projectRoot: string): string {
  return path.join(projectRoot, '.spectest', 'environments');
}

/** 读环境配置（不存在/解析失败 → null，报缺不脑补） */
export function loadEnvironment(projectRoot: string, env: string): TestEnvironment | null {
  const p = path.join(getEnvironmentsDir(projectRoot), `${env}.yaml`);
  if (!fs.existsSync(p)) return null;
  try {
    const doc = yaml.load(fs.readFileSync(p, 'utf-8'), { schema: yaml.CORE_SCHEMA }) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object') return null;
    const baseUrl = typeof doc.baseUrl === 'string' ? doc.baseUrl : null;
    if (!baseUrl) return null;
    return {
      name: env,
      baseUrl,
      timeoutMs: typeof doc.timeoutMs === 'number' ? doc.timeoutMs : DEFAULT_TIMEOUT,
      headers: resolveHeaders(doc.headers),
    };
  } catch {
    return null;
  }
}

/** 解析请求头中的 ${VAR} 环境变量占位 */
function resolveHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string') continue;
    out[k] = resolveVars(v);
  }
  return out;
}

/** 解析字符串中的 ${VAR}；未定义的环境变量原样保留（执行时报告缺变量） */
export function resolveVars(input: string): string {
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
    return process.env[name] ?? `\${${name}}`;
  });
}

/** 检查配置中是否残留未解析的变量占位 */
export function unresolvedVars(headers: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(headers)) {
    if (/\$\{[A-Za-z_]/.test(v)) out.push(`${k}=${v}`);
  }
  return out;
}
