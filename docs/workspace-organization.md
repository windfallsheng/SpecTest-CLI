# 目录组织

> `.spectest/` 测试领地怎么布局、每样东西住哪里、为什么这么分。

## 总览

```
.spectest/
├── config.yaml                  # 门禁阈值等标准配置
├── local/context.json           # 上下文（当前期次/最近动作）
├── environments/{env}.yaml      # 环境配置（baseUrl/auth/数据清理策略）
├── fixtures/                    # 测试数据
├── templates/                   # 端专属 prompt 模板（AI 接力注入）
├── reports/                     # 测试报告落盘
├── plans/                       # 测试计划（plan 产出）
├── bugs/                        # 缺陷（代码/规格双类，bug 命令）
├── GLOBAL/cases/                # ★ 全量层：用例资产唯一居住地
├── iterations/{期次}/           # ★ 迭代层：执行事实
├── archive/                     # 归档快照
└── trend/                       # 跨期次趋势基线
```

## 核心：双层资产语义

SpecTest 把测试数据分成两类，各住各的家：

| | 全量层 | 迭代层 |
|:---|:---|:---|
| 路径 | `GLOBAL/cases/` | `iterations/{期次}/` |
| 语义 | **用例资产**——测什么 | **执行事实**——测得怎么样 |
| 生命周期 | 项目级长期居住 | 随期次走 |
| 谁写 | `gen` 骨架预建 + AI 接力落盘 | `run`/`gate` 执行后回填 |

**为什么这么分**：老功能的用例不会因为新期次开始而消失——Q2 不改预订功能，Q2 回归照样要跑预订的用例。如果用例按期次存放，Q1 归档后 Q2 就"失守"了；如果执行结果放全量层，期次之间的账就混了。所以：**资产永久住全量层，事实按期次记账**。

## 全量层细节

```
GLOBAL/cases/
└── {端名}/                        # 第一维：端（h5-mobile/admin-web/booking-service/…）
    └── {功能单元}/                 # 第二维：功能单元（booking/user/…）
        └── suites/                # 第三维：套件类型
            └── TS-{端}-{单元}-{类型}/
                ├── SUITE.yaml     # 套件元信息
                │   ├── id / name / platform / unit / type
                │   ├── bornIteration   ← 诞生期次（资产溯源）
                │   ├── iteration       ← 最近一次预建/回写的期次
                │   ├── testCaseIds     ← 已登记用例（apply 回填）
                │   └── specSource      ← 规格版本锚（contentHash 比对此增量判定）
                ├── SCAFFOLD.md    # 骨架元信息（人类与续跑会话查阅）
                └── cases/
                    └── TS-{端}-{单元}-{类型}-AC-{编号}.yaml   # 用例资产
```

- **用例 ID 锚定 AC**：`TS-{端}-{单元}-{类型}-AC-{编号}`，禁止时间戳 ID——同一 AC 的用例跨期次永不变名。
- **gen 增量三态**：
  1. 已有用例 + 规格版本锚未变 → **复用**，GLOBAL 资产一字不动
  2. 规格版本锚变化 → **增量补充**（接力清单标注"AC 已变化"）
  3. 新套件 → **全量预建** + 接力

## 迭代层细节

```
iterations/{期次}/
├── {端名}/{功能单元}/
│   └── matrix/trace.yaml         # 端×单元级追溯矩阵
│       ├── traces: AC 清单（acId/描述/场景/优先级）
│       ├── cases: 用例执行状态（caseId/status/lastRun/lastResult）
│       └── caseIds: AC ↔ 用例双向覆盖事实
├── matrix/
│   ├── index.yaml                # 总索引（CLI 幂等重建，禁止手写）
│   └── runs/RUN-*.json           # 执行记录（结构化事实）
```

- 矩阵是**判定收敛的单一事实源**：gap（覆盖缺口）、impact（影响范围）、gate（覆盖率/通过率）全部读矩阵，不各算各的。
- 旧版本曾把 suites 放在迭代层，现由 `migrateLegacySuites` 幂等迁移到全量层（move；两边都有时旧目录备份为 `.legacy-*`，不丢数据）。

## 准全局资产（配置性扁平目录）

| 目录 | 用途 |
|:---|:---|
| `environments/{env}.yaml` | 契约执行环境（baseUrl/auth/清理策略），跨期次共用 |
| `templates/` | 端专属用例模板与 AI 接力 prompt，跨期次共用 |
| `config.yaml` | 门禁阈值、流水线三态开关等标准配置 |
| `fixtures/` | 测试数据 |

## 归档与趋势

- **archive**：`spectest archive -i Q1` 把期次事实快照归档，**随附涉及单元的全量层用例副本**（`GLOBAL-cases/`）——归档自洽，日后翻看无需依赖活资产。
- **trend**：跨期次对比由 `trend` 动态计算（通过率走势、覆盖率成长），无需落盘全局汇总——趋势是算出来的，不是存出来的。

## 与其他目录的关系

| 目录 | 归属 | SpecTest 权限 |
|:---|:---|:---|
| `010-requirements/` | SpecProt | 不碰 |
| `020-specs/{功能单元}/{端名}/` | SpecCore | 只读（spec-reader 扫描索引的输入） |
| `030-tasks/_shared/API_CONTRACT.yaml` | SpecCore | 只读（契约面用例的输入） |
| `.spectest/` | SpecTest | 读写（唯一领地） |

维度说明：SpecCore 的规格是"功能单元 → 端"，SpecTest 的用例是"端 → 功能单元 → 类型"——**维度转置**，spec-reader 建"功能单元 × 端"扫描索引桥接两种视图，两边各按各自的心智组织。
