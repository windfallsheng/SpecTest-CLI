# SpecTest 架构设计

> Test by Spec, Not by Guess.
> 测试底座：以规格为唯一依据生成测试用例，用执行验证代码，用缺口验证规格。

## 1. 定位

SpecTest 是 Spec* 生态的测试底座，独立仓库、独立 CLI、独立发版。

- **规格的验证者**：不生产规格、不生产代码，只生产"证明"。
- **唯一依据**：整个流程唯一的 spec 规范源——SpecCore `020-specs/` 的 `TEST.md`（AC）、`API_CONTRACT.yaml`、`TECH.md`、`SCHEMA.md`、`UI_SPEC.md`。
- **双面验证**：验证代码（用例执行）＋ 验证规格本身（覆盖缺口、规格缺陷反馈）。

## 2. 三道闸与数据边界

```
闸 1: SpecProt freeze  → SpecCore unitize          （需求定稿才开发）
闸 2: SpecCore TEST.md → SpecTest init             （测试测规格，不测猜测）
闸 3: SpecTest gate    → SpecCore execute 门禁回流  （质量不达标不发布）
```

**数据边界（写主唯一）**：

| 目录 | 写主 | SpecTest 权限 |
|:---|:---|:---|
| `010-requirements/` | SpecProt | 不碰 |
| `020-specs/` | SpecCore | 只读（全量） |
| `030-tasks/_shared/API_CONTRACT.yaml` | SpecCore | 只读（仅共享契约，不读 TASK.md） |
| `.spectest/` | SpecTest | 读写 |

**四条不越线**：不碰 010-requirements 与 030-tasks 执行细节；AC 缺失报"规格缺口"不脑补；不内置测试运行时；不越权改规格（规格缺陷只反馈，修订权在 SpecProt）。

## 3. 能力、产出、边界

**能力七件事**：读规格 / 生成用例 / 追溯管理 / 覆盖分析 / 执行调度 / 质量门禁 / 度量与复用。

**产出**：测试套件、追溯矩阵、缺口报告、影响报告、回归清单、执行结果、门禁结论、缺陷记录（代码/规格双类）、测试报告、趋势基线、公共用例库。

**边界**：执行力止于"契约面"（契约测试断言规格，内置执行）；"实现面"（业务逻辑测试断言实现）通过宿主框架调度。

## 4. 目录组织：端优先 + 全量层用例库

```
.spectest/
├── config.yaml                  # 标准体系：门禁阈值/阶段定义/端级检查项
├── local/context.json           # 上下文（当前期次/最近动作）
├── environments/{env}.yaml      # 环境配置（baseUrl/auth/数据清理策略）
├── fixtures/                    # 测试数据
├── templates/                   # 端专属 prompt 模板（AI 接力注入）
├── reports/                     # 测试报告落盘
├── plans/                       # 测试计划（plan 产出）
├── bugs/                        # 缺陷（代码/规格双类，bug 命令）
├── GLOBAL/cases/                # ★ 全量层：用例资产唯一居住地（跨期次复用，不随期次归档）
│   └── {端名}/                  # 第一维：端（h5/app/admin/backend/miniapp）
│       └── {功能单元}/           # 第二维：功能单元
│           └── suites/TS-{端}-{单元}-{类型}/   # 第三维：类型
│               ├── SUITE.yaml   # 套件元信息（bornIteration 记录诞生期次）
│               ├── SCAFFOLD.md  # 骨架元信息（人类与续跑会话查阅）
│               └── cases/*.yaml # 用例资产（AI 接力落盘，apply 校验回写）
├── iterations/{期次}/           # ★ 迭代层：只留执行事实，不留用例资产
│   ├── {端名}/{功能单元}/matrix/trace.yaml   # 端×单元级矩阵（事实落点）
│   ├── matrix/index.yaml        # 总索引（CLI 幂等重建，禁止手写）
│   └── matrix/runs/RUN-*.json   # 执行记录
├── archive/                     # 归档快照（随附 GLOBAL-cases 用例副本，自洽）
└── trend/                       # 跨期次趋势基线
```

**双层语义**：用例资产（测什么）住全量层 GLOBAL/cases，期次不复刻、Q2 回归照跑 Q1 用例；执行事实（测得怎么样）按期次落 matrix，Q2 记 Q2 自己的账。gen 增量三态保证资产不重复：已有用例且规格未变 → 复用不重建；规格变化 → 增量补充；新单元 → 全量预建。旧迭代层 suites 由 migrateLegacySuites 幂等迁移（move，双份时旧目录备份 .legacy-*）。

与 `020-specs/{功能单元}/{端名}/` 维度转置，spec-reader 建"功能单元 × 端"扫描索引桥接。

## 5. 灵魂：AC↔用例双向追溯矩阵

一切查询的唯一事实源。每条用例回答"我为哪条 AC 作证"，每条 AC 能查到"谁在证明我"。

- `gap` = 查无 cases 的 AC（规格缺口 vs 覆盖缺口区分）
- `impact` = 变更 diff 命中的 AC → 反查失证用例
- `regress` = 失证清单 + 依赖关联用例集
- 判定逻辑收敛在 `predicates.ts` 单一文件（共享谓词铁律）

**用例 ID 锚定 AC**：`TS-{端}-{单元}-{类型}-{AC编号}`——天然幂等、天然可追溯，AC 变更自动成为 impact 触发点。

## 6. 三层执行链

```
spectest run
├── static-verify   文档静态验证（内置，零成本）——gate 第一道闸
├── contract-run    契约执行（内置 HTTP + zod 断言，不依赖宿主代码）
└── framework-run   业务测试调度（宿主框架 vitest/jest/pytest/playwright）
```

- **契约执行器**：解析契约 → 组装 HTTP 请求 → 状态码/zod schema 断言 → 结果回填矩阵。启动时做契约完整性检查，response schema 缺失报"契约缺口"。
- **业务调度**：框架探测 → 命令组装 → 结果解析 → 按 `@case` 标记回填矩阵；失败自动留存截图/证据。
- **结果统一归一**：三层执行同一结果格式（caseId/pass/fail/耗时/输出），gate 只认这一种事实。
- **执行顺序**：先轻后重，失败即停。

## 7. 专业流程五维

| 维度 | 设计 |
|:---|:---|
| **流程** | 九环生命周期：理解 → 计划 → 设计 → 准备 → 执行 → 缺陷 → 回归 → 评估 → 归档 |
| **标准** | 用例质量标准（四段齐全+四象限+端级专项，CLI 校验）+ 门禁阈值（config）+ 缺陷分级 |
| **场景** | 功能四象限（happy/error/edge/boundary）+ 非功能线（perf/security 轻量起步） |
| **阶段** | 测试层级（unit/integration/system/acceptance）× 发布时机（dev/pr/sit/deploy/uat/release）正交融合 |
| **环境** | 环境分级（dev 全量/staging 冒烟+回归/prod 仅冒烟）+ 健康预检 |

**SIT**（技术集成视角，高度自动化）：跨端联调用例 + 契约执行器全量跑 + 独立 sit 环境——以 `--env` 环境矩阵 + 契约执行器落地。
**UAT**（业务验收视角，半自动化）：⚠️ **设计待实装**（见 §11 路线图 Step 8）——生成验收剧本 + AC 勾选清单 + 人工执行签字。UAT 缺陷多是规格缺陷，走规格缺陷反馈通道回流 SpecProt。UAT sign-off 是 release 前置条件（闸 3 扩展）。

## 8. 流水线：三层链 + 双模式（已实装）

`spectest run` 就是流水线执行器（与 speccore run 同构）：三层链「静态验证 → 契约执行 → 宿主框架」，先轻后重、失败即停。缺省期次 = 全量回归（跨期次逐期推进三层链，用例资产全量层、事实按期次回填）。

- **全自动模式**：层间不停；未接入宿主框架不算绿（防假绿，三层链只跑两层时如实报非零）。
- **人机交互模式**（`--interactive` 或 `config.pipeline.interactive`）：每层确认后推进。
- **机制**：状态快照 `[SPECTEST_STEP_DONE]` + `--resume` 断点续跑 + `[SPECTEST_EXEC]` 接力标记 + 单会话步骤隔离。

> ⚠️ 预设流水线（test-dev/test-sit/test-uat/test-release）与三态开关（auto/on/off）**设计待实装**，见 §11 路线图 Step 8。

## 9. 端级针对性 + Agent 角色

**三层定制**：端专属 zod schema（backend: transactionBoundary/idempotency/concurrency；h5: selector/viewport/stateFlow；miniapp: lifecycle/platform；app: deviceMatrix/network）+ 端专属 prompt 模板 + 端专属检查清单（CLI 校验打回）。

**Agent 角色**（`.spectest/AGENTS/`，接力时注入）：⚠️ **设计待实装**（见 §11 路线图 Step 8）——test-designer、api-test-specialist、e2e-test-specialist、test-data-architect、performance-test-analyst、security-test-reviewer、test-reviewer。

**前端 E2E**：从 UI_SPEC 装配元素标识（extractElementTestIds，移植 v8.3.291 冒烟装配链）+ 状态图场景路径 → 用例骨架。UI_SPEC 缺元素标识报"元素标识缺口"，不脑补选择器。

## 10. 六条铁律

1. CLI 管确定性，AI 管生成（骨架预建 → AI 覆盖 → CLI 校验回写）。
2. AI 接力协议（exitCode 10 + prompt 标记 + apply 回写）。
3. 多消费点共享谓词（同一判定多处消费必须同一函数）。
4. 幂等写入 + 因果链落点（报告依赖 AI 产物，落点必须在接力回写之后）。
5. 三态开关（auto/on/off）。
6. 意图识别真相：词典匹配为主，LLM 兜底为占位符（第二阶段引入，移植 SpecProt 词典引擎）。

**骨架完成度门卫**：summary/report 出报告前检查骨架无空洞，有空洞拒绝出报告。
**版本锚**：gen 双产物（规格 + 代码骨架）标注"源 TS-xxx · 版本 vN"，run 前校验一致，不一致报"骨架过期，请重新 gen"。

## 11. 重构路线图

```
Step 1  地基     context 数据层 + spec-reader 对齐真实结构 + 幂等 ID（AC 锚定）
Step 2  灵魂     trace-matrix（事实落点 + CLI 重建索引）+ zod schemas 端专属化
Step 3  生成     gen/api 重构：骨架预建 + AI 接力 + 端专属模板 + 双产物版本锚
Step 4  分析     predicates 共享谓词收敛 gap/impact/regress
Step 5  执行     三层执行链：verify + contract-runner + framework-run
Step 6  门禁流水  gate 四元组（AC覆盖率/通过率/缺陷数 + 代码覆盖率可选）+ config + pipeline 双模式
Step 7  度量反馈  report/summary/trend/archive（骨架门卫）+ bug 双类 + UAT 签字
```

**现有代码三分类**：保留（context 数据层、zod schemas、api-test-generator 契约解析、logger、i18n）；重构（spec-reader 坐标、gen 纯确定性生成、时间戳 ID）；新增（trace-matrix、predicates、skeleton-builder、contract-runner、pipeline）。渐进替换，不搞大爆炸。

```
Step 8  补缺     --spec-dir 独立输入通道（gen 自备规格目录）
                 miniapp 端专属 prompt 模板
                 init 自动生成环境模板（environments/{env}.yaml）
                 动态 token 链（登录→提取→注入后续请求）
                 预设流水线 test-dev/sit/uat/release + 三态开关 auto/on/off
                 UAT 验收剧本 + 签字 sign-off（闸 3 扩展）
                 Agent 角色体系（.spectest/AGENTS/ 七角色，接力注入）
                 UI 冒烟统一入口（框架层 P0 切片）
                 性能/安全类型执行节点（生成支持、执行靠宿主调度）
```
