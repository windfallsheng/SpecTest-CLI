import { i18n } from './index.js';

/**
 * 翻译辅助函数
 * 用于在模块顶层创建绑定了特定前缀的翻译函数
 *
 * @example
 * ```ts
 * const t = createTranslator('cmd.init');
 * console.log(t('start')); // 翻译 'cmd.init.start'
 * console.log(t('success', { name: 'Q1' })); // 翻译并替换参数
 * ```
 */
export function createTranslator(prefix: string) {
  return (key: string, params?: Record<string, string | number>): string => {
    const fullKey = `${prefix}.${key}`;
    return i18n.t(fullKey, params);
  };
}

/**
 * 简单翻译函数
 */
export function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}
