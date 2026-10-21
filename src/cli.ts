#!/usr/bin/env node
import path from 'path';
import { program } from 'commander';
import type { Option } from 'commander';

/** commander --image 多值收集器（可重复指定） */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
void (null as unknown as Option);
import { i18n } from './i18n/index.js';
import { findProjectRoot, loadContext } from './core/context.js';
import { aggregateIterationMetrics } from './core/metrics.js';

// 导入命令
import { initCommand } from './commands/init.js';
import { planCommand } from './commands/plan.js';
import { genCommand } from './commands/gen.js';
import { apiCommand } from './commands/api.js';
import { gapCommand } from './commands/gap.js';
import { runCommand } from './commands/run.js';
import { verifyCommand } from './commands/verify.js';
import { contractRunCommand } from './commands/contract-run.js';
import { visualReviewCommand } from './commands/visual.js';
import { regressCommand } from './commands/regress.js';
import { impactCommand } from './commands/impact.js';
import { bugCommand, closeBugCommand, listBugsCommand } from './commands/bug.js';
import { gateCommand } from './commands/gate.js';

// 版本号从 package.json 动态读取（发版只改一处，杜绝硬编码漂移）
const pkgVersion: string = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require(path.join(__dirname, '..', 'package.json')) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
})();
import { configCommand } from './commands/config.js';
import { reportCommand } from './commands/report.js';
import { summaryCommand } from './commands/summary.js';
import { trendCommand } from './commands/trend.js';
import { archiveCommand } from './commands/archive.js';
import { statusCommand } from './commands/status.js';
import { exportCommand } from './commands/export.js';
import { askCommand, showAllIntents } from './commands/ask.js';

// ==================== 基础配置 ====================
program
  .name('spectest')
  .description('SpecTest - Test by Spec, Not by Guess.\n测试底座，让 AI 从需求自动生成测试用例。')
  .version(pkgVersion, '-v, --version', '显示版本号')
  .option('--lang <locale>', '语言：zh-CN（默认）或 en-US', 'zh-CN')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.lang && (opts.lang === 'zh-CN' || opts.lang === 'en-US')) {
      i18n.setLocale(opts.lang);
    }
  });

// ==================== 注册命令 ====================

// 1. ask 自然语言智能入口（与 speccore ask 风格统一：高置信度直接执行，缺参 [SPECTEST_NEEDS_INFO]）
program
  .command('ask')
  .alias('?')
  .description('自然语言智能入口：识别测试意图并执行（高置信度直接执行，缺参输出 [SPECTEST_NEEDS_INFO]）')
  .option('--list', '列出全部支持的意图类型')
  .argument('[input...]', '自然语言描述测试意图，如 spectest ask "跑一下测试"')
  .action(async (input: string[], cmd: { list?: boolean }) => {
    if (cmd.list) {
      showAllIntents();
      return;
    }
    await askCommand((input || []).join(' '));
  });

// 2. 初始化
program
  .command('init')
  .alias('in')
  .description('初始化测试项目（在 SpecCore 项目中创建 .spectest 目录）')
  .option('-f, --force', '强制重新初始化')
  .option('-i, --iteration <name>', '指定期次名称')
  .action(initCommand);

// 3. 测试计划
program
  .command('plan')
  .alias('pl')
  .description('生成测试计划（测试策略、风险标注、数据准备、时间线）')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-g, --goal <goal>', '期次目标描述')
  .action(planCommand);

// 4. 生成测试用例（骨架预建 + AI 接力）
program
  .command('gen')
  .alias('g')
  .description('从需求验收标准（AC）生成测试用例（骨架预建 → AI 接力 → --apply 回写）')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-p, --platform <platform>', '端名过滤（标准端名）')
  .option('-u, --unit <unit>', '功能单元过滤（slug 或单元名）')
  .option('-t, --type <type>', '测试类型：unit, integration, e2e, api, performance, security', 'unit')
  .option('--spec-dir <path>', '独立输入通道：自备规格目录（{单元}/{端名}/TEST.md，与 020-specs 同构）')
  .option('--apply', 'AI 生成用例后的回写模式（zod 校验 + 矩阵登记 + 索引重建）')
  .action(genCommand);

// 5. 生成 API 测试
program
  .command('api')
  .alias('a')
  .description('从 API Contract（API_CONTRACT.yaml）生成契约面接口测试用例')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-p, --platform <platform>', '标准端名（服务端，必填）')
  .option('-n, --name <name>', '测试套件名称')
  .action(apiCommand);

// 6. 覆盖缺口分析
program
  .command('gap')
  .alias('gp')
  .description('检测测试覆盖缺口，对比需求 AC 和已有测试用例')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-o, --output <path>', '报告输出路径')
  .action(gapCommand);

// 7. 执行测试
program
  .command('run')
  .alias('r')
  .description('执行测试流水线：静态验证 → 契约执行 → 宿主框架；缺省期次 = 全量回归（跨期次）')
  .option('-i, --iteration <name>', '指定期次名称（缺省 = 全量回归，逐期推进三层链）')
  .option('-s, --suite <id>', '按套件执行')
  .option('--pipeline', '显式声明流水线模式（默认即流水线，兼容保留）')
  .option('--interactive', '流水线人机交互模式（覆盖 config，每层确认）')
  .option('--env <name>', '契约执行环境（默认 test；逗号分隔 = 环境矩阵，如 sit,uat）')
  .option('--priority <level>', '优先级过滤：high/medium/low（high=P0，只作用于契约层）')
  .option('--case <ids>', '用例级过滤：幂等 caseId 逗号分隔（只作用于契约层）')
  .option('--retry <n>', '契约层失败重试次数（默认 0）')
  .option('--args <extra...>', '附加参数透传宿主框架')
  .action(runCommand);

// 8. 契约执行
program
  .command('contract-run')
  .alias('cr')
  .description('契约执行：真实 HTTP 请求 + 状态码断言（内置执行器）')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('--env <name>', '环境名（默认 test；逗号分隔 = 环境矩阵，如 sit,uat）')
  .option('-p, --platform <name>', '服务端名过滤')
  .option('-s, --suite <id>', '按套件执行')
  .option('--priority <level>', '优先级过滤：high/medium/low（high=P0，与 gate 定义一致）')
  .option('--case <ids>', '用例级过滤：幂等 caseId 逗号分隔')
  .option('--retry <n>', '失败重试次数（默认 0，共执行 1+retry 次）')
  .action(contractRunCommand);

// 9. 视觉模型审查（OpenAI 兼容，可选审查器）
program
  .command('visual-review')
  .alias('vr')
  .description('视觉模型审查：基线确认 / diff 分析 / 语义断言（未配置模型如实报缺）')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('--image <path>', '待审图片路径（可多次指定：基线/新图/diff 图）', collect, [] as string[])
  .option('-q, --question <text>', '审查问题（如「该截图是否符合 UI_SPEC 的页面描述」）')
  .option('-c, --context <text>', '补充上下文（UI_SPEC 描述 / AC 文本）')
  .action(visualReviewCommand);

// 10. 静态验证
program
  .command('verify')
  .alias('vf')
  .description('文档静态验证（AC 完整性/证明/四段齐全/端级专项）')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-p, --platform <name>', '端名过滤')
  .option('-u, --unit <name>', '单元过滤')
  .action(verifyCommand);

// 11. 回归测试
program
  .command('regress')
  .alias('rg')
  .description('变更后自动跑受影响的测试用例（回归测试）')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-t, --task <id>', '指定变更的 Task ID')
  .action(regressCommand);

// 12. 变更影响分析
program
  .command('impact')
  .alias('im')
  .description('分析需求变更对已有测试的影响')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-t, --task <id>', '指定变更的 Task ID')
  .action(impactCommand);

// 13. 缺陷提交
const bugCmd = program
  .command('bug')
  .alias('bg')
  .description('记录测试缺陷，关联到 spec-core bugfix Task（子命令：close 关闭 / list 清单）')
  // 注意：不能用 requiredOption——commander 父命令的必填校验会强制作用到子命令
  // （close/list），导致 `bug list` 也被拦。必填校验收敛到 bugCommand action 内。
  .option('-c, --case-id <id>', '失败的测试用例 ID')
  .option('-t, --title <title>', '缺陷标题')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-s, --severity <level>', '严重程度：high/medium/low', 'medium')
  .option('-d, --description <desc>', '缺陷描述')
  .action(bugCommand);

bugCmd
  .command('close <bugId>')
  .description('关闭缺陷（open → closed，修复闭环）')
  .action((bugId: string) => closeBugCommand({ bugId }));

bugCmd
  .command('list')
  .description('缺陷清单')
  .option('--status <s>', '状态过滤：open/closed/all', 'open')
  .action((cmd: { status?: string }) => listBugsCommand({ status: cmd.status }));

// 14. 质量门禁
program
  .command('gate')
  .alias('gt')
  .description('质量门禁检查（覆盖率/规格完备/执行完备/通过率/P0/漂移/缺陷），error 级不达标 exitCode 1')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-t, --task <id>', '按 Task 检查')
  .option('--threshold <percent>', '覆盖率阈值（默认取 config.yaml，缺省 80）')
  .option('--json', '输出 JSON（供门禁回流机器解析）')
  .action(gateCommand);

// 15. 项目配置
program
  .command('config')
  .alias('cfg')
  .description('查看/设置项目配置（.spectest/config.yaml：门禁阈值、流水线行为）')
  .option('--init', '生成 config.yaml')
  .argument('[action]', '操作：set（设置）；缺省 = 查看')
  .argument('[key]', '配置键（点路径：gate.coverageThreshold）')
  .argument('[value]', '配置值')
  .action((action: string | undefined, key: string | undefined, value: string | undefined, cmd: { init?: boolean }) =>
    configCommand({
      init: cmd.init,
      key: action === 'set' ? key : undefined,
      value: action === 'set' ? value : undefined,
    })
  );

// 16. 测试报告
program
  .command('report')
  .alias('rp')
  .description('生成测试报告')
  .option('-i, --iteration <name>', '指定期次名称')
  .option('-s, --suite <id>', '按套件筛选')
  .option('-o, --output <path>', '报告输出路径')
  .action(reportCommand);

// 17. 用例导出
program
  .command('export')
  .alias('ex')
  .description('导出用例合集：按期次/功能单元/负责人聚合，md/yaml/json 三格式')
  .option('-i, --iteration <name>', '期次过滤（suite.iteration 匹配；缺省 = 全量库）')
  .option('-u, --units <slugs>', '功能单元多选：slug 或单元名，逗号分隔')
  .option('-a, --all', '显式全量导出（缺省即全量，兼容语义）')
  .option('-o, --owner <name>', '按负责人过滤')
  .option('-f, --format <fmt>', '导出格式：md / yaml / json', 'md')
  .action(exportCommand);

// 18. 测试总结
program
  .command('summary')
  .alias('sm')
  .description('迭代测试总结（通过率、覆盖率、缺陷统计、质量度量）')
  .option('-i, --iteration <name>', '指定期次名称')
  .action(summaryCommand);

// 19. 趋势分析
program
  .command('trend')
  .alias('td')
  .description('跨迭代趋势分析（覆盖率/通过率/缺陷数趋势对比）')
  .option('-i, --iterations <list>', '期次列表，逗号分隔（如 Q1,Q2,Q3）')
  .action(trendCommand);

// 20. 测试归档
program
  .command('archive')
  .alias('ar')
  .description('将测试用例归档到知识库')
  .option('-i, --iteration <name>', '指定期次名称')
  .action(archiveCommand);

// 21. 测试状态
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
  1. ask           → 自然语言智能入口（说人话，自动识别意图并执行）
  2. init          → 初始化测试项目（自动生成环境模板）
  3. plan          → 生成测试计划（策略、风险、时间线）
  4. gen           → 从 AC 生成测试用例（已有用例复用；--spec-dir 自备规格目录）
  5. api           → 从 API Contract 生成接口测试
  6. gap           → 检测覆盖缺口
  7. run           → 执行测试流水线（无参 = 全量回归，跨期次逐期推进）
  8. contract-run  → 契约执行（真实 HTTP + 状态码断言，内置执行器）
  9. visual-review → 视觉模型审查（基线确认 / diff 分析 / 语义断言）
  10. verify       → 文档静态验证（AC 完整性/四段齐全/端级专项）
  11. regress      → 变更后自动执行回归测试
  12. impact       → 分析变更影响
  13. bug          → 记录缺陷（子命令：close 关闭 / list 清单）
  14. gate         → 质量门禁检查
  15. config       → 查看/设置配置（config.yaml）
  16. report       → 生成测试报告
  17. export       → 导出用例合集（md/yaml/json 三格式）
  18. summary      → 生成测试总结
  19. trend        → 跨迭代趋势分析
  20. archive      → 迭代测试数据归档（快照随附用例副本）
  21. status       → 查看测试状态

用例资产全量层：.spectest/GLOBAL/cases 跨期次复用；迭代层只留 matrix 执行事实。

示例：
  spectest ask "跑一下测试"
  spectest ask "质量门禁能不能放行"
  spectest ask "记录缺陷 --case-id TS-xxx-AC-001 标题 金额精度丢失"
  spectest plan --iteration Q1 --goal "订单导出功能"
  spectest gen --iteration Q1 --type unit
  spectest gen --iteration Q1 --spec-dir ./my-specs
  spectest api --iteration Q1
  spectest gap --iteration Q1
  spectest run --iteration Q1 --suite TS-123456
  spectest regress --task Task-001
  spectest impact --task Task-001
  spectest bug --case-id TS-xxx-AC-001 --title "金额精度丢失"
  spectest bug close BUG-1720000000000
  spectest bug list --status all
  spectest gate --iteration Q1 --threshold 80
  spectest report --iteration Q1
  spectest summary --iteration Q1
  spectest trend
  spectest archive --iteration Q1
  spectest config set gate.coverageThreshold 85
`);

program.addHelpText('afterAll', `
更多信息：
  文档：https://gitee.com/windfullsheng/spec-test
  问题反馈：https://gitee.com/windfullsheng/spec-test/issues
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
│   🧪  SpecTest v${pkgVersion}${' '.repeat(Math.max(0, 34 - pkgVersion.length))}│
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
      const m = aggregateIterationMetrics(projectRoot, context.currentIteration);
      console.log(`📂 当前项目：${path.basename(projectRoot)}`);
      console.log(`📅 当前期次：${context.currentIteration}`);
      console.log(`📊 总套件：${m.totalSuites}  |  总用例：${m.totalCases}  |  规格缺口：${m.specGaps}`);
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
