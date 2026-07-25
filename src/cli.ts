#!/usr/bin/env node
import path from 'path';
import { program } from 'commander';
import { i18n } from './i18n/index.js';
import { findProjectRoot, loadContext } from './core/context.js';

// 导入命令
import { initCommand } from './commands/init.js';
import { genCommand } from './commands/gen.js';
import { gapCommand } from './commands/gap.js';
import { runCommand } from './commands/run.js';
import { reportCommand } from './commands/report.js';
import { statusCommand } from './commands/status.js';

// ==================== 基础配置 ====================
program
  .name('spectest')
  .description('SpecTest - Test by Spec, Not by Guess.\n测试底座，让 AI 从需求自动生成测试用例。')
  .version('0.1.0', '-v, --version', '显示版本号')
  .option('--lang <locale>', '语言：zh-CN（默认）或 en-US', 'zh-CN')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.lang && (opts.lang === 'zh-CN' || opts.lang === 'en-US')) {
      i18n.setLocale(opts.lang);
    }
  });

// ==================== 注册命令 ====================

// 1. 初始化
program
  .command('init')
  .alias('in')
  .description('初始化测试项目（在 SpecCore 项目中创建 .spectest 目录）')
  .option('-f, --force', '强制重新初始化')
  .option('-i, --iteration <name>', '指定期次名称')
  .action(initCommand);

// 2. 生成测试用例
program
  .command('gen')
  .alias('g')
  .description('从需求验收标准（AC）自动生成测试用例')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-n, --name <name>', '测试套件名称')
  .option('-t, --type <type>', '测试类型：unit, integration, e2e, api')
  .option('-p, --platform <platform>', '目标平台：backend, frontend, fullstack')
  .action(genCommand);

// 3. 覆盖缺口分析
program
  .command('gap')
  .alias('gp')
  .description('检测测试覆盖缺口，对比需求 AC 和已有测试用例')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-o, --output <path>', '报告输出路径')
  .action(gapCommand);

// 4. 执行测试
program
  .command('run')
  .alias('r')
  .description('执行指定测试套件')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-s, --suite <id>', '测试套件 ID（必填）')
  .action(runCommand);

// 5. 测试报告
program
  .command('report')
  .alias('rp')
  .description('生成测试报告')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-s, --suite <id>', '按套件筛选')
  .option('-o, --output <path>', '报告输出路径')
  .action(reportCommand);

// 6. 测试状态
program
  .command('status')
  .alias('st')
  .description('查看测试项目状态（套件数、用例数、覆盖率等）')
  .option('-i, --iteration <name>', '指定期次名称')
  .action(statusCommand);

// ==================== 帮助文本 ====================
program.addHelpText('beforeAll', `
┌─────────────────────────────────────────────────────┐
│  🧪  SpecTest - Test by Spec, Not by Guess.        │
│  测试底座，让 AI 从需求自动生成测试用例             │
└─────────────────────────────────────────────────────┘

核心流程：
  1. init    → 初始化测试项目
  2. gen     → 从 AC 生成测试用例
  3. gap     → 检测覆盖缺口
  4. run     → 执行测试
  5. report  → 生成测试报告
  6. status  → 查看测试状态

示例：
  spectest init --iteration Q1
  spectest gen --iteration Q1 --type unit
  spectest gap --iteration Q1
  spectest run --iteration Q1 --suite TS-123456
  spectest status
`);

program.addHelpText('afterAll', `
更多信息：
  文档：https://gitee.com/windfullsheng/spec-core-ts
  问题反馈：https://gitee.com/windfullsheng/spec-core-ts/issues
`);

// ==================== 无参数时的欢迎面板 ====================
if (process.argv.length <= 2) {
  displayWelcome();
  process.exit(0);
}

// ==================== 解析参数 ====================
program.parse();

// ==================== 欢迎面板 ====================
function displayWelcome(): void {
  console.log(`
┌─────────────────────────────────────────────────────┐
│                                                     │
│   🧪  SpecTest v0.1.0                              │
│   Test by Spec, Not by Guess.                       │
│                                                     │
│   测试底座，让 AI 从需求自动生成测试用例             │
│                                                     │
└─────────────────────────────────────────────────────┘
`);

  // 检测项目状态
  const projectRoot = findProjectRoot();

  if (!projectRoot) {
    console.log('📋 未找到测试项目。');
    console.log('');
    console.log('快速开始：');
    console.log('  1. 在 SpecCore 项目根目录下执行：');
    console.log('     spectest init --iteration Q1');
    console.log('');
    console.log('  2. 然后生成测试用例：');
    console.log('     spectest gen --iteration Q1');
    console.log('');
    console.log('  3. 检测覆盖缺口：');
    console.log('     spectest gap --iteration Q1');
    console.log('');
  } else {
    const context = loadContext(projectRoot);

    if (context.currentIteration) {
      console.log(`📂 当前项目：${path.basename(projectRoot)}`);
      console.log(`📅 当前期次：${context.currentIteration}`);
      console.log(`📊 总套件：${context.totalSuites}  |  总用例：${context.totalCases}  |  覆盖缺口：${context.gapCount}`);
      console.log('');
      console.log('下一步：');
      console.log('  spectest gen    → 生成测试用例');
      console.log('  spectest gap    → 检测覆盖缺口');
      console.log('  spectest status → 查看完整状态');
      console.log('');
    } else {
      console.log(`📂 当前项目：${path.basename(projectRoot)}`);
      console.log('');
      console.log('快速开始：');
      console.log('  spectest gen --iteration <期次>');
      console.log('');
    }
  }

  console.log(`使用 spectest --help 查看所有命令`);
  console.log('');
}
