import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { detectFramework, parseCaseOutcomes } from '../../src/core/framework-run';

/**
 * 宿主框架调度：框架探测 + 结果解析（纯函数层，无进程执行）
 */
describe('detectFramework 框架探测', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-fw-'));
  });

  afterEach(() => {
    fs.removeSync(root);
  });

  function writePkg(pkg: Record<string, unknown>): void {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg), 'utf-8');
  }

  it('vitest 依赖 → 探测为 vitest（verbose reporter）', () => {
    writePkg({ devDependencies: { vitest: '^2.0.0' } });
    const fw = detectFramework(root);
    expect(fw?.name).toBe('vitest');
    expect(fw?.args).toContain('--reporter=verbose');
  });

  it('playwright 依赖 → 探测为 playwright', () => {
    writePkg({ devDependencies: { '@playwright/test': '^1.45.0' } });
    const fw = detectFramework(root);
    expect(fw?.name).toBe('playwright');
  });

  it('无 package.json → null（未接入宿主框架如实报缺）', () => {
    expect(detectFramework(root)).toBeNull();
  });

  it('无测试框架依赖 → null（防假绿：三层链只跑前两层时如实报非零）', () => {
    writePkg({ dependencies: { lodash: '^4.0.0' } });
    expect(detectFramework(root)).toBeNull();
  });
});

describe('parseCaseOutcomes 结果解析', () => {
  it('verbose 输出：✓/✗/- 行解析为 passed/failed/skipped', () => {
    const output = [
      '✓ TS-h5-yudingguanli-unit-AC-001 用户正常下单 3ms',
      '✗ TS-h5-yudingguanli-unit-AC-002 库存不足 1ms',
      '- TS-h5-yudingguanli-unit-AC-003 跳过场景',
    ].join('\n');

    const map = parseCaseOutcomes(output);
    expect(map.get('TS-h5-yudingguanli-unit-AC-001')).toBe('passed');
    expect(map.get('TS-h5-yudingguanli-unit-AC-002')).toBe('failed');
    expect(map.get('TS-h5-yudingguanli-unit-AC-003')).toBe('skipped');
  });

  it('ANSI 颜色转义：剥离 ESC 序列后状态判定不失真', () => {
    const line = '\u001b[32m✓\u001b[0m TS-h5-yudingguanli-unit-AC-001 正常';
    const map = parseCaseOutcomes(line);
    expect(map.get('TS-h5-yudingguanli-unit-AC-001')).toBe('passed');
  });

  it('无 caseId 的行：不产生任何条目', () => {
    const map = parseCaseOutcomes('Tests  5 passed (5)\nDuration 100ms');
    expect(map.size).toBe(0);
  });
});
