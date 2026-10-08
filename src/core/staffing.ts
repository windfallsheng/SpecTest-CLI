import path from 'path';
import fs from 'fs-extra';

/**
 * 人员读取层 —— 铁律「人员单一事实源在 SpecCore，报缺不脑补」
 *
 * 负责人解析优先级（v0.3.3+: 新增单元级声明第三事实源）：
 * 1. 030-tasks 开发侧任务分配（feature == 功能单元 → {端}/{子任务}/.meta/owner）
 * 2. 单元级 owner 声明（010-requirements/features/{单元}/_matrix.md owners 段 confirmed）
 * 3. STAFFING.md 人员排期表（成员 → 平台方向，方向唯一成员才确定）
 * 都无 → undefined（SUITE.yaml owner 留空，不脑补）
 */

/** STAFFING.md 单行成员 */
export interface StaffingMember {
  name: string;
  /** 平台方向：后台 / 小程序 / Web / APP（可多个） */
  directions: string[];
}

/** 端名 → STAFFING 平台方向 */
const PLATFORM_DIRECTION: Record<string, string> = {
  'booking-service': '后台',
  'admin-web': 'Web',
  'h5-mobile': 'Web',
  app: 'APP',
  miniapp: '小程序',
};

/** 解析 STAFFING.md 人员表格（| 成员 | 平台方向 | 投入比例 |） */
export function loadStaffing(iterationDir: string): StaffingMember[] {
  const p = path.join(iterationDir, 'STAFFING.md');
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, 'utf-8');
  const members: StaffingMember[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/);
    if (!m) continue;
    const name = m[1].trim();
    if (!name || name === '成员' || name.startsWith(':---')) continue;
    const dirs = m[2].trim();
    members.push({
      name,
      directions: dirs ? dirs.split(/[,，、]/).map((d) => d.trim()).filter(Boolean) : [],
    });
  }
  return members;
}

/** 开发侧任务 owner：030-tasks 中 .meta/feature == 单元的 Task，其 {端}/ 子任务 .meta/owner */
export function resolveTaskOwner(
  iterationDir: string, unit: string, unitName: string, platform: string
): string | null {
  const tasksDir = path.join(iterationDir, '030-tasks');
  if (!fs.existsSync(tasksDir)) return null;
  for (const td of fs.readdirSync(tasksDir, { withFileTypes: true })) {
    if (!td.isDirectory()) continue;
    const featureFile = path.join(tasksDir, td.name, '.meta', 'feature');
    if (!fs.existsSync(featureFile)) continue;
    const feature = fs.readFileSync(featureFile, 'utf-8').trim();
    if (feature !== unit && feature !== unitName) continue;
    const platformDir = path.join(tasksDir, td.name, platform);
    if (!fs.existsSync(platformDir)) continue;
    for (const sd of fs.readdirSync(platformDir, { withFileTypes: true })) {
      if (!sd.isDirectory()) continue;
      const ownerFile = path.join(platformDir, sd.name, '.meta', 'owner');
      if (!fs.existsSync(ownerFile)) continue;
      const owner = fs.readFileSync(ownerFile, 'utf-8').trim();
      if (owner && owner !== '未分配') return owner;
    }
  }
  return null;
}

/** 综合解析套件负责人：任务 owner 优先，其次 STAFFING 方向唯一映射；否则 undefined */
export function resolveSuiteOwner(
  iterationDir: string, unit: string, unitName: string, platform: string
): string | undefined {
  const taskOwner = resolveTaskOwner(iterationDir, unit, unitName, platform);
  if (taskOwner) return taskOwner;

  // 第三事实源：SpecCore 单元级声明（_matrix.md owners 段 confirmed）
  const unitOwner = resolveUnitOwner(iterationDir, unit, unitName, platform);
  if (unitOwner) return unitOwner;

  const direction = PLATFORM_DIRECTION[platform];
  if (!direction) return undefined;
  const matched = loadStaffing(iterationDir).filter((m) => m.directions.includes(direction));
  // 方向唯一成员 → 确定；多人或无人 → 不脑补，留空待填
  return matched.length === 1 ? matched[0].name : undefined;
}


/**
 * 单元级 owner 声明（SpecCore v8.3.302+ 负责人前置设计）：
 * 读 010-requirements/features/{单元}/_matrix.md 的 owners 段，
 * 返回 platform 匹配且 status=confirmed 的负责人；无/仅 pending → undefined。
 */
export function resolveUnitOwner(
  iterationDir: string, unit: string, unitName: string, platform: string
): string | undefined {
  const featuresDir = path.join(iterationDir, '010-requirements', 'features');
  if (!fs.existsSync(featuresDir)) return undefined;
  for (const fd of fs.readdirSync(featuresDir, { withFileTypes: true })) {
    if (!fd.isDirectory()) continue;
    const hit = fd.name.includes(unit) || (unitName ? fd.name.includes(unitName) : false);
    if (!hit) continue;
    const matrixPath = path.join(featuresDir, fd.name, '_matrix.md');
    if (!fs.existsSync(matrixPath)) continue;
    const owner = parseConfirmedOwner(fs.readFileSync(matrixPath, 'utf-8'), platform);
    if (owner) return owner;
  }
  return undefined;
}

/** 解析 _matrix.md owners 段：- platform / name / status，返回 platform 匹配的 confirmed */
function parseConfirmedOwner(matrixContent: string, platform: string): string | undefined {
  const start = matrixContent.search(/^owners:/m);
  if (start < 0) return undefined;
  const tail = matrixContent.slice(start + 'owners:'.length);
  const nextKey = tail.search(/\n(?:feature|type|platforms|clarify|dependencies|apis)\s*:|\n#/);
  const end = nextKey >= 0 ? start + 'owners:'.length + nextKey : matrixContent.length;
  const m = [matrixContent.slice(start, end)];
  let curPlatform: string | undefined;
  let curName: string | undefined;
  let curStatus: string | undefined;
  for (const line of m[0].split('\n')) {
    const pm = line.match(/^\s*-\s*platform:\s*(\S+)/);
    if (pm) {
      if (curPlatform === platform && curStatus === 'confirmed' && curName) return curName;
      curPlatform = pm[1];
      curName = undefined;
      curStatus = undefined;
      continue;
    }
    const nm = line.match(/^\s*name:\s*(.+?)\s*$/);
    if (nm) curName = nm[1];
    const sm = line.match(/^\s*status:\s*(pending|confirmed)/);
    if (sm) curStatus = sm[1];
  }
  return curPlatform === platform && curStatus === 'confirmed' ? curName : undefined;
}
