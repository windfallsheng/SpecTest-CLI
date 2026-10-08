import path from 'path';
import fs from 'fs-extra';

/**
 * Spec 解析器 —— SpecTest 的闸 2 咬合点
 *
 * 读取 SpecCore 020-specs/ 的真实结构：
 *   Iteration-NNN-name/020-specs/{功能单元}/{端名}/TEST.md
 *
 * 与 .spectest/ 的端优先目录维度转置，本模块建立"功能单元 × 端"扫描索引桥接。
 * 纪律：AC 缺失报"规格缺口"，空骨架（SPEC-SKELETON）报"规格缺口"，禁止 AI 脑补。
 */

// ============================================================
// 类型定义
// ============================================================

export interface ACItem {
  /** 规格里的原始编号（normalize 为 AC-001 三位） */
  id: string;
  /** 原始行文本 */
  raw: string;
  /** AC 描述（去掉编号与 checkbox） */
  description: string;
  scenario: 'happy' | 'error' | 'edge' | 'boundary';
  priority: 'high' | 'medium' | 'low';
}

export interface PlatformSpec {
  /** 标准端名（来自 020-specs 目录名） */
  platform: string;
  /** 功能单元名 */
  unitName: string;
  /** ASCII slug（用于幂等 ID） */
  unitSlug: string;
  /** 五份文档路径（存在才非空） */
  testMdPath: string | null;
  techMdPath: string | null;
  schemaMdPath: string | null;
  uiSpecPath: string | null;
  /** 解析出的 AC 列表 */
  acs: ACItem[];
  /** 是否空骨架（SPEC-SKELETON 残留） */
  isSkeleton: boolean;
}

export interface SpecIndex {
  iteration: string;
  iterationDir: string;
  specsDir: string;
  /** 平铺的"功能单元 × 端"列表 */
  entries: PlatformSpec[];
}

/** 扫描时被跳过的非单元目录 */
const SKIP_DIRS = new Set(['overview', 'requirements']);

// ============================================================
// 迭代目录定位（真实坐标）
// ============================================================

/**
 * 定位 SpecCore 迭代目录：项目根/Iteration-NNN-name/
 * 匹配顺序：精确名 → Iteration- 前缀候选（含 020-specs 才算数）
 */
export function findIterationDir(projectRoot: string, iteration: string): string | null {
  const exact = path.join(projectRoot, iteration);
  if (fs.existsSync(path.join(exact, '020-specs'))) return exact;

  if (!fs.existsSync(projectRoot)) return null;
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  const candidates = entries.filter(
    (e) => e.isDirectory() && e.name.startsWith('Iteration-')
  );

  for (const c of candidates) {
    const full = path.join(projectRoot, c.name);
    if (!fs.existsSync(path.join(full, '020-specs'))) continue;
    const tail = c.name.replace(/^Iteration-\d+-/, '').toLowerCase();
    const needle = iteration.toLowerCase();
    if (c.name === iteration || c.name.includes(iteration) || tail.includes(needle) || needle.includes(tail)) {
      return full;
    }
  }
  return null;
}

// ============================================================
// 扫描索引：功能单元 × 端
// ============================================================

export function scanSpecIndex(projectRoot: string, iteration: string): SpecIndex {
  const iterationDir = findIterationDir(projectRoot, iteration);
  if (!iterationDir) {
    throw new Error(`期次 ${iteration} 不存在。请在 SpecCore 项目中确认迭代目录（Iteration-NNN-xxx/）。`);
  }

  const specsDir = path.join(iterationDir, '020-specs');
  if (!fs.existsSync(specsDir)) {
    throw new Error(`期次 ${iteration} 缺少 020-specs/ 目录，规格尚未生成。`);
  }

  const entries: PlatformSpec[] = [];
  const unitDirs = fs.readdirSync(specsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name));

  for (const unit of unitDirs) {
    const unitDir = path.join(specsDir, unit.name);
    const platformDirs = fs.readdirSync(unitDir, { withFileTypes: true })
      .filter((e) => e.isDirectory());

    for (const p of platformDirs) {
      entries.push(readPlatformSpec(unit.name, p.name, unitDir));
    }
  }

  return { iteration, iterationDir, specsDir, entries };
}

function readPlatformSpec(unitName: string, platform: string, unitDir: string): PlatformSpec {
  const pDir = path.join(unitDir, platform);
  const testMdPath = path.join(pDir, 'TEST.md');

  const spec: PlatformSpec = {
    platform,
    unitName,
    unitSlug: slugify(unitName),
    testMdPath: fs.existsSync(testMdPath) ? testMdPath : null,
    techMdPath: existsOrNull(pDir, 'TECH.md'),
    schemaMdPath: existsOrNull(pDir, 'SCHEMA.md'),
    uiSpecPath: existsOrNull(pDir, 'UI_SPEC.md'),
    acs: [],
    isSkeleton: false,
  };

  if (!spec.testMdPath) {
    // TEST.md 缺失 = 规格缺口（该端无测试规格）
    spec.isSkeleton = true;
    return spec;
  }

  const content = fs.readFileSync(testMdPath, 'utf-8');

  // 骨架判定：SPEC-SKELETON 标记 → 骨架；否则以"能否解析出 AC"为准
  if (isSkeletonContent(content)) {
    spec.isSkeleton = true;
    return spec;
  }

  spec.acs = extractAC(content);
  // AC 解析为空 = 无验收标准可锚 = 规格缺口
  if (spec.acs.length === 0) {
    spec.isSkeleton = true;
  }
  return spec;
}

function existsOrNull(dir: string, name: string): string | null {
  const p = path.join(dir, name);
  return fs.existsSync(p) ? p : null;
}

/**
 * 空骨架判定：SPEC-SKELETON 标记或内容过短
 */
function isSkeletonContent(content: string): boolean {
  // 仅凭标记判定骨架；无标记的短文档交由 AC 解析判定（有 AC 即有效规格）
  return content.includes('<!-- SPEC-SKELETON -->');
}

// ============================================================
// AC 解析（兼容 SpecCore 双格式）
// ============================================================

/**
 * 兼容格式：
 *   1. `- [ ] AC-1: 描述` / `- [x] AC-1: 描述`（checkbox）
 *   2. `- **AC-01**：当...时，系统应...`（加粗编号，reverse-requirement 格式）
 *   3. `AC-1: 描述`（裸编号）
 */
export function extractAC(content: string): ACItem[] {
  const acs: ACItem[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const m = matchACLine(line);
    if (!m) continue;
    acs.push({
      id: normalizeACId(m.id),
      raw: line.trim(),
      description: m.desc,
      scenario: detectScenario(m.desc),
      priority: detectPriority(m.desc),
    });
  }

  // 去重（同一 AC 编号只取首条，规格里不应重复但防御）
  const seen = new Set<string>();
  return acs.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

function matchACLine(line: string): { id: string; desc: string } | null {
  const t = line.trim();
  if (!t) return null;

  // 格式 1/2：checkbox + 编号
  let m = t.match(/^[-*]\s+\[[ xX]\]\s*AC-(\d+)[：:]\s*(.+)$/i);
  if (m) return { id: m[1], desc: m[2].trim() };

  // 格式 3：加粗编号 **AC-01**：
  m = t.match(/^[-*]\s*\*\*AC-(\d+)\*\*[：:]\s*(.+)$/i);
  if (m) return { id: m[1], desc: m[2].trim() };

  // 格式 4：裸编号 AC-1:
  m = t.match(/^AC-(\d+)[：:]\s*(.+)$/i);
  if (m) return { id: m[1], desc: m[2].trim() };

  return null;
}

/** 归一化 AC-1/AC-01 → AC-001 */
export function normalizeACId(id: string): string {
  return `AC-${String(parseInt(id, 10)).padStart(3, '0')}`;
}

/** 场景四象限检测 */
function detectScenario(desc: string): ACItem['scenario'] {
  const lower = desc.toLowerCase();
  // boundary（词更具体）优先于 error（词更宽泛）
  if (/边界|最大|最小|极限|超长|边界值|boundary|max|min|limit|exceed/i.test(lower)) return 'boundary';
  if (/失败|错误|异常|拒绝|error|fail|exception|invalid|unexpected/i.test(lower)) return 'error';
  if (/边缘|极端|特殊|罕见|并发|并发下|edge|corner|rare|concurrent/i.test(lower)) return 'edge';
  return 'happy';
}

/** 优先级：高优词 → high，默认 medium */
function detectPriority(desc: string): ACItem['priority'] {
  if (/必须|关键|核心|安全|资金|支付|must|critical|money|payment/i.test(desc)) return 'high';
  if (/可选|建议|最好|should|nice/i.test(desc)) return 'low';
  return 'medium';
}

// ============================================================
// 幂等 ID（锚定 AC，禁止时间戳）
// ============================================================

/**
 * 套件 ID：TS-{端}-{单元slug}-{类型}（重跑覆盖不新增）
 */
export function buildSuiteId(platform: string, unitSlug: string, testType: string): string {
  return `TS-${platform}-${unitSlug}-${testType}`;
}

/**
 * 用例 ID：TS-{端}-{单元}-{类型}-{AC编号}（锚定 AC，天然可追溯）
 */
export function buildCaseId(platform: string, unitSlug: string, testType: string, acId: string): string {
  return `TS-${platform}-${unitSlug}-${testType}-${acId}`;
}

/**
 * API 用例 ID：TS-{端}-{单元}-api-EP-{端点编号}（契约面锚端点，不锚 AC）
 */
export function buildApiCaseId(platform: string, unitSlug: string, endpointIndex: number): string {
  return `TS-${platform}-${unitSlug}-api-EP-${String(endpointIndex).padStart(3, '0')}`;
}

/**
 * 稳定 ASCII slug：
 * - 目录名本身 ASCII 兼容 → 直接清洗使用
 * - 中文目录名 → 稳定 hash（同名字恒同值，跨机器稳定）
 */
export function slugify(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii.length >= 3) return ascii.slice(0, 24);

  let h = 0;
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0;
    h = (h * 31 + cp) % 999983; // 稳定多项式 hash
  }
  return `u${h.toString(36)}`;
}
