import path from 'path';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import { Spinner, logger } from '../utils/logger.js';
import { i18n } from '../i18n/index.js';
import { ensureProjectRoot, findProjectRoot } from '../core/context.js';

export interface InitOptions {
  force?: boolean;
  iteration?: string;
}

/**
 * 初始化测试项目
 * 创建 .spectest/ 目录结构，与 .speccore/ 同级
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const projectRoot = findProjectRoot() || process.cwd();
  const spectestDir = path.join(projectRoot, '.spectest');

  // 检查是否已初始化
  if (fs.existsSync(spectestDir) && !options.force) {
    logger.warn('测试项目已存在。使用 --force 强制重新初始化。');
    return;
  }

  const spinner = new Spinner(i18n.t('cmd.init.start'));
  spinner.start();

  try {
    // 确定期次
    let iteration: string | undefined = options.iteration;

    if (!iteration) {
      // 尝试自动检测
      iteration = detectIteration(projectRoot);

      if (!iteration) {
        spinner.stop();
        const answer = await inquirer.prompt([
          {
            type: 'input',
            name: 'iteration',
            message: '请输入期次名称（如 Q1）：',
            validate: (val: string) => val.trim() ? true : '期次名称不能为空',
          },
        ]);
        iteration = answer.iteration as string;
        spinner.start();
      }
    }

    const targetIteration = iteration;

    // 创建目录结构
    createDirectoryStructure(spectestDir, iteration);

    // 创建初始配置
    createConfig(spectestDir, iteration);

    // 生成环境模板（契约执行上手零门槛，baseUrl 留待用户填写）
    createEnvironmentTemplate(spectestDir);

    spinner.stop(`✅ ${i18n.t('cmd.init.success')}`);
    showNextSteps(iteration);
  } catch (error) {
    spinner.fail(`${i18n.t('cmd.init.fail')}: ${error}`);
    throw error;
  }
}

/**
 * 自动检测期次
 */
function detectIteration(projectRoot: string): string | undefined {
  // 从 .speccore/local/context.json 读取
  const contextPath = path.join(projectRoot, '.speccore', 'local', 'context.json');
  if (fs.existsSync(contextPath)) {
    try {
      const context = fs.readJsonSync(contextPath);
      if (context.currentIteration) {
        return context.currentIteration;
      }
    } catch { /* ignore */ }
  }

  // 扫描期次目录
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && /^期次-/.test(entry.name)) {
      return entry.name.replace('期次-', '');
    }
  }

  return undefined;
}

/**
 * 创建目录结构
 */
function createDirectoryStructure(baseDir: string, iteration: string): void {
  // 与 ARCHITECTURE §4 对齐：全量层用例资产 + 迭代层执行事实
  const dirs = [
    baseDir,
    path.join(baseDir, 'local'),
    path.join(baseDir, 'environments'),
    path.join(baseDir, 'fixtures'),
    path.join(baseDir, 'templates'),
    path.join(baseDir, 'reports'),
    path.join(baseDir, 'plans'),
    path.join(baseDir, 'bugs'),
    path.join(baseDir, 'GLOBAL', 'cases'),
    path.join(baseDir, 'archive'),
    path.join(baseDir, 'trend'),
    // 迭代层 matrix 由 trace-matrix 按需幂等创建，init 只建期次锚点
    path.join(baseDir, 'iterations', iteration),
  ];

  for (const dir of dirs) {
    fs.ensureDirSync(dir);
  }
}

/**
 * 创建初始配置
 */
function createConfig(baseDir: string, iteration: string): void {
  // config.yaml 标准：只承载会改变 CLI 判定结果的参数（门禁阈值/流水线行为）
  const config = {
    gate: { coverageThreshold: 80, passRateThreshold: 90 },
    pipeline: { interactive: false, defaultEnv: 'test' },
  };

  fs.writeFileSync(
    path.join(baseDir, 'config.yaml'),
    '# Spectest 项目配置\n' +
    '# 阈值优先级：CLI 参数 > 本文件 > 内置默认值\n\n' +
    'gate:\n' +
    `  coverageThreshold: ${config.gate.coverageThreshold}\n` +
    `  passRateThreshold: ${config.gate.passRateThreshold}\n` +
    'pipeline:\n' +
    `  interactive: ${config.pipeline.interactive}\n` +
    `  defaultEnv: ${config.pipeline.defaultEnv}\n`,
    'utf-8'
  );
}

/**
 * 生成环境模板：environments/test.yaml（baseUrl 留空位，供契约执行 --env test 使用）
 */
function createEnvironmentTemplate(baseDir: string): void {
  const envFile = path.join(baseDir, 'environments', 'test.yaml');
  if (fs.existsSync(envFile)) return; // 幂等：用户已填写的环境不覆盖

  const content = [
    '# 测试环境配置（契约执行 target：spectest run --env test）',
    '# baseUrl 为契约执行目标基址，替换为真实服务地址后生效',
    '# 更多环境：复制本文件为 {env}.yaml（如 sit.yaml），--env sit 切换',
    'baseUrl: http://localhost:8080  # TODO: 替换为真实服务地址',
    'timeoutMs: 5000',
    '# 公共请求头：支持 ${VAR} 环境变量占位（执行时从 process.env 解析，缺变量如实报缺）',
    'headers:',
    '  Content-Type: application/json',
    "  # Authorization: Bearer ${TOKEN}",
    '',
  ].join('\n');

  fs.writeFileSync(envFile, content, 'utf-8');
  logger.info(`📄 已生成环境模板：.spectest/environments/test.yaml（baseUrl 待填写）`);
}

/**
 * 显示下一步提示
 */
function showNextSteps(iteration: string): void {
  console.log(`
${'─'.repeat(50)}
📋 下一步操作：

  1️⃣  生成测试用例
      spectest gen --iteration ${iteration}

  2️⃣  检测覆盖缺口
      spectest gap --iteration ${iteration}

  3️⃣  查看测试状态
      spectest status

${'─'.repeat(50)}
`);
}
