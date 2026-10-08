import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import { ensureProjectRoot } from '../core/context.js';
import {
  loadConfig, saveConfig, setConfigValue, getConfigPath,
} from '../core/config.js';

export interface ConfigOptions {
  init?: boolean;
  key?: string;
  value?: string;
}

/**
 * 项目配置标准（.spectest/config.yaml）
 *
 * config          查看当前配置（含未落盘的内置默认值）
 * config init     生成配置文件
 * config set <k> <v>  点路径设置：gate.coverageThreshold 85
 */
export async function configCommand(options: ConfigOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();

  if (options.init) {
    saveConfig(projectRoot, loadConfig(projectRoot));
    logger.info(`已生成 ${getConfigPath(projectRoot)}`);
    displayConfig(projectRoot);
    return;
  }

  if (options.key) {
    if (!options.value) {
      logger.error('请提供配置值：spectest config set gate.coverageThreshold 85');
      process.exit(1);
    }
    try {
      setConfigValue(projectRoot, options.key, options.value);
      logger.info(`已设置 ${options.key} = ${options.value}`);
    } catch (error) {
      logger.error(`设置失败：${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
    displayConfig(projectRoot);
    return;
  }

  displayConfig(projectRoot);
}

function displayConfig(projectRoot: string): void {
  const config = loadConfig(projectRoot);
  const onDisk = fs.existsSync(getConfigPath(projectRoot));
  const source = onDisk ? getConfigPath(projectRoot) : '内置默认值（未生成 config.yaml，spectest config init 可落盘）';

  console.log('');
  console.log('─ Spectest 项目配置 ─');
  console.log(`来源：${source}`);
  console.log('');
  console.log('gate:');
  console.log(`  coverageThreshold  ${config.gate.coverageThreshold}%`);
  console.log(`  passRateThreshold  ${config.gate.passRateThreshold}%`);
  console.log('pipeline:');
  console.log(`  interactive        ${config.pipeline.interactive ? '人机交互（每层确认）' : '全自动（失败即停）'}`);
  console.log(`  defaultEnv         ${config.pipeline.defaultEnv}`);
  console.log('');
  console.log('修改示例：');
  console.log('  spectest config set gate.coverageThreshold 85');
  console.log('  spectest config set pipeline.interactive true');
  console.log('  spectest config set pipeline.defaultEnv staging');
  console.log('');
}
