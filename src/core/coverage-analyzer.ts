import path from 'path';
import fs from 'fs-extra';
import { CoverageReport } from './schemas/index.js';
import { ParsedRequirement, readIterationRequirements } from './spec-reader.js';
import { getTestDir } from './context.js';

/**
 * 覆盖分析选项
 */
export interface CoverageAnalyzeOptions {
  projectRoot: string;
  iteration: string;
}

/**
 * 覆盖分析结果（扩展版）
 */
export interface CoverageAnalyzeResult {
  report: CoverageReport;
  uncovered: Array<{
    requirement: ParsedRequirement;
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
 * 对比 SpecCore 的 AC 和已生成的测试用例，检测覆盖缺口
 */
export function analyzeCoverage(options: CoverageAnalyzeOptions): CoverageAnalyzeResult {
  const { projectRoot, iteration } = options;

  // 1. 读取所有需求
  const requirements = readIterationRequirements(projectRoot, iteration);

  // 2. 读取已生成的测试用例
  const existingTests = loadExistingTests(projectRoot, iteration);

  // 3. 对比分析
  const uncovered: CoverageAnalyzeResult['uncovered'] = [];
  const risks: CoverageAnalyzeResult['risks'] = [];
  let totalAC = 0;
  let coveredAC = 0;

  for (const req of requirements) {
    totalAC += req.acceptanceCriteria.length;

    // 检查该需求是否有测试覆盖
    const coveredACForReq: string[] = [];
    const missingACForReq: string[] = [];
    const suggestedTests: string[] = [];

    for (const ac of req.acceptanceCriteria) {
      const isCovered = existingTests.some(tc => {
        return tc.requirementIds.includes(req.id) && tc.relatedAC.includes(ac.description);
      });

      if (isCovered) {
        coveredACForReq.push(ac.description);
        coveredAC++;
      } else {
        missingACForReq.push(ac.description);
        suggestedTests.push(generateSuggestion(req, ac));
      }
    }

    // 记录未覆盖项
    if (missingACForReq.length > 0) {
      uncovered.push({
        requirement: req,
        missingAC: missingACForReq,
        suggested: suggestedTests,
      });
    }

    // 风险评估
    const risk = assessRisk(req, missingACForReq.length, req.acceptanceCriteria.length);
    if (risk) {
      risks.push(risk);
    }
  }

  // 4. 构建报告
  const coverageRate = totalAC > 0 ? Math.round((coveredAC / totalAC) * 100) : 100;

  const report: CoverageReport = {
    id: `COV-${iteration}`,
    iteration,
    totalRequirements: requirements.length,
    coveredRequirements: requirements.filter(r => {
      return !uncovered.some(u => u.requirement.id === r.id);
    }).length,
    coverageRate,
    totalAC,
    coveredAC,
    gapItems: uncovered.map(u => ({
      requirementId: u.requirement.id,
      requirementName: u.requirement.name,
      missingAC: u.missingAC,
      suggestedTests: u.suggested,
    })),
    risks: risks.map(r => ({
      requirementId: r.requirementId,
      riskLevel: r.riskLevel,
      reason: r.reason,
    })),
    generatedAt: new Date().toISOString(),
  };

  return { report, uncovered, risks };
}

/**
 * 加载已有测试用例
 */
function loadExistingTests(projectRoot: string, iteration: string): TestCaseRef[] {
  const testDir = getTestDir(projectRoot, iteration);
  if (!fs.existsSync(testDir)) return [];

  const tests: TestCaseRef[] = [];
  const suiteDirs = fs.readdirSync(testDir, { withFileTypes: true });

  for (const dir of suiteDirs) {
    if (!dir.isDirectory()) continue;

    const casesDir = path.join(testDir, dir.name, 'cases');
    if (!fs.existsSync(casesDir)) continue;

    const caseFiles = fs.readdirSync(casesDir);
    for (const file of caseFiles) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      const casePath = path.join(casesDir, file);
      try {
        // 简单提取 ID、requirementIds 和 relatedAC
        const content = fs.readFileSync(casePath, 'utf-8');
        const id = extractYamlField(content, 'id');
        const reqIds = extractYamlListField(content, 'requirementIds');
        const relatedAC = extractYamlListField(content, 'relatedAC');

        tests.push({ id: id || file, requirementIds: reqIds, relatedAC });
      } catch {
        // 跳过解析失败的文件
      }
    }
  }

  return tests;
}

interface TestCaseRef {
  id: string;
  requirementIds: string[];
  relatedAC: string[];
}

/**
 * 简单提取 YAML 字段
 */
function extractYamlField(content: string, field: string): string | null {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)`, 'm'));
  return match ? match[1].trim() : null;
}

function extractYamlListField(content: string, field: string): string[] {
  const result: string[] = [];
  let inList = false;

  for (const line of content.split('\n')) {
    if (line.startsWith(`${field}:`)) {
      inList = true;
      continue;
    }
    if (inList && line.match(/^\s*-\s*(.+)/)) {
      result.push(line.replace(/^\s*-\s*/, '').trim());
    } else if (inList && line.trim() && !line.startsWith(' ')) {
      inList = false;
    }
  }

  return result;
}

/**
 * 生成覆盖建议
 */
function generateSuggestion(req: ParsedRequirement, ac: {
  description: string;
  scenario: string;
}): string {
  const scenarioMap: Record<string, string> = {
    happy: `编写正向测试：${ac.description}，验证核心流程正常`,
    error: `编写异常测试：${ac.description}，验证错误处理和回滚`,
    boundary: `编写边界测试：${ac.description}，验证边界值处理`,
    edge: `编写边缘测试：${ac.description}，验证极端场景`,
  };

  return scenarioMap[ac.scenario] || `编写测试：${ac.description}`;
}

/**
 * 风险评估
 */
function assessRisk(
  req: ParsedRequirement,
  missingCount: number,
  totalCount: number
): { requirementId: string; riskLevel: 'high' | 'medium' | 'low'; reason: string } | null {
  if (totalCount === 0) return null;

  const ratio = missingCount / totalCount;

  if (ratio >= 0.5) {
    return {
      requirementId: req.id,
      riskLevel: 'high',
      reason: `覆盖缺口 ${missingCount}/${totalCount} (${Math.round(ratio * 100)}%)，核心场景可能遗漏`,
    };
  }

  if (ratio >= 0.2) {
    return {
      requirementId: req.id,
      riskLevel: 'medium',
      reason: `覆盖缺口 ${missingCount}/${totalCount} (${Math.round(ratio * 100)}%)，建议补充`,
    };
  }

  if (missingCount > 0) {
    return {
      requirementId: req.id,
      riskLevel: 'low',
      reason: `少量场景未覆盖 (${missingCount}/${totalCount})`,
    };
  }

  return null;
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
 * 生成覆盖报告 Markdown
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
  md += `| 总需求数 | ${report.totalRequirements} |\n`;
  md += `| 已覆盖需求数 | ${report.coveredRequirements} |\n`;
  md += `| 总 AC 数 | ${report.totalAC} |\n`;
  md += `| 已覆盖 AC 数 | ${report.coveredAC} |\n`;
  md += `| 覆盖率 | ${report.coverageRate}% |\n\n`;

  // 覆盖率进度条
  const barLength = 20;
  const filled = Math.round((report.coverageRate / 100) * barLength);
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
  md += `\`\`\`\n${bar} ${report.coverageRate}%\n\`\`\`\n\n`;

  // 覆盖缺口
  if (uncovered.length > 0) {
    md += `## ⚠️ 覆盖缺口 (${uncovered.length} 项)\n\n`;

    for (const gap of uncovered) {
      md += `### ${gap.requirement.id}: ${gap.requirement.name}\n\n`;
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
  } else {
    md += `## ✅ 覆盖完整\n\n所有需求的验收标准均已有测试覆盖。\n\n`;
  }

  // 风险评估
  if (risks.length > 0) {
    md += `## 🔴 风险评估\n\n`;
    md += `| 需求 | 风险等级 | 原因 |\n`;
    md += `|------|----------|------|\n`;

    for (const risk of risks) {
      const emoji = risk.riskLevel === 'high' ? '🔴' : risk.riskLevel === 'medium' ? '🟡' : '🟢';
      md += `| ${risk.requirementId} | ${emoji} ${risk.riskLevel} | ${risk.reason} |\n`;
    }
    md += '\n';
  }

  return md;
}
