import path from 'path';
import fs from 'fs-extra';

/**
 * Spec 解析器
 * 从 SpecCore 的 Spec 文件中提取测试相关信息（AC、用户故事、业务规则等）
 */

export interface ParsedRequirement {
  id: string;
  name: string;
  description: string;
  userStories: UserStory[];
  acceptanceCriteria: ACItem[];
  businessRules: string[];
  dataFields: DataField[];
  dependencies: string[];
}

export interface UserStory {
  role: string;
  action: string;
  goal: string;
}

export interface ACItem {
  id: string;
  description: string;
  scenario: 'happy' | 'error' | 'edge' | 'boundary';
  priority: 'high' | 'medium' | 'low';
}

export interface DataField {
  name: string;
  type: string;
  required: boolean;
  constraints: string[];
}

/**
 * 从 SpecCore 期次目录中读取所有需求
 */
export function readIterationRequirements(projectRoot: string, iteration: string): ParsedRequirement[] {
  const iterationDir = path.join(projectRoot, `.speccore/iterations/${iteration}`);
  if (!fs.existsSync(iterationDir)) {
    // 尝试期次目录格式：期次-XXX
    const altDir = findIterationDir(projectRoot, iteration);
    if (!altDir) {
      console.warn(`期次 ${iteration} 不存在`);
      return [];
    }
    return readRequirementsFromDir(altDir);
  }

  return readRequirementsFromDir(iterationDir);
}

/**
 * 查找期次目录（支持多种命名格式）
 */
function findIterationDir(projectRoot: string, iteration: string): string | null {
  // 格式 1: 期次-2026-Q1
  const pattern1 = path.join(projectRoot, `期次-${iteration}`);
  if (fs.existsSync(pattern1)) return pattern1;

  // 格式 2: 直接扫描匹配
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.includes(iteration)) {
      return path.join(projectRoot, entry.name);
    }
  }

  return null;
}

/**
 * 从目录中读取所有 Task 的需求
 */
function readRequirementsFromDir(dir: string): ParsedRequirement[] {
  const requirements: ParsedRequirement[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('Task-')) continue;

    const taskDir = path.join(dir, entry.name);
    const reqFile = path.join(taskDir, 'TASK.md');

    if (fs.existsSync(reqFile)) {
      const content = fs.readFileSync(reqFile, 'utf-8');
      const parsed = parseTaskMarkdown(entry.name, content);
      if (parsed) {
        requirements.push(parsed);
      }
    }

    // 也检查 backend/REQ.md 和 frontend/REQ.md
    const backendReq = path.join(taskDir, 'backend', 'REQ.md');
    const frontendReq = path.join(taskDir, 'frontend', 'REQ.md');

    if (fs.existsSync(backendReq)) {
      const content = fs.readFileSync(backendReq, 'utf-8');
      const parsed = parseTaskMarkdown(`${entry.name}-backend`, content);
      if (parsed) requirements.push(parsed);
    }

    if (fs.existsSync(frontendReq)) {
      const content = fs.readFileSync(frontendReq, 'utf-8');
      const parsed = parseTaskMarkdown(`${entry.name}-frontend`, content);
      if (parsed) requirements.push(parsed);
    }
  }

  return requirements;
}

/**
 * 解析 TASK.md 内容
 */
function parseTaskMarkdown(id: string, content: string): ParsedRequirement | null {
  const requirement: ParsedRequirement = {
    id,
    name: extractTitle(content) || id,
    description: extractDescription(content),
    userStories: extractUserStories(content),
    acceptanceCriteria: extractAC(content),
    businessRules: extractBusinessRules(content),
    dataFields: extractDataFields(content),
    dependencies: extractDependencies(content),
  };

  if (!requirement.name && requirement.acceptanceCriteria.length === 0) {
    return null;
  }

  return requirement;
}

/**
 * 提取标题
 */
function extractTitle(content: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();

  const h2Match = content.match(/^##\s+(.+)$/m);
  if (h2Match) return h2Match[1].trim();

  return '';
}

/**
 * 提取需求描述
 */
function extractDescription(content: string): string {
  // 取第一个非标题段落
  const lines = content.split('\n');
  let foundTitle = false;
  const descLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('#') && !foundTitle) {
      foundTitle = true;
      continue;
    }
    if (foundTitle && line.trim() && !line.startsWith('#')) {
      descLines.push(line.trim());
    }
    if (descLines.length >= 3) break;
  }

  return descLines.join(' ');
}

/**
 * 提取用户故事
 * 识别格式：作为<角色>，我想要<功能>，以便<目标>
 */
function extractUserStories(content: string): UserStory[] {
  const stories: UserStory[] = [];
  const patterns = [
    /作为(.+?)，我(?:想要|希望|需要)(.+?)(?:，以便|，从而|，目的是)(.+?)(?:[。.]|$)/g,
    /As an?\s+(.+?),?\s*I (?:want|need|would like)\s+(.+?)(?:,?\s*so that|,?\s*in order to)\s+(.+?)(?:[.]|$)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      stories.push({
        role: match[1].trim(),
        action: match[2].trim(),
        goal: match[3].trim(),
      });
    }
  }

  return stories;
}

/**
 * 提取验收标准（AC）
 * 识别格式：
 * - ### 验收标准 / Acceptance Criteria
 * - [ ] AC-001: xxx
 * - - [ ] xxx
 */
function extractAC(content: string): ACItem[] {
  const acItems: ACItem[] = [];
  let inACSection = false;
  let acIndex = 0;

  const lines = content.split('\n');
  const acHeaderPatterns = [/验收标准/i, /Acceptance Criteria/i, /AC/i];

  for (const line of lines) {
    // 检测 AC 区域开始
    if (!inACSection && acHeaderPatterns.some(p => p.test(line))) {
      inACSection = true;
      continue;
    }

    // 检测 AC 区域结束（遇到下一个同级标题）
    if (inACSection && line.match(/^##\s/) && !acHeaderPatterns.some(p => p.test(line))) {
      inACSection = false;
      continue;
    }

    if (!inACSection) continue;

    // 提取 AC 条目
    const checkboxMatch = line.match(/^[-*]\s+\[([ xX])\]\s*(.+)/);
    if (checkboxMatch) {
      acIndex++;
      const desc = checkboxMatch[2].trim();
      acItems.push({
        id: `AC-${String(acIndex).padStart(3, '0')}`,
        description: desc,
        scenario: detectScenario(desc),
        priority: 'medium',
      });
      continue;
    }

    // 也匹配编号格式：AC-001: xxx
    const numberedMatch = line.match(/AC-(\d+)[：:]\s*(.+)/i);
    if (numberedMatch) {
      acItems.push({
        id: `AC-${numberedMatch[1].padStart(3, '0')}`,
        description: numberedMatch[2].trim(),
        scenario: detectScenario(numberedMatch[2]),
        priority: 'medium',
      });
    }
  }

  return acItems;
}

/**
 * 检测 AC 场景类型
 */
function detectScenario(desc: string): ACItem['scenario'] {
  const lower = desc.toLowerCase();
  if (/失败|错误|异常|error|fail|exception|invalid/i.test(lower)) return 'error';
  if (/边界|最大|最小|极限|boundary|max|min|limit/i.test(lower)) return 'boundary';
  if (/边缘|极端|特殊|edge|corner|rare/i.test(lower)) return 'edge';
  return 'happy';
}

/**
 * 提取业务规则
 */
function extractBusinessRules(content: string): string[] {
  const rules: string[] = [];
  const ruleSection = content.match(/业务规则|Business Rules?/i);

  if (ruleSection) {
    const startIdx = ruleSection.index!;
    const sectionContent = content.slice(startIdx);
    const lines = sectionContent.split('\n');

    for (const line of lines.slice(1)) {
      if (line.startsWith('#')) break;
      const trimmed = line.trim();
      if (trimmed && (trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+[\.)]/.test(trimmed))) {
        rules.push(trimmed.replace(/^[-*\d.)]\s*/, ''));
      }
    }
  }

  // 也匹配内联规则
  const inlineRules = content.match(/(?:必须|禁止|应当|不得|必须|必须|should|must|shall|must not)\s+.+?[。.]/g);
  if (inlineRules) {
    rules.push(...inlineRules.map(r => r.trim()));
  }

  return rules;
}

/**
 * 提取数据字段
 */
function extractDataFields(content: string): DataField[] {
  const fields: DataField[] = [];

  // 匹配表格中的字段定义
  const tablePattern = /\|(.+)\|(.+)\|(.+)\|(.+)\|/g;
  let match;
  while ((match = tablePattern.exec(content)) !== null) {
    const headers = match[0].split('|').map(h => h.trim()).filter(Boolean);
    if (headers.some(h => /字段|field|名称|name/i.test(h))) {
      // 找到表格，继续读取数据行
      break;
    }
  }

  return fields;
}

/**
 * 提取依赖关系
 */
function extractDependencies(content: string): string[] {
  const deps: string[] = [];
  const depMatch = content.match(/依赖|dependenc(?:y|ies)/i);

  if (depMatch) {
    const startIdx = depMatch.index!;
    const sectionContent = content.slice(startIdx);
    const lines = sectionContent.split('\n');

    for (const line of lines.slice(1)) {
      if (line.startsWith('#')) break;
      const trimmed = line.trim();
      if (trimmed && (trimmed.startsWith('-') || trimmed.startsWith('*'))) {
        const taskMatch = trimmed.match(/Task-\d+/i);
        if (taskMatch) deps.push(taskMatch[0]);
      }
    }
  }

  return deps;
}
