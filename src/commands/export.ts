import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot } from '../core/context.js';
import { getGlobalCasesRoot } from '../core/trace-matrix.js';
import { TestSuiteSchema, TestCaseSchema, type TestSuite, type TestCase } from '../core/schemas/index.js';

export interface ExportOptions {
  /** 期次过滤（suite.iteration 匹配；缺省 = 全量库） */
  iteration?: string;
  /** 功能单元多选：slug 或单元名，逗号分隔 */
  units?: string;
  /** 显式全量（缺省即全量，兼容语义） */
  all?: boolean;
  /** 按负责人过滤 */
  owner?: string;
  /** 导出格式：md / yaml / json */
  format?: 'md' | 'yaml' | 'json';
}

/** 聚合视图：套件 + 用例 */
interface ExportedSuite {
  suite: TestSuite;
  cases: TestCase[];
}

/**
 * 用例导出：从全量用例库（GLOBAL/cases）按 期次/功能单元/负责人 聚合，
 * 支持 md（评审阅读）/ yaml / json（机器消费）三格式。
 * 落盘 .spectest/exports/{期次|ALL}/EXPORT-{ts}.{fmt}。
 */
export async function exportCommand(options: ExportOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const format = options.format ?? 'md';
  if (!['md', 'yaml', 'json'].includes(format)) {
    logger.error(`不支持的导出格式：${format}（可用 md / yaml / json）`);
    process.exit(1);
  }
  const units = options.units
    ? options.units.split(',').map((u) => u.trim()).filter(Boolean)
    : [];

  const spinner = new Spinner('正在聚合用例...');
  spinner.start();
  try {
    const exported = collectSuites(projectRoot, { iteration: options.iteration, units, owner: options.owner });
    if (exported.length === 0) {
      spinner.stop();
      logger.error('没有匹配的用例可导出（检查期次/功能单元/负责人过滤条件）');
      process.exit(1);
    }
    const caseCount = exported.reduce((s, e) => s + e.cases.length, 0);
    const key = options.iteration ?? 'ALL';
    const outDir = path.join(projectRoot, '.spectest', 'exports', key);
    fs.ensureDirSync(outDir);
    const outPath = path.join(outDir, `EXPORT-${key}-${Date.now()}.${format}`);
    if (format === 'md') {
      writeMarkdown(outPath, exported, options.iteration);
    } else {
      const structure = toStructure(exported, options.iteration);
      const body = format === 'yaml'
        ? yaml.dump(structure, { noRefs: true })
        : JSON.stringify(structure, null, 2);
      fs.writeFileSync(outPath, body, 'utf-8');
    }
    spinner.stop(`导出完成：${exported.length} 个套件 / ${caseCount} 条用例 → ${outPath}`);
  } catch (err) {
    spinner.stop();
    logger.error(`导出失败：${(err as Error).message}`);
    process.exit(1);
  }
}

/** 扫全量库：{端}/{单元}/suites 下各套件的 SUITE.yaml → 过滤 → 聚合 */
export function collectSuites(
  projectRoot: string,
  filter: { iteration?: string; units: string[]; owner?: string }
): ExportedSuite[] {
  const root = getGlobalCasesRoot(projectRoot);
  if (!fs.existsSync(root)) return [];
  const result: ExportedSuite[] = [];
  for (const pd of fs.readdirSync(root, { withFileTypes: true })) {
    if (!pd.isDirectory()) continue;
    const unitRoot = path.join(root, pd.name);
    for (const ud of fs.readdirSync(unitRoot, { withFileTypes: true })) {
      if (!ud.isDirectory()) continue;
      const suitesDir = path.join(unitRoot, ud.name, 'suites');
      if (!fs.existsSync(suitesDir)) continue;
      for (const sd of fs.readdirSync(suitesDir, { withFileTypes: true })) {
        if (!sd.isDirectory()) continue;
        const suitePath = path.join(suitesDir, sd.name, 'SUITE.yaml');
        if (!fs.existsSync(suitePath)) continue;
        let suite: TestSuite;
        try {
          suite = TestSuiteSchema.parse(
            yaml.load(fs.readFileSync(suitePath, 'utf-8'), { schema: yaml.CORE_SCHEMA })
          );
        } catch {
          continue; // 损坏套件跳过（报缺不脑补）
        }
        if (filter.iteration && suite.iteration !== filter.iteration) continue;
        if (filter.units.length > 0) {
          const unitName = suite.name.split(' · ')[0] ?? '';
          if (!filter.units.includes(suite.unit) && !filter.units.includes(unitName)) continue;
        }
        if (filter.owner && suite.owner !== filter.owner) continue;
        result.push({ suite, cases: loadCases(suitePath) });
      }
    }
  }
  return result;
}

/** 读套件的 cases/*.yaml（zod 校验，非法跳过） */
function loadCases(suitePath: string): TestCase[] {
  const casesDir = path.join(path.dirname(suitePath), 'cases');
  if (!fs.existsSync(casesDir)) return [];
  const cases: TestCase[] = [];
  for (const f of fs.readdirSync(casesDir)) {
    if (!f.endsWith('.yaml')) continue;
    try {
      cases.push(TestCaseSchema.parse(
        yaml.load(fs.readFileSync(path.join(casesDir, f), 'utf-8'), { schema: yaml.CORE_SCHEMA })
      ));
    } catch {
      // 非法用例跳过（报缺不脑补）
    }
  }
  return cases;
}

/** 机器可读结构（yaml/json 共用） */
function toStructure(exported: ExportedSuite[], iteration?: string) {
  return {
    exportedAt: new Date().toISOString(),
    iteration: iteration ?? 'ALL',
    suiteCount: exported.length,
    caseCount: exported.reduce((s, e) => s + e.cases.length, 0),
    suites: exported.map((e) => ({
      id: e.suite.id,
      name: e.suite.name,
      platform: e.suite.platform,
      unit: e.suite.unit,
      owner: e.suite.owner ?? null,
      type: e.suite.type,
      passRate: e.suite.passRate,
      iteration: e.suite.iteration,
      bornIteration: e.suite.bornIteration ?? null,
      cases: e.cases.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        status: c.status,
        priority: c.priority,
        scenario: c.scenario,
        relatedAC: c.relatedAC,
        preconditions: c.preconditions,
        steps: c.steps,
        testData: c.testData ?? null,
        tags: c.tags,
      })),
    })),
  };
}

/** md 导出：概览 + 负责人分布 + 逐套件用例表与步骤明细 */
function writeMarkdown(outPath: string, exported: ExportedSuite[], iteration?: string): void {
  const caseCount = exported.reduce((s, e) => s + e.cases.length, 0);
  const lines: string[] = [];
  lines.push(`# 测试用例导出（${iteration ?? '全量库'}）`);
  lines.push('');
  lines.push(`> 导出时间：${new Date().toISOString()}　套件 ${exported.length} 个　用例 ${caseCount} 条`);
  lines.push('');

  const ownerMap = new Map<string, number>();
  for (const e of exported) {
    const o = e.suite.owner ?? '未登记';
    ownerMap.set(o, (ownerMap.get(o) ?? 0) + 1);
  }
  lines.push('## 负责人分布');
  lines.push('');
  lines.push('| 负责人 | 套件数 |');
  lines.push('| :--- | :--- |');
  for (const [o, n] of [...ownerMap.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${o} | ${n} |`);
  }
  lines.push('');

  for (const e of exported) {
    lines.push(`## 套件 \`${e.suite.id}\``);
    lines.push('');
    lines.push(`- 名称：${e.suite.name}`);
    lines.push(`- 端：\`${e.suite.platform}\`　单元：\`${e.suite.unit}\`　类型：\`${e.suite.type}\``);
    lines.push(`- 负责人：${e.suite.owner ?? '未登记'}`);
    lines.push(`- 诞生期次：${e.suite.bornIteration ?? e.suite.iteration}　最近期次：${e.suite.iteration}　通过率：${e.suite.passRate}%`);
    lines.push('');
    if (e.cases.length === 0) {
      lines.push('（暂无用例）');
      lines.push('');
      continue;
    }
    lines.push('| 用例 ID | 名称 | 优先级 | 场景 | 状态 | AC |');
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const c of e.cases) {
      lines.push(`| \`${c.id}\` | ${c.name.replace(/\|/g, '\\|')} | ${c.priority} | ${c.scenario} | ${c.status} | ${c.relatedAC.join('、') || '-'} |`);
    }
    lines.push('');
    for (const c of e.cases) {
      lines.push(`### ${c.id} ${c.name}`);
      lines.push('');
      if (c.preconditions.length > 0) {
        lines.push(`**前置条件**：${c.preconditions.join('；')}`);
        lines.push('');
      }
      lines.push('| 步骤 | 操作 | 预期 |');
      lines.push('| :--- | :--- | :--- |');
      for (const st of c.steps) {
        lines.push(`| ${st.step} | ${st.action.replace(/\|/g, '\\|')} | ${st.expected.replace(/\|/g, '\\|')} |`);
      }
      lines.push('');
    }
  }
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
}
