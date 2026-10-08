import path from 'path';
import fs from 'fs-extra';
import type { SkeletonResult, PreparedSuite } from './suite-skeleton.js';

/**
 * AI 接力 prompt 组装 —— 铁律「AI 接力协议」
 *
 * 输出 `[SPECTEST_PROMPT]` 标记 + 完整生成指令，命令层设置 exitCode 10。
 * 端专属模板：src/templates/prompts/{端名}.md，未知端 fallback common.md。
 */

const PROMPTS_DIR = path.join(__dirname, '..', 'templates', 'prompts');

const SCENARIO_LABEL: Record<string, string> = {
  happy: '正向',
  error: '异常',
  edge: '边缘',
  boundary: '边界',
};

/** 前端端名单：这些端的 UI 用例需同步产出 playwright 视觉回归测试 */
const FRONTEND_PLATFORMS = new Set(['h5-mobile', 'admin-web', 'app', 'miniapp']);

/**
 * 生成接力 prompt（骨架 → 宿主 AI）
 */
export function buildGenRelayPrompt(
  projectRoot: string, iteration: string, result: SkeletonResult
): string {
  const lines: string[] = [];

  lines.push('[SPECTEST_PROMPT]');
  lines.push('');
  lines.push(`你是 SpecTest 测试用例生成专家，为期次「${iteration}」的骨架套件填充专业测试用例。`);
  lines.push('');

  // ── 规格缺口警示（报缺不脑补）──
  if (result.specGaps.length > 0) {
    lines.push('## ⚠️ 规格缺口（禁止为其脑补用例）');
    lines.push('');
    for (const g of result.specGaps) {
      lines.push(`- \`${g.platform}/${g.unit}\` — ${g.reason}`);
    }
    lines.push('');
  }

  // ── 骨架清单 ──
  lines.push(`## 骨架套件清单（${result.prepared.length} 个）`);
  lines.push('');
  for (const p of result.prepared) {
    const changedTag = p.acChanged ? '（⚠️ AC 已变化，需重新生成）' : '';
    lines.push(`- \`${p.suiteId}\` | ${p.platform} | ${p.unit} | AC×${p.acCount} | 已有用例×${p.existingCaseCount}${changedTag}`);
  }
  lines.push('');

  // ── 每个套件的 AC 清单 + 端专属要求 ──
  for (const p of result.prepared) {
    lines.push(...buildSuiteBlock(p, iteration));
  }

  // ── 通用输出契约 ──
  lines.push('## 输出契约');
  lines.push('');
  lines.push('1. 每个用例写入 `{suiteDir}/cases/{用例ID}.yaml`（YAML 格式，UTF-8）');
  lines.push('2. 用例 ID：`TS-{端}-{单元slug}-{类型}-{AC编号}`，必须锚定 AC（一个用例可关联多个 AC）');
  lines.push('3. 每条 AC 至少 1 条用例；happy/error/boundary/edge 四象限按 AC 场景全覆盖');
  lines.push('4. `relatedAC` 填 AC 编号列表（如 `["AC-001", "AC-003"]`），禁止填描述文本');
  lines.push('5. `steps` 四段齐全：前置准备 / 执行操作 / 数据构造 / 断言验证，每条含 action + expected');
  lines.push('6. 用例结构字段（必填）：id / name / type / status(draft) / priority / scenario / suiteId / relatedAC / preconditions / steps / tags / createdAt / updatedAt');
  lines.push('7. 端专属字段按各端模板要求填写（如 h5 填 selector/viewport，backend 填 idempotency/transactionBoundary）');
  lines.push('8. 前端端 UI 用例的视觉回归测试随用例同步生成（见各套件「视觉回归要求」节）');
  lines.push('9. 未配置视觉模型时，视觉回归仍生成并执行（像素比对由 playwright 完成），仅基线确认/失败分析需人工或 visual-review');
  lines.push('');
  lines.push(`## 完成后回写`);
  lines.push('');
  lines.push(`\`\`\`bash`);
  lines.push(`spectest gen -i ${iteration} --apply`);
  lines.push(`\`\`\``);
  lines.push('');
  lines.push(`apply 会 zod 校验 → 登记追溯矩阵 → 重建索引 → 报告骨架完成度（空 AC 继续接力补齐）。`);

  return lines.join('\n');
}

function buildSuiteBlock(p: PreparedSuite, iteration: string): string[] {
  const lines: string[] = [];
  lines.push(`## 套件 \`${p.suiteId}\``);
  lines.push('');
  lines.push(`- 端：\`${p.platform}\`　单元：\`${p.unit}\`　类型：\`${p.testType}\``);
  if (p.owner) {
    lines.push(`- 负责人：\`${p.owner}\`（源自 SpecCore 任务分配/STAFFING，请以该负责人视角设计用例）`);
  } else {
    lines.push('- 负责人：未登记（SpecCore 030-tasks owner / STAFFING.md 均未分配；生成后可在 SUITE.yaml 手动补 owner）');
  }
  lines.push(`- Spec 源：\`${p.specPath}\`（AC 全文以该文件为准，以下为解析摘要）`);
  lines.push(`- 输出目录：\`${p.suiteDir}/cases/\``);
  lines.push('');
  lines.push('### AC 清单');
  lines.push('');
  lines.push('| AC | 场景 | 优先级 | 描述 |');
  lines.push('| :--- | :--- | :--- | :--- |');
  for (const ac of p.acs) {
    const desc = ac.description.replace(/\|/g, '\\|').slice(0, 120);
    lines.push(`| ${ac.id} | ${SCENARIO_LABEL[ac.scenario] ?? ac.scenario} | ${ac.priority} | ${desc} |`);
  }
  lines.push('');

  // 端专属模板
  const platformPrompt = loadPlatformPrompt(p.platform);
  if (platformPrompt) {
    lines.push('### 端专属要求');
    lines.push('');
    lines.push(platformPrompt);
    lines.push('');
  }

  // 前端端 UI 用例：同步产出 playwright 视觉回归测试
  if (FRONTEND_PLATFORMS.has(p.platform)) {
    lines.push('### 视觉回归要求（前端端必做）');
    lines.push('');
    lines.push('UI 用例（e2e 类型）须同步产出 playwright 视觉回归测试：');
    lines.push('1. 写入宿主项目测试目录（如 `tests/e2e/`），测试名携带幂等 caseId（如 `test("TS-h5-mobile-booking-e2e-AC-001 预订页视觉回归", ...)`）');
    lines.push('2. 关键页面/组件用 `expect(page).toHaveScreenshot()` 做像素级视觉回归断言');
    lines.push('3. 首次执行用 `npx playwright test --update-snapshots` 生成基线截图（基线存测试旁 `*-snapshots/` 目录）');
    lines.push('4. 基线确认：用 `spectest visual-review -i ${iteration} --image <基线截图> --question "<该截图是否符合 UI_SPEC 的页面描述>"` 交由视觉模型确认（未配置模型时如实报缺，人工确认基线）');
    lines.push('');
  }
  return lines;
}

/**
 * 端专属模板：templates/prompts/{端名}.md → fallback common.md
 */
export function loadPlatformPrompt(platform: string): string {
  const candidates = [path.join(PROMPTS_DIR, `${platform}.md`), path.join(PROMPTS_DIR, 'common.md')];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        return fs.readFileSync(c, 'utf-8').trim();
      } catch {
        return '';
      }
    }
  }
  return '';
}
