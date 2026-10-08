# 更新日志

## 0.3.3（2026-10-08）

- 负责人解析新增第三事实源：SpecCore 单元级声明（`010-requirements/features/{单元}/_matrix.md` owners 段 confirmed）——配合 SpecCore v8.3.302 负责人前置设计，gen 阶段即确定，不依赖 taskify 时序
- 解析优先级：030-tasks 任务 owner → 单元级声明 → STAFFING 方向唯一映射（报缺不脑补铁律不变）

## 0.3.2（2026-10-08）

- 新增 `export` 命令（别名 ex）：导出用例合集——功能单元多选 / 全量 / 按负责人过滤，md / yaml / json 三格式，落盘 `.spectest/exports/`
- 套件层负责人设计：SUITE.yaml 新增 `owner` 字段，与 SpecCore 人员体系对齐（STAFFING.md 平台方向 + 030-tasks 子任务 owner）；任务分配优先、方向唯一成员才确定、报缺不脑补
- gen 接力提示按负责人视角注入；report 新增「负责人分布」节（owner 分组汇总套件数 / 用例数 / 平均通过率）

## 0.3.1（2026-10-08）

- 新增 docs/workflow.md / workflow.en.md：《测试工作流全解》——面向测试人员的全流程详细手册（七阶段：init → gen 接力 → run 三层 → 环境矩阵 → gate 八项 → bug 闭环 → report/summary/trend），含完整端到端示例与高频问答
- README 文档导航与 quick-start 末尾同步指引新文档
- workflow 手册新增「测试方式全景」节：六类型 × 三层执行 × 场景形态 × 边界（冒烟/回归/矩阵/复跑/重试/视觉/覆盖体检等十种场景）
## 0.3.0（2026-09-29）

### 视觉回归与视觉模型审查

- gen 接力提示新增「视觉回归要求」：前端端（h5-mobile/admin-web/app/miniapp）UI 用例须同步产出 playwright 视觉回归测试（测试名携带幂等 caseId，像素级 `toHaveScreenshot` 断言，基线走 `--update-snapshots`）
- 新增 `visual-review` 命令（别名 vr）：视觉模型审查——基线确认 / 失败 diff 分析 / 语义断言，判定 PASS/FAIL/unknown，审查记录落盘迭代层 `matrix/visual/REVIEW-*.json`
- 新增 config `visual` 段（OpenAI 兼容协议）：`enabled`（缺省关）/ `baseUrl` / `apiKey`（支持 `${VAR}` 环境变量占位，密钥不落盘）/ `model`
- 边界哲学：像素比对由 playwright 完成（确定性计算）；「看图判断」经 OpenAI 兼容协议接外部视觉模型，未配置如实报缺、人工确认基线——不内置视觉模型

### 修复

- 接力提示与错误提示中命令名不一致（`spectest visual review` → `spectest visual-review`），统一为 CLI 实际注册的命令名
## 0.2.1（2026-09-29）

- 修复：`--version` 与欢迎横幅的版本号硬编码漂移（升版后仍显示 0.1.0），改为从 package.json 动态读取，发版只改一处

## 0.2.0（2026-09-29）

- 契约执行扩展四能力：`--priority`（high=P0 冒烟）、`--case`（用例级过滤）、`--retry`（失败重试抗 flaky）、`--env` 逗号分隔环境矩阵（SIT/UAT 对比回归）
- run/contract-run 均支持上述参数；环境矩阵单环境原子，某环境缺配置只跳过该环境
- 新增 CI 模板（templates/ci/：GitHub Actions + GitLab CI），含 P0 冒烟与 gate 门禁回流
- 修复文档错植：command-reference 的 regress 段参数表误贴 contract-run 参数

## 0.1.0（2026-09-29）

首个正式文档化版本。核心能力：

### 全量层用例库（GLOBAL/cases）

- 用例资产唯一居住地迁至全量层 `.spectest/GLOBAL/cases/`，跨期次复用；迭代层只留 matrix 执行事实
- **gen 增量三态**：已有用例且规格未变 → 复用不重建（GLOBAL 资产不动）；规格版本锚变化 → 增量补充；新单元 → 全量预建
- **run 无参 = 全量回归**：跨期次逐期推进三层链（不再 fallback 当前期次）
- **旧数据迁移**：迭代层 suites 幂等迁移至全量层（move；双份时旧目录备份 `.legacy-*`）
- archive 快照随附涉及单元的全量层用例副本（自洽归档）

### 测试流水线（run）

- run 定位收敛为流水线执行器：三层链 静态验证 → 契约执行 → 宿主框架，先轻后重、失败即停
- 防假绿语义：未接入宿主框架时如实报非零退出码
- 双模式：全自动 / --interactive 每层确认；--suite 透传层 3

### ask 自然语言入口

- 20 个意图族词典（trigger +25 / pattern +35 / priority 加成，70/45 双层置信度）
- 高置信度直接执行；缺参输出 `[SPECTEST_NEEDS_INFO]` 交互提示；CLI_CMD 映射保证标记命令可被宿主 AI 直接复现

### 文档体系

- README 中英重写：面向测试人员（非技术），5 分钟上手 + 白话核心概念 + FAQ
- docs/ 中英成对：quick-start / overview / command-reference / workspace-organization
- AGENTS.md / ARCHITECTURE.md 目录组织同步全量层形态

### 质量

- 115 个单元测试全绿；E2E 覆盖 gen 接力闭环、增量复用、跨期次全量回归、旧数据迁移
