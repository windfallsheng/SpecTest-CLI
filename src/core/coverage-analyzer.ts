import path from 'path';
import fs from 'fs-extra';
import { CoverageReport } from './schemas/index.js';
import { queryACCoverage } from './predicates.js';

/**
 * 覆盖分析选项
 */
export interface CoverageAnalyzeOptions {
  projectRoot: string;
  iteration: string;
  /** 端名过滤（可选） */
  platform?: string;
  /** 单元过滤（unitSlug 或单元名） */
  unit?: string;
}

/**
 * 覆盖分析结果（Step 4 收敛版：全部判定来自矩阵谓词）
 */
export interface CoverageAnalyzeResult {
  report: CoverageReport;
  /** 单元级缺口分组（按端×单元聚合） */
  uncovered: Array<{
    platform: string;
    unit: string;
    missingAC: string[];
    suggested: string[];
  }>;
  risks: Array<{
    requirementId: string;
    riskLevel: 'high' | 'medium' | 'low';
    reason: string;
  }>;
}

/**
 * 覆盖分析引擎
 *
 * 铁律「判定收敛于矩阵」：本函数不再扫描用例文件、不做字符串匹配，
 * AC 覆盖与否直接查矩阵 traces.caseIds（gap 的唯一定义）。
 */
export function analyzeCoverage(options: CoverageAnalyzeOptions): CoverageAnalyzeResult {
  const { projectRoot, iteration, platform, unit } = options;

  const query = queryACCoverage(projectRoot, iteration, { platform, unit });
  const { covered, uncovered, specGaps } = query;

  const totalAC = covered.length + uncovered.length;
  const coveredAC = covered.length;
  const coverageRate = totalAC > 0 ? Math.round((coveredAC / totalAC) * 100) : 0;

  // 单元级分组（报告可读性）
  const byUnit = new Map<string, typeof uncovered>();
  for (const u of uncovered) {
    const key = `${u.platform}/${u.unit}`;
    if (!byUnit.has(key)) byUnit.set(key, []);
    byUnit.get(key)!.push(u);
  }

  const uncoveredGroups = [...byUnit.entries()].map(([key, facts]) => {
    const [p, un] = key.split('/');
    return {
      platform: p,
      unit: un,
      missingAC: facts.map((f) => `${f.acId} ${f.acDesc}`),
      suggested: facts.map((f) => suggestByScenario(f.scenario, f.acDesc)),
    };
  });

  // 风险：按单元缺口比例评估（requirementId 收敛为 端/单元）
  const risks = assessUnitRisks(covered, uncovered);

  const report: CoverageReport = {
    id: `COV-${iteration}-${Date.now()}`,
    iteration,
    totalAC,
    coveredAC,
    coverageRate,
    specGaps,
    gapItems: uncovered.map((u) => ({
      platform: u.platform,
      unit: u.unit,
      acId: u.acId,
      acDesc: u.acDesc,
      scenario: u.scenario,
    })),
    generatedAt: new Date().toISOString(),
  };

  return { report, uncovered: uncoveredGroups, risks };
}

/** 场景 → 建议措辞（与端专属模板的检查清单一致） */
function suggestByScenario(scenario: string, acDesc: string): string {
  const map: Record<string, string> = {
    happy: `正向用例：${acDesc}，验证主流程`,
    error: `异常用例：${acDesc}，验证错误处理与数据回滚`,
    boundary: `边界用例：${acDesc}，验证边界值`,
    edge: `边缘用例：${acDesc}，验证极端/并发场景`,
  };
  return map[scenario] ?? `用例：${acDesc}`;
}

/** 单元级风险：缺口占比 ≥50% high，≥20% medium，其余 low */
function assessUnitRisks(
  covered: { platform: string; unit: string }[],
  uncovered: { platform: string; unit: string }[]
): CoverageAnalyzeResult['risks'] {
  const byUnit = new Map<string, { total: number; missing: number }>();
  const bump = (key: string, missing: boolean) => {
    const cur = byUnit.get(key) ?? { total: 0, missing: 0 };
    cur.total++;
    if (missing) cur.missing++;
    byUnit.set(key, cur);
  };
  for (const c of covered) bump(`${c.platform}/${c.unit}`, false);
  for (const u of uncovered) bump(`${u.platform}/${u.unit}`, true);

  const risks: CoverageAnalyzeResult['risks'] = [];
  for (const [key, s] of byUnit) {
    if (s.missing === 0) continue;
    const ratio = s.missing / s.total;
    const level: 'high' | 'medium' | 'low' = ratio >= 0.5 ? 'high' : ratio >= 0.2 ? 'medium' : 'low';
    const reasonMap = {
      high: `覆盖缺口 ${s.missing}/${s.total}（${Math.round(ratio * 100)}%），核心场景可能遗漏`,
      medium: `覆盖缺口 ${s.missing}/${s.total}（${Math.round(ratio * 100)}%），建议补充`,
      low: `少量场景未覆盖（${s.missing}/${s.total}）`,
    } as const;
    risks.push({ requirementId: key, riskLevel: level, reason: reasonMap[level] });
  }
  return risks;
}

/**
 * 保存覆盖分析报告
 */
export function saveCoverageReport(
  projectRoot: string,
  result: CoverageAnalyzeResult
): string {
  const localDir = path.join(projectRoot, '.spectest', 'reports');
  fs.ensureDirSync(localDir);

  const reportPath = path.join(
    localDir,
    `coverage-${result.report.iteration}-${Date.now()}.md`
  );

  const md = generateCoverageMarkdown(result);
  fs.writeFileSync(reportPath, md, 'utf-8');

  return reportPath;
}

/**
 * 生成覆盖报告 Markdown（AC 级，端×单元分组）
 */
function generateCoverageMarkdown(result: CoverageAnalyzeResult): string {
  const { report, uncovered, risks } = result;

  let md = `# 测试覆盖分析报告\n\n`;
  md += `> 期次：${report.iteration}\n`;
  md += `> 生成时间：${report.generatedAt}\n\n`;

  // 概览
  md += `## 概览\n\n`;
  md += `| 指标 | 值 |\n`;
  md += `|------|----|\n`;
  md += `| 总 AC 数 | ${report.totalAC} |\n`;
  md += `| 已覆盖 AC 数 | ${report.coveredAC} |\n`;
  md += `| 覆盖率 | ${report.coverageRate}% |\n`;
  md += `| 规格缺口（骨架） | ${report.specGaps.length} |\n\n`;

  // 覆盖率进度条
  const barLength = 20;
  const filled = Math.round((report.coverageRate / 100) * barLength);
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
  md += `\`\`\`\n${bar} ${report.coverageRate}%\n\`\`\`\n\n`;

  // 规格缺口
  if (report.specGaps.length > 0) {
    md += `## 🧱 规格缺口（报缺不脑补）\n\n`;
    md += `| 端 | 单元 | 原因 |\n`;
    md += `|----|------|------|\n`;
    for (const g of report.specGaps) {
      md += `| ${g.platform} | ${g.unit} | ${g.reason} |\n`;
    }
    md += '\n';
  }

  // 覆盖缺口
  if (uncovered.length > 0) {
    md += `## ⚠️ 覆盖缺口（${uncovered.length} 个端×单元）\n\n`;

    for (const gap of uncovered) {
      md += `### ${gap.platform}/${gap.unit}\n\n`;
      md += `**缺失的 AC：**\n\n`;
      for (const ac of gap.missingAC) {
        md += `- [ ] ${ac}\n`;
      }
      md += `\n**建议补充的测试：**\n\n`;
      for (const s of gap.suggested) {
        md += `- ${s}\n`;
      }
      md += '\n';
    }
  } else if (report.specGaps.length === 0) {
    md += `## ✅ 覆盖完整\n\n所有 AC 均已有用例证明。\n\n`;
  }

  // 风险评估
  if (risks.length > 0) {
    md += `## 🔴 风险评估\n\n`;
    md += `| 端/单元 | 风险等级 | 原因 |\n`;
    md += `|---------|----------|------|\n`;

    for (const risk of risks) {
      const emoji = risk.riskLevel === 'high' ? '🔴' : risk.riskLevel === 'medium' ? '🟡' : '🟢';
      md += `| ${risk.requirementId} | ${emoji} ${risk.riskLevel} | ${risk.reason} |\n`;
    }
    md += '\n';
  }

  return md;
}
