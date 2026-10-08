import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext } from '../core/context.js';
import { aggregateIterationMetrics } from '../core/metrics.js';
import { loadAllMatrices, getUnitSuitesDir, getGlobalCasesRoot } from '../core/trace-matrix.js';
import { TestSuiteSchema } from '../core/schemas/test-suite.schema.js';

export interface ReportOptions {
  iteration?: string;
  suite?: string;
  output?: string;
}

/**
 * 生成测试报告
 * 事实源：矩阵（AC 覆盖 + 用例执行状态）+ SUITE.yaml/cases（js-yaml 解析，
 * 不做字符串正则匹配）。
 */
export async function reportCommand(options: ReportOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称，如：spectest report --iteration Q1');
    process.exit(1);
  }

  const spinner = new Spinner('正在生成测试报告...');
  spinner.start();

  try {
    const reportContent = generateTestReport(projectRoot, iteration);

    const outputDir = options.output || path.join(projectRoot, '.spectest', 'reports');
    fs.ensureDirSync(outputDir);

    const reportPath = path.join(outputDir, `test-report-${iteration}-${Date.now()}.md`);
    fs.writeFileSync(reportPath, reportContent, 'utf-8');

    spinner.stop(`报告已生成：${reportPath}`);
  } catch (error) {
    spinner.fail(`生成报告失败：${error}`);
    throw error;
  }
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', ready: '就绪', passed: '通过', failed: '失败',
  skipped: '跳过', blocked: '阻塞',
};

/** 按负责人聚合全量层套件事实（按期次过滤；损坏套件跳过，报缺不脑补） */
function collectOwnerStats(
  projectRoot: string, iteration: string
): { owner: string; suites: number; cases: number; avgPassRate: number | null }[] {
  const root = getGlobalCasesRoot(projectRoot);
  if (!fs.existsSync(root)) return [];
  const map = new Map<string, { suites: number; cases: number; passRateSum: number; passRateCount: number }>();
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
        try {
          const suite = TestSuiteSchema.parse(
            yaml.load(fs.readFileSync(suitePath, 'utf-8'), { schema: yaml.CORE_SCHEMA })
          );
          if (suite.iteration !== iteration) continue;
          const key = suite.owner ?? '未登记';
          const st = map.get(key) ?? { suites: 0, cases: 0, passRateSum: 0, passRateCount: 0 };
          st.suites += 1;
          st.cases += suite.testCaseIds.length;
          st.passRateSum += suite.passRate;
          st.passRateCount += 1;
          map.set(key, st);
        } catch {
          // 损坏套件跳过
        }
      }
    }
  }
  return [...map.entries()]
    .map(([owner, st]) => ({
      owner,
      suites: st.suites,
      cases: st.cases,
      avgPassRate: st.passRateCount > 0 ? Math.round(st.passRateSum / st.passRateCount) : null,
    }))
    .sort((a, b) => b.suites - a.suites);
}

function generateTestReport(projectRoot: string, iteration: string): string {
  const m = aggregateIterationMetrics(projectRoot, iteration);
  const rate = (v: number | null): string => (v === null ? '-' : `${v}%`);

  let md = `# 测试报告 - ${iteration}\n\n`;
  md += `> 生成时间：${new Date().toISOString()}\n\n`;

  // ── 概览（矩阵度量） ──
  md += `## 概览\n\n`;
  md += `| 指标 | 值 |\n`;
  md += `|------|----|\n`;
  md += `| 功能单元 | ${m.totalUnits} |\n`;
  md += `| 测试套件 | ${m.totalSuites} |\n`;
  md += `| 测试用例 | ${m.totalCases} |\n`;
  md += `| 已执行 / 未执行 | ${m.executedCases} / ${m.pendingCases} |\n`;
  md += `| 通过 / 失败 / 跳过 | ${m.passedCases} / ${m.failedCases} / ${m.skippedCases} |\n`;
  md += `| 通过率 | ${rate(m.passRate)} |\n`;
  md += `| AC 覆盖率（${m.coveredAC}/${m.totalAC}） | ${rate(m.coverageRate)} |\n`;
  md += `| P0 通过 | ${m.p0.passed}/${m.p0.total}（${m.p0.pending} 待执行） |\n`;
  md += `| 缺陷（开/关） | ${m.bugs.open} / ${m.bugs.closed} |\n`;
  md += `| 规格缺口 / 漂移套件 | ${m.specGaps} / ${m.driftSuites} |\n\n`;

  // ── 负责人分布（源自 SUITE.yaml owner；未登记归「未登记」） ──
  md += `## 负责人分布\n\n`;
  const ownerStats = collectOwnerStats(projectRoot, iteration);
  if (ownerStats.length === 0) {
    md += '⚠️ 该期次暂无套件 owner 事实（SpecCore STAFFING/任务未登记时留空）。\n\n';
  } else {
    md += `| 负责人 | 套件数 | 用例数 | 平均通过率 |\n`;
    md += `|----|----|----|----|\n`;
    for (const s of ownerStats) {
      md += `| ${s.owner} | ${s.suites} | ${s.cases} | ${s.avgPassRate === null ? '-' : `${s.avgPassRate}%`} |\n`;
    }
    md += '\n';
  }

  // ── 单元级 AC 覆盖矩阵 ──
  md += `## AC 覆盖矩阵\n\n`;
  const matrices = loadAllMatrices(projectRoot, iteration);
  if (matrices.length === 0) {
    md += '⚠️ 该期次暂无矩阵事实（请先 spectest gen 生成用例骨架）。\n\n';
  }
  for (const matrix of matrices) {
    md += `### [${matrix.platform}] ${matrix.unit}\n\n`;
    if (matrix.traces.length === 0) {
      md += '（契约面单元，无 AC 锚定）\n\n';
      continue;
    }
    md += `| AC | 描述 | 场景 | 证明用例 | 用例状态 |\n`;
    md += `|----|------|------|----------|----------|\n`;
    for (const t of matrix.traces) {
      const statuses = t.caseIds.map((id) => {
        const c = matrix.cases.find((x) => x.caseId === id);
        return c ? `${STATUS_LABEL[c.status] ?? c.status}` : '未登记';
      });
      md += `| ${t.acId} | ${t.acDesc.replace(/\|/g, '\\|').slice(0, 40)} | ${t.scenario} | ${t.caseIds.join('<br>') || '—'} | ${statuses.join('<br>') || '—'} |\n`;
    }
    md += '\n';
  }

  // ── 套件与用例明细（全量层 GLOBAL/cases，按期次矩阵涉及单元过滤） ──
  md += `## 套件明细\n\n`;
  {
    const matrices = loadAllMatrices(projectRoot, iteration);
    const seen = new Set<string>();
    for (const m of matrices) {
      const key = `${m.platform}/${m.unitSlug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      {
        const suitesDir = getUnitSuitesDir(projectRoot, m.platform, m.unitSlug, iteration);
        if (!fs.existsSync(suitesDir)) continue;
        for (const sd of fs.readdirSync(suitesDir, { withFileTypes: true })) {
          if (!sd.isDirectory()) continue;
          const suitePath = path.join(suitesDir, sd.name, 'SUITE.yaml');
          if (!fs.existsSync(suitePath)) continue;
          let suite: { id?: string; name?: string; type?: string } = {};
          try {
            suite = yaml.load(fs.readFileSync(suitePath, 'utf-8'), { schema: yaml.CORE_SCHEMA }) ?? {};
          } catch { /* 忽略损坏套件 */ }

          const casesDir = path.join(suitesDir, sd.name, 'cases');
          const caseFiles = fs.existsSync(casesDir)
            ? fs.readdirSync(casesDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
            : [];
          const unitMatrix = matrices.find((x) => x.platform === m.platform && x.unitSlug === m.unitSlug);
          const statusOf = (id: string): string => {
            const c = unitMatrix?.cases.find((x) => x.caseId === id);
            return c ? (STATUS_LABEL[c.status] ?? c.status) : '-';
          };

          md += `### ${sd.name}\n\n`;
          md += `- 名称：${suite.name ?? '-'} 类型：${suite.type ?? '-'}\n\n`;
          if (caseFiles.length > 0) {
            md += `| 用例 ID | 名称 | 优先级 | 状态 |\n`;
            md += `|---------|------|--------|------|\n`;
            for (const f of caseFiles) {
              let tc: { id?: string; name?: string; priority?: string } = {};
              try {
                tc = yaml.load(fs.readFileSync(path.join(casesDir, f), 'utf-8'), { schema: yaml.CORE_SCHEMA }) ?? {};
              } catch { /* 忽略损坏用例 */ }
              const id = tc.id ?? f.replace(/\.ya?ml$/, '');
              md += `| ${id} | ${(tc.name ?? '-').slice(0, 30)} | ${tc.priority ?? '-'} | ${statusOf(id)} |\n`;
            }
            md += '\n';
          }
        }
      }
    }
  }

  return md;
}
