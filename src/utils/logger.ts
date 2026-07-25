/**
 * 日志工具
 * 提供 Spinner（旋转动画）、ProgressBar（进度条）、表格格式化等终端 UI 组件
 */
import process from 'process';

// ==================== 颜色代码 ====================
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
} as const;

// ==================== Logger ====================
export class Logger {
  private static instance: Logger;
  private filePath: string | null = null;

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setFile(filePath: string): void {
    this.filePath = filePath;
  }

  info(msg: string): void {
    console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`);
    this.writeToFile('INFO', msg);
  }

  success(msg: string): void {
    console.log(`${colors.green}[OK]${colors.reset} ${msg}`);
    this.writeToFile('OK', msg);
  }

  warn(msg: string): void {
    console.warn(`${colors.yellow}[WARN]${colors.reset} ${msg}`);
    this.writeToFile('WARN', msg);
  }

  error(msg: string): void {
    console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`);
    this.writeToFile('ERROR', msg);
  }

  debug(msg: string): void {
    if (process.env.SPEC_TEST_DEBUG) {
      console.log(`${colors.gray}[DEBUG]${colors.reset} ${msg}`);
    }
  }

  private writeToFile(level: string, msg: string): void {
    if (!this.filePath) return;
    const timestamp = new Date().toISOString();
    const fs = require('fs-extra');
    fs.appendFileSync(this.filePath, `[${timestamp}] [${level}] ${msg}\n`);
  }
}

export const logger = Logger.getInstance();

// ==================== Spinner ====================
export class Spinner {
  private message: string;
  private interval: ReturnType<typeof setInterval> | null = null;
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIndex = 0;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    process.stdout.write('\x1b[?25l'); // 隐藏光标
    this.interval = setInterval(() => {
      const frame = this.frames[this.frameIndex % this.frames.length];
      process.stdout.write(`\r${colors.cyan}${frame}${colors.reset} ${this.message}`);
      this.frameIndex++;
    }, 80);
  }

  stop(successMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\r\x1b[K'); // 清除当前行
    process.stdout.write('\x1b[?25h'); // 显示光标
    if (successMessage) {
      console.log(`${colors.green}✔${colors.reset} ${successMessage}`);
    }
  }

  fail(errorMessage: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\r\x1b[K'); // 清除当前行
    process.stdout.write('\x1b[?25h'); // 显示光标
    console.log(`${colors.red}✖${colors.reset} ${errorMessage}`);
  }

  update(message: string): void {
    this.message = message;
  }
}

// ==================== ProgressBar ====================
export class ProgressBar {
  private total: number;
  private current = 0;
  private width: number;

  constructor(total: number, width = 20) {
    this.total = total;
    this.width = width;
  }

  update(current: number, message?: string): void {
    this.current = current;
    const percent = Math.min(Math.round((current / this.total) * 100), 100);
    const filled = Math.round((percent / 100) * this.width);
    const bar = '█'.repeat(filled) + '░'.repeat(this.width - filled);
    const display = `\r${bar} ${percent}% (${current}/${this.total})`;

    process.stdout.write(display + (message ? ` ${message}` : ''));
  }

  complete(message?: string): void {
    this.update(this.total, message);
    console.log(); // 换行
  }
}

// ==================== 表格格式化 ====================
export function formatTable(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, i) =>
    Math.max(...allRows.map(r => (r[i] || '').length))
  );

  // 表头分隔线
  const separator = colWidths.map(w => '─'.repeat(w + 2)).join('┼');
  let output = '';

  // 表头
  output += '┌' + colWidths.map(w => '─'.repeat(w + 2)).join('┬') + '┐\n';
  output += '│ ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' │ ') + ' │\n';

  // 数据行
  for (let i = 0; i < rows.length; i++) {
    const isFirst = i === 0;
    output += (isFirst ? '├' : '│') + colWidths.map(w => '─'.repeat(w + 2)).join(isFirst ? '┼' : '│') + (isFirst ? '┤' : '│') + '\n';
    output += '│ ' + rows[i].map((cell, j) => (cell || '').padEnd(colWidths[j])).join(' │ ') + ' │\n';
  }

  output += '└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘\n';
  return output;
}

// ==================== JSON 输出 ====================
export function formatJsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// ==================== 输出到文件或控制台 ====================
export function writeOutput(content: string, filePath?: string): void {
  if (filePath) {
    const fs = require('fs-extra');
    fs.writeFileSync(filePath, content, 'utf-8');
  } else {
    console.log(content);
  }
}
