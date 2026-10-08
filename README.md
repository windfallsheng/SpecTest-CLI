# SpecTest — Test by Spec, Not by Guess

> 让需求自己长出测试：AI 从规格自动生成用例，流水线替你执行，门禁替你守关。

SpecTest 是 Spec\* 生态的**测试底座**。它以 SpecCore 产出的一份份测试规格（`020-specs/` 的 TEST.md、验收标准 AC）为唯一依据，自动生成专业测试用例、自动执行、自动把关——测试人员不再从几百页 PRD 里"人肉提炼"用例，回归测试也不再依赖"我记得这里要测"。

**一句话**：把"要测什么"交给规格，把"怎么测"交给 AI，把"测得怎么样"交给机器。

---

## 为什么需要 SpecTest

传统测试的痛，SpecTest 逐一化解：

| 痛点 | SpecTest 的答案 |
|:---|:---|
| 用例靠人想，漏测靠命 | 用例**锚定验收标准（AC）**逐条生成，每条 AC 都有用例证明，覆盖缺口自动检出 |
| 需求变了，用例没人记得改 | 规格版本锚比对：AC 变化自动标记"增量补充"，旧资产不重建 |
| 回归靠记忆，老功能失守 | 用例资产住**全量层**，`run` 无参即全量回归，Q2 照跑 Q1 的用例 |
| 测没测完、能不能上线，说不清 | `gate` 质量门禁给硬结论：八项检查，不过就是不过 |
| 接口、页面、后端各测各的 | 三层执行链一次跑完：静态验证 → 契约执行 → 宿主框架 |

---

## 快速开始（5 分钟上手）

```bash
# 1. 安装（全局）
npm install -g spectest-cli   # 命令名仍是 spectest

# 2. 进入 SpecCore 项目，初始化测试底座
cd 你的项目
spectest init --iteration Q1

# 3. 从规格生成测试用例（CLI 预建骨架，AI 接力填充）
spectest gen --iteration Q1
#    → 输出 [SPECTEST_PROMPT]，宿主 AI 按提示写用例文件
spectest gen --iteration Q1 --apply   # 校验回写，登记追溯矩阵

# 4. 执行测试流水线
spectest run                # 无参 = 全量回归，跨期次逐期推进
spectest run -i Q1          # 或只跑某一期次
spectest run -i Q1 --priority high --env sit   # SIT 冒烟：只跑 P0 契约用例
spectest run -i Q1 --env sit,uat               # 环境矩阵：SIT/UAT 对比回归

# 5. 质量门禁（能不能上线的硬结论）
spectest gate --iteration Q1
```

> 💡 **不会写代码也能用**：所有命令都支持说人话——`spectest ask "跑一下测试"`、`spectest ask "质量门禁能不能放行"`，系统自动识别意图并执行。

---

## 核心概念（三分钟读懂）

### 三层执行链：先轻后重，失败即停

```
层 1  静态验证（零成本）
      └─ 规格骨架、AC 覆盖、用例完整性……先拦下低级问题
层 2  契约执行（内置真跑）
      └─ 接口长什么样是规格定的 → 真 HTTP 请求 + 断言，不依赖开发代码
层 3  宿主框架（调度执行）
      └─ 业务逻辑怎么算是代码写的 → 调度项目自带的 vitest/jest/pytest/playwright
```

**边界哲学**：断言规格的事 SpecTest 亲自做，断言实现的事借宿主框架之手做。三层结果归一为同一份记录，先轻后重，哪层失败停在哪层。

### 全量层与迭代层：资产与事实分家

| | 全量层 `GLOBAL/cases/` | 迭代层 `iterations/{期次}/` |
|:---|:---|:---|
| 装什么 | **用例资产**（测什么） | **执行事实**（测得怎么样） |
| 生命周期 | 项目级长期居住，跨期次复用 | 随期次走，Q2 记 Q2 自己的账 |
| 典型文件 | `SUITE.yaml`、`cases/*.yaml` | `matrix/trace.yaml`、`runs/RUN-*.json` |

用例像藏书进了永久书架，期次只记录"这次考得怎么样"。**Q1 建的功能，Q2 回归照样守得住**——`gen` 见到用例已存在且规格未变就复用不重建，规格变了才增量补充。

### AI 协作方式：接力协议

SpecTest 的分工纪律：**确定性的事 CLI 做，创造性的事 AI 做**。`gen` 时 CLI 扫描规格、预建骨架（SUITE.yaml + SCAFFOLD.md + 矩阵登记），然后输出接力提示（exitCode 10），宿主 AI 按提示写用例文件，最后 `--apply` 校验回写。每一步可断点续跑，不丢进度。

---

## 常用命令速查

| 命令 | 作用 | 一句话示例 |
|:---|:---|:---|
| `ask` | 说人话智能入口 | `spectest ask "跑一下测试"` |
| `init` | 初始化测试项目 | `spectest init --iteration Q1` |
| `plan` | 生成测试计划 | `spectest plan -i Q1 --goal "订单导出"` |
| `gen` | 从 AC 生成用例 | `spectest gen -i Q1 --type unit` |
| `api` | 从 API 契约生成接口测试 | `spectest api -i Q1` |
| `gap` | 检测覆盖缺口 | `spectest gap -i Q1` |
| `run` | 执行测试流水线 | `spectest run`（无参 = 全量回归） |
| `regress` | 变更后圈定回归范围 | `spectest regress --task Task-001` |
| `impact` | 分析变更影响 | `spectest impact --task Task-001` |
| `bug` | 记录/关闭/查看缺陷 | `spectest bug --case-id TS-xxx-AC-001 --title "金额精度丢失"` |
| `gate` | 质量门禁检查 | `spectest gate -i Q1` |
| `visual-review` | 视觉模型审查（可选） | `spectest visual-review -i Q1 --image base.png --question "符合 UI_SPEC 吗"` |
| `report` | 生成测试报告 | `spectest report -i Q1` |
| `summary` | 生成测试总结 | `spectest summary -i Q1` |
| `trend` | 跨迭代趋势分析 | `spectest trend` |
| `archive` | 期次数据归档 | `spectest archive -i Q1` |
| `status` | 查看测试状态 | `spectest status` |
| `config` | 查看/设置配置 | `spectest config set gate.coverageThreshold 85` |

> `spectest --help` 可随时查看完整清单；每个命令 `spectest <命令> --help` 有详细参数。

### 质量门禁（gate）检查什么

八项检查：Task 关联、覆盖率、规格完备性、执行完备性、通过率、P0 用例、规格漂移、未修复缺陷。有未关闭的缺陷（`bug` 记录）会直接拦截——**闭环修复后 `bug close` 关缺陷，gate 才放行**。

---

## 目录结构

```
.spectest/
├── config.yaml                  # 门禁阈值等配置
├── environments/{env}.yaml      # 环境配置（接口地址等）
├── GLOBAL/cases/                # ★ 用例资产唯一居住地（跨期次复用）
│   └── {端名}/{功能单元}/suites/TS-{端}-{单元}-{类型}/
├── iterations/{期次}/           # ★ 执行事实（矩阵/索引/执行记录）
├── plans/  bugs/  reports/  templates/  fixtures/  archive/  trend/
```

---

## 与 Spec\* 生态的配合

SpecTest 是三道闸的最后一环，与姐妹工具协同工作：

```
SpecProt（产品底座）        SpecCore（开发底座）        SpecTest（测试底座）
把模糊意图变成可验收规格  →  按规格开发、产出测试规格  →  按测试规格生成用例并执行
        闸 1 freeze → unitize        闸 2 TEST.md → init       闸 3 gate → execute 门禁
```

- **数据边界**：读 `020-specs/`（只读全量），写 `.spectest/`（独立领地），不碰需求与代码。
- **报缺不脑补**：规格缺口、契约缺口、元素标识缺口——一律报缺退回，禁止 AI 凭空补。

---

## 常见问题（FAQ）

**Q：我不会写代码，能用吗？**
能。安装后一条 `spectest ask` 说人话即可；用例由 AI 生成，你负责审和跑。

**Q：新期次开始，老用例会丢吗？**
不会。用例资产在全量层 `GLOBAL/cases`，期次归档不带走；`run` 无参自动跨期次全量回归。

**Q：`run` 和 `regress` 有什么区别？**
`run` 是无差别全量回归（或指定期次/套件）；`regress` 是先圈定"这次变更影响了哪些用例"再跑子集，适合改动后的快速验证。

**Q：gate 不过怎么办？**
看是哪项不过：覆盖率不够就补用例，有缺陷就修复后 `spectest bug close` 关闭，规格漂移就回 SpecCore 更新规格再 `gen`。

**Q：契约测试和框架测试有什么区别？**
契约测试断言"接口长什么样"（规格定的），SpecTest 内置真 HTTP 执行；框架测试断言"代码怎么算"（开发写的），SpecTest 调度项目自带的 vitest/jest/pytest/playwright 执行。

---

## 文档导航

| 文档 | 内容 |
|:---|:---|
| [docs/quick-start.md](docs/quick-start.md) | 5 分钟上手教程 |
| [docs/workflow.md](docs/workflow.md) | 测试工作流全解（测试人员完整手册，最细致） |
| [docs/overview.md](docs/overview.md) | 产品全景：定位、能力、边界 |
| [docs/command-reference.md](docs/command-reference.md) | 全部命令参数参考 |
| [docs/workspace-organization.md](docs/workspace-organization.md) | 目录组织与双层资产语义 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 架构设计（技术深度） |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |

英文文档以 `.en.md` 成对存在。

---

## 许可

MIT
