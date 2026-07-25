/**
 * I18n 引擎
 * 支持 zh-CN 和 en-US，自动检测系统语言，支持嵌套键和模板参数
 */
import path from 'path';
import fs from 'fs-extra';

export class I18nEngine {
  private static instance: I18nEngine;
  private locale: string = 'zh-CN';
  private messages: Record<string, Record<string, string>> = {};

  private constructor() {
    this.loadLocales();
    this.detectLocale();
  }

  static getInstance(): I18nEngine {
    if (!I18nEngine.instance) {
      I18nEngine.instance = new I18nEngine();
    }
    return I18nEngine.instance;
  }

  /**
   * 加载所有语言文件
   */
  private loadLocales(): void {
    const localesDir = path.join(__dirname, '..', 'locales');
    if (!fs.existsSync(localesDir)) return;

    const files = fs.readdirSync(localesDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const locale = file.replace('.json', '');
      try {
        this.messages[locale] = fs.readJsonSync(path.join(localesDir, file));
      } catch {
        console.warn(`Failed to load locale: ${locale}`);
      }
    }
  }

  /**
   * 自动检测系统语言
   */
  private detectLocale(): void {
    // 环境变量优先
    if (process.env.SPEC_TEST_LOCALE) {
      this.locale = process.env.SPEC_TEST_LOCALE;
      return;
    }

    // 系统 LANG 环境变量
    const lang = process.env.LANG || process.env.LC_ALL || '';
    if (lang.toLowerCase().startsWith('zh')) {
      this.locale = 'zh-CN';
    } else if (lang.toLowerCase().startsWith('en')) {
      this.locale = 'en-US';
    }
  }

  /**
   * 设置当前语言
   */
  setLocale(locale: string): void {
    if (this.messages[locale]) {
      this.locale = locale;
    }
  }

  /**
   * 获取当前语言
   */
  getLocale(): string {
    return this.locale;
  }

  /**
   * 翻译
   * @param key 翻译键，支持点号分隔的嵌套键
   * @param params 模板参数
   */
  t(key: string, params: Record<string, string | number> = {}): string {
    // 在当前语言中查找
    let message = this.getNestedValue(this.messages[this.locale], key);

    // 回退到中文
    if (!message && this.locale !== 'zh-CN') {
      message = this.getNestedValue(this.messages['zh-CN'], key);
    }

    // 回退到 key 本身
    if (!message) {
      return key;
    }

    // 替换模板参数 {{key}}
    for (const [paramKey, paramValue] of Object.entries(params)) {
      message = message.replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, 'g'), String(paramValue));
    }

    return message;
  }

  private getNestedValue(obj: Record<string, unknown> | undefined, key: string): string | null {
    if (!obj) return null;

    const parts = key.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return null;
      current = (current as Record<string, unknown>)[part];
    }

    return typeof current === 'string' ? current : null;
  }
}

export const i18n = I18nEngine.getInstance();
