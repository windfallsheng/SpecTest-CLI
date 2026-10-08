通用用例专业标准（所有端适用）：

1. **AC 全覆盖**：每条 AC 至少 1 条用例锚定；多 AC 联合场景可共用 1 条用例（relatedAC 列全）。
2. **四象限完备**：happy（正向主流程）/ error（异常与错误处理）/ boundary（边界值：最大、最小、临界、越界）/ edge（极端与并发）。
3. **前置条件可执行**：环境、数据、权限、依赖四类齐全，禁止"环境就绪"式空话。
4. **步骤四段结构**：前置准备 → 执行操作 → 数据构造 → 断言验证；每步 action/expected 明确可判定。
5. **断言可判定**：expected 含具体值或明确状态，禁止"正确""合理"等模糊词。
6. **测试数据可复现**：涉及输入值的用例用 testData 字段记录关键数据。
7. **优先级语义**：high=核心路径/资金安全，medium=常规场景，low=可选增强。
8. **tag 规范**：`[类型, 场景, 单元slug]`，如 `["unit", "happy", "yudingguanli"]`。

## 宿主框架测试名协议（framework-run 解析依赖）

AI 若需在宿主工程生成框架测试（vitest/jest/playwright/pytest），测试名**必须携带幂等 caseId**：

```
test('TS-h5-mobile-booking-unit-AC-001 预订成功', () => { ... })
it('TS-h5-mobile-booking-unit-AC-002 余额不足应拒绝', () => { ... })
```

`spectest run` 执行后按测试名中的 caseId 解析结果回填追溯矩阵，无 caseId 的测试如实计为「未识别」。
