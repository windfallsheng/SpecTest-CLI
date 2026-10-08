# AGENTS.md — SpecTest 项目规则

> 供 AI 编码工具自动读取。完整架构见 `ARCHITECTURE.md`。

## 核心定位

SpecTest 是 Spec* 生态的测试底座：**Test by Spec, Not by Guess**。
以 SpecCore `020-specs/` 的规格为唯一依据生成测试用例，用执行验证代码、用缺口验证规格。
不生产规格、不生产代码，只生产"证明"。

## 六条铁律

1. **CLI 管确定性，AI 管生成**——骨架预建 → AI 覆盖 → CLI 校验回写。core 层禁止 import 任何 AI SDK。
2. **AI 接力协议**——exitCode 10 + 自包含 prompt + `--apply` 回写断点续跑。
3. **多消费点共享谓词**——gap/impact/regress 判定逻辑必须收敛在 `predicates.ts` 单一文件。
4. **幂等写入 + 因果链落点**——用例 ID 锚定 AC（`TS-{端}-{单元}-{类型}-{AC编号}`），禁止时间戳 ID；报告依赖 AI 产物时落点必须在接力回写之后。
5. **三态开关**——流水线节点 auto/on/off 可配置。
6. **意图识别真相**——词典匹配为主，LLM 兜底为占位符（第二阶段移植 SpecProt 词典引擎）。

## 数据边界（写主唯一）

| 目录 | 权限 |
|:---|:---|
| `010-requirements/` | 不碰（SpecProt 领地） |
| `020-specs/` | 只读全量 |
| `030-tasks/_shared/API_CONTRACT.yaml` | 只读（仅共享契约） |
| `.spectest/` | 读写 |

**报缺不脑补**：AC 缺失报"规格缺口"、契约 response schema 缺失报"契约缺口"、UI_SPEC 元素标识缺失报"元素标识缺口"、跨端流程无据报"跨端流程缺口"——一律报缺退回，禁止 AI 凭空补。

## 目录组织（端优先 + 全量层用例库）

```
.spectest/
├── GLOBAL/cases/{端名}/{功能单元}/suites/TS-{端}-{单元}-{类型}/   # ★ 用例资产唯一居住地
├── iterations/{期次}/{端名}/{功能单元}/matrix/trace.yaml          # 迭代层只留 matrix 事实
├── iterations/{期次}/matrix/index.yaml   # CLI 幂等重建，禁止手写
├── environments/{env}.yaml / fixtures/ / plans/ / bugs/ / archive/ / trend/
```

双层语义：用例资产（测什么）住全量层，期次不复刻；执行事实（测得怎么样）按期次落 matrix。gen 增量三态（复用/增量/全量）保证资产不重建，`migrateLegacySuites` 幂等迁移旧迭代层 suites。

## 三层执行链

- `static-verify` 内置静态验证（gate 第一道闸）
- `contract-run` 内置契约执行（HTTP + zod 断言，执行力止于契约面）
- `framework-run` 宿主框架调度（探测 vitest/jest/pytest/playwright，按 `@case` 回填矩阵）
- 三层结果统一归一为同一格式，先轻后重、失败即停。

## 开发纪律

- **渐进重构**：现有代码三分类——保留（context/schemas/契约解析/logger/i18n）、重构（spec-reader 坐标、gen 纯确定性生成、时间戳 ID）、新增（trace-matrix/predicates/skeleton-builder/contract-runner/pipeline）。
- **双产物版本锚**：gen 规格与代码骨架标注"源 TS-xxx · 版本 vN"，run 前校验一致。
- **骨架完成度门卫**：summary/report 出报告前检查骨架无空洞，有空洞拒绝出报告。
- **单会话步骤隔离**：pipeline 每节点完成输出 `[SPECTEST_STEP_DONE]`，新会话 `--resume` 续跑。
- **端名使用 SpecCore CONSTITUTION.md 标准端名**，禁止 api/web/backend 等简写混用。
