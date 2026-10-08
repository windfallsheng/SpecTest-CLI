# 测试工作流全解（测试人员完整手册）

> 这份文档写给**测试人员**：不要求会写代码，跟着每一节操作即可完成一轮完整的测试。
> 从「需求变成用例」到「报告交到手里」，七个阶段、每一步的命令、参数、产物，都在这里。
>
> 如果只想 5 分钟跑通一遍，先读 [quick-start.md](quick-start.md)；本文是完整流程的详解。

## 目录

1. [一轮测试的生命周期（全景图）](#一轮测试的生命周期全景图)
2. [阶段一：建领地 init](#阶段一建领地-init)
3. [阶段二：生案例 gen（AI 接力）](#阶段二生案例-genai-接力)
4. [阶段三：跑三层 run](#阶段三跑三层-run)
5. [阶段四：换环境（SIT/UAT）](#阶段四换环境situat)
6. [阶段五：把门禁 gate](#阶段五把门禁-gate)
7. [阶段六：闭缺陷 bug](#阶段六闭缺陷-bug)
8. [阶段七：出答卷 report / summary / trend / export](#阶段七出答卷-report--summary--trend--export)
9. [完整示例：一轮端到端](#完整示例一轮端到端)
10. [高频问题](#高频问题)

---

## 一轮测试的生命周期（全景图）

```
建领地          生案例                跑三层             把门禁      闭缺陷       出答卷
  │               │                     │                  │           │            │
init ────────→ gen（AI 接力） ────→ run -i Q1 ────────→ gate ────→ bug ─────→ report
  │               │                     │                  │           │            │
.spectest/     GLOBAL/cases/       三层链逐端推进      八项硬关     记录→关闭   REPORT.md
目录骨架       用例资产落盘        先轻后重失败即停    fail=fail   索引可追溯  summary/trend
```

**两个关键认知**（贯穿全程）：

- **用例资产与执行事实分家**：用例永远住 `.spectest/GLOBAL/cases/`（跨期次复用，Q2 继承 Q1）；每次执行的结果记在 `.spectest/iterations/{期次}/`（各期次记各的账）。
- **三层链先轻后重**：静态验证（零成本）→ 契约执行（内置真 HTTP）→ 宿主框架（调度项目自己的测试），一层不过不推下一层，失败即停。

---

## 阶段一：建领地 init

在 SpecCore 项目根目录下，给测试建一块专属领地：

```bash
cd 你的项目目录
spectest init --iteration Q1        # Q1 = 期次名，与 SpecCore 迭代对应
```

init 会创建 `.spectest/` 目录骨架：`local/`（本地状态）、`tests/{期次}/`、`reports/`（报告）、`templates/`（模板）。

**注意**：环境配置目录 `environments/` 不会自动创建——需要时手动建（见[阶段四](#阶段四换环境situat)）。

---

## 阶段二：生案例 gen（AI 接力）

### 2.1 一条命令长用例

```bash
spectest gen --iteration Q1
```

gen 做三件事：

1. **扫描规格**：读取 SpecCore 迭代的 `020-specs/`（TEST.md 的验收标准 AC、TECH.md 等），按「端 → 功能单元 → 类型」切分
2. **预建骨架**：在 `GLOBAL/cases/{端}/{单元}/suites/TS-.../` 下生成 `SUITE.yaml`（套件信息）与 `SCAFFOLD.md`（生成指引），并登记追溯矩阵
3. **打印接力清单**：输出 `[SPECTEST_PROMPT]` 标记的完整提示，并以 **exitCode 10** 退出——这是给宿主 AI 的信号：请按清单为每个套件编写用例文件

**负责人接力**：若 SpecCore 已分配人员（030-tasks 子任务 owner，或 STAFFING.md 平台方向唯一成员），骨架的 `SUITE.yaml` 会写入 `owner`，接力提示随之带上「以该负责人视角设计用例」——谁的模块谁写用例。未登记不脑补，导出时归「未登记」便于补录。

### 2.2 接力与回写（谁写用例）

gen 只搭骨架，**用例内容由宿主 AI 填写**——分工原则：确定性的事 CLI 做，创造性的事 AI 做：

```
spectest gen -i Q1          # CLI 扫规格、建骨架、打印接力清单（exitCode 10）
        ↓ 宿主 AI 收到接力提示
AI 按清单写 cases/*.yaml    # 每个用例：幂等 ID + 锚定 AC + 四象限场景
        ↓
spectest gen -i Q1 --apply  # 校验回写：格式检查 + 登记追溯矩阵（AC ↔ 用例）
```

用例文件约定（接力提示里会完整给出）：

- **用例 ID 幂等**：`TS-{端}-{单元}-{类型}-AC-{编号}`，一次生成终身不变——矩阵登记、缺陷关联、单用例复跑全靠它
- **锚定 AC**：每个用例必须关联至少一条验收标准（relatedAC 字段），没有 AC 的用例是孤儿，门禁会拦
- **四象限覆盖**：每条 AC 按 happy（正向）/ error（异常）/ boundary（边界）/ edge（边缘）全覆盖
- **前端端附赠视觉回归**：h5-mobile / admin-web 等前端端的 UI 用例，须同步产出 playwright 视觉回归测试（`toHaveScreenshot` 像素断言），基线生成后可用 `visual-review` 交由视觉模型确认（见 3.4）

### 2.3 增量三态（重复 gen 不重复劳动）

| 场景 | gen 的行为 |
|:---|:---|
| 规格没变、用例已落盘 | **复用**：全量层资产一字不动，接力清单跳过该套件 |
| 规格变了（AC 增减） | **增量**：接力清单标注「AC 已变化，增量补充」，只补新增/变更部分 |
| 新套件 | **全量**：完整预建骨架，进接力清单 |

所以**重复跑 gen 是安全的**——它只补缺口，不推翻已有用例。

### 2.4 精细化控制

```bash
spectest gen -i Q1 -p h5-mobile          # 只接力某个端
spectest gen -i Q1 -u booking            # 只接力某个功能单元
spectest gen -i Q1 --type e2e            # 只生成某类用例（unit/integration/e2e/api/performance/security）
spectest api -i Q1                       # 单独从 API_CONTRACT.yaml 生成契约面用例
```

---

## 阶段三：跑三层 run

### 3.1 一条命令跑三层

```bash
spectest run -i Q1
```

run 就是流水线执行器，按「先轻后重、失败即停」逐层推进：

```
┌─ 层 1/3 静态验证（零成本）─────────────┐
│  文档级检查：AC 格式、用例证明、四段齐全、契约一致性   │
│  秒级出结论，专拦低级错误                             │
├─ 层 2/3 契约执行（内置执行器，真打接口）─────────────┤
│  真实 HTTP 请求 + 状态码断言，验证「接口长什么样」      │
│  不需要业务代码就能跑；无环境配置时自动跳过            │
├─ 层 3/3 宿主框架（调度项目自己的测试）───────────────┤
│  探测 vitest/jest/pytest/playwright，组装命令调度执行  │
│  业务逻辑怎么算，由开发写的测试说了算                  │
└────────────────────────────────────────┘
```

- **静态验证**是唯一 SpecTest 能零成本自查的层，AC 格式错误、用例没锚定 AC 都在这里被拦下
- **契约执行**验证接口契约面，SIT 环境部署后跑它 = 最快的主链路探活
- **宿主框架层**调度的测试文件由接力时随用例产出（测试名携带 caseId），结果按 caseId 回填矩阵

### 3.2 选择测什么（五级过滤）

```bash
spectest run -i Q1 -s TS-h5-mobile-booking-e2e    # 只跑某个套件
spectest run -i Q1 --priority high                # 只跑 P0（冒烟）
spectest run -i Q1 --case TS-xxx-EP-001,TS-xxx-EP-002   # 指定用例（复跑失败用例）
spectest run -i Q1 --retry 2                      # 失败自动重试 2 次（抗 flaky）
spectest run -i Q1 --args "--grep" "登录"          # 附加参数透传宿主框架
```

`--priority` / `--case` / `--retry` 只作用于契约层（内置执行器可控面）；宿主框架层用 `--args` 透传框架自身的过滤能力。

### 3.3 全量回归与变更回归

```bash
spectest run                    # 无参 = 全量回归：跨期次逐期推进三层链
spectest regress --task Task-001   # 变更后回归：先圈定受影响用例，再跑子集
spectest impact --task Task-001    # 变更影响分析：看动了一个任务会影响哪些用例
```

全量回归是「保险」：Q2 发版前无参 run 一遍，Q1 的用例也会被重新验证——老功能始终有人守。

### 3.4 视觉回归（前端端）

前端端 UI 用例在接力时已同步产出 playwright 视觉回归测试，层 3 自动调度执行，像素比对由 playwright 完成。需要「看懂图」的环节（基线确认、失败 diff 分析）用视觉模型补位：

```bash
# 启用视觉模型（OpenAI 兼容协议，任意服务商；密钥走环境变量不落盘）
spectest config set visual.enabled true
spectest config set visual.apiKey '${VISUAL_API_KEY}'
spectest config set visual.baseUrl 'https://api.openai.com/v1'

# 基线确认 / 失败 diff 分析
spectest visual-review -i Q1 --image baseline.png --question "该截图是否符合 UI_SPEC 的页面描述"
spectest visual-review -i Q1 --image base.png --image diff.png --question "两图差异是否为可接受变更"
```

未配置视觉模型时，视觉回归照常跑（像素比对不依赖 AI），仅基线确认改为人工——**报缺不脑补**。

---

### 3.5 测试方式全景（不止冒烟与视觉）

SpecTest 的测试方式是一张「六类型 × 三层执行 × 多场景」的矩阵，冒烟与视觉只是场景层最显眼的两员。

**① 测试类型（生成即分型）**：`gen --type` 六种——unit（单元）/ integration（集成）/ e2e（端到端）/ api（接口）/ performance（性能）/ security（安全），另有 `spectest api` 从 API_CONTRACT.yaml 直出契约面用例。

**② 执行形态（三层各自是不同的测试方式）**：

| 层 | 测试方式 | 查什么 |
|:---|:---|:---|
| 层 1 静态验证 | 文档级质量测试（零成本） | AC 格式、用例证明、四段齐全、契约一致性 |
| 层 2 契约执行 | 接口契约测试（内置真 HTTP） | 状态码断言、四象限场景、带认证打真实环境 |
| 层 3 宿主框架 | 调度项目自己的测试 | 探测 vitest/jest/playwright/pytest——单元/集成/e2e/视觉回归/性能/安全全在此落地 |

**③ 场景形态（冒烟只是其中之一）**：

| 场景 | 命令 | 是什么 |
|:---|:---|:---|
| 冒烟 | `run --priority high` | 只跑 P0，几分钟探活主链路 |
| 全量回归 | `run`（无参） | 跨期次逐期推进，老功能永远有人守 |
| 变更回归 | `regress --task` | 先圈定受影响用例再跑子集 |
| 影响分析 | `impact --task` | 动一个任务会波及哪些用例 |
| 环境矩阵 | `run --env sit,uat` | 同批用例双环境对比 |
| 单点复跑 | `run --case TS-xxx-EP-001` | 失败用例定点打击 |
| 抗 flaky | `run --retry 2` | 失败自动重试 |
| 视觉回归 | 层 3 playwright `toHaveScreenshot` | 像素比对（确定性计算，不靠 AI） |
| 视觉审查 | `visual-review` | 基线确认/diff 分析/语义断言（外部模型） |
| 覆盖体检 | `gap` | AC ↔ 用例覆盖缺口检测 |

**④ 边界（借得动，不硬扛）**：性能与安全类型的用例由 SpecTest 生成、经层 3 调度宿主框架执行——不内置压测引擎与安全扫描器；视觉模型经 OpenAI 兼容协议外接。SpecTest 自己能精确断言的事自己做（状态码、格式、覆盖），需要重引擎的事借力宿主与外部。

---

## 阶段四：换环境（SIT/UAT）


### 4.1 环境文件

环境配置独立于期次，住在 `.spectest/environments/{env}.yaml`，**手动创建**（init 不会自动生成）：

```yaml
# .spectest/environments/sit.yaml
baseUrl: http://10.0.1.20:8080
timeoutMs: 10000
headers:
  Authorization: 'Bearer ${SIT_TOKEN}'    # ${VAR} 环境变量占位，敏感值不落盘
```

| 字段 | 说明 |
|:---|:---|
| `baseUrl` | 必填。契约执行的目标地址 |
| `timeoutMs` | 可选，默认 5000 毫秒 |
| `headers` | 可选，全局请求头（支持 `${VAR}` 占位） |

### 4.2 阶段切换（一条命令一个阵地）

```bash
# 提测：测试环境三层链
spectest run -i Q1 --env test

# SIT 冒烟：只跑 P0 契约用例，几分钟探活主链路
spectest run -i Q1 --priority high --env sit

# SIT/UAT 对比回归：环境矩阵，同一批用例在两个环境各跑一遍
spectest run -i Q1 --env sit,uat

# 单层直调：契约层独立跑（环境探活最快路径）
spectest contract-run -i Q1 --env sit
```

环境矩阵是**单环境原子**的：某环境缺配置只跳过那一行，其余照常——不会因 UAT 没配好而挡住 SIT 的结果。

### 4.3 接入 CI 流水线

`templates/ci/` 提供 GitHub Actions 与 GitLab CI 双模板：workflow 输入期次名与环境名，自动执行「P0 冒烟 + gate 门禁」，复制到项目 `.github/workflows/` 即可用。

---

## 阶段五：把门禁 gate

```bash
spectest gate -i Q1
```

门禁就是「能不能发版」的硬结论，**八项检查、fail 就是 fail**：

| 检查项 | 拦什么 |
|:---|:---|
| Task 关联 | 用例没有关联开发任务（孤儿用例） |
| 覆盖率 | AC 覆盖低于阈值（默认 80%） |
| 规格完备性 | 规格文档缺件（AC 缺失/骨架空洞） |
| 执行完备性 | 有用例从未被执行 |
| 通过率 | 通过率低于阈值（默认 90%） |
| P0 用例 | 高优先级用例有失败或未执行 |
| 规格漂移 | 用例与规格对不上（spec 变了用例没跟上） |
| 未修复缺陷 | 存在 open 状态的缺陷——**必须先修复并 close** |

阈值可调：`spectest config set gate.coverageThreshold 85`。

门禁失败的处置路径：

```
看哪项失败 → 对症下药：
  覆盖率低      → 补用例
  未修复缺陷    → 修复后 spectest bug close <BUG-ID>
  规格漂移      → 回 SpecCore 更新规格 → 重新 gen
  通过率低      → 用 --case 复跑失败用例定位
```

---

## 阶段六：闭缺陷 bug

### 6.1 记录缺陷

```bash
spectest bug --case-id TS-booking-service-api-contract-api-EP-001 \
             --title "下单接口金额精度丢失" \
             --severity high
```

### 6.2 缺陷清单与关闭

```bash
spectest bug list              # 默认只看未关闭（open）
spectest bug list --status all # 看全部
spectest bug close BUG-0003    # 修复后关闭
```

- 每条缺陷是 `.spectest/bugs/` 下的独立 JSON 事实文件
- `INDEX.md` 维护全量索引表（ID / 严重程度 / 标题 / 关联用例 / 状态）——**关闭只是改状态，记录永远可追溯**
- gate 的「未修复缺陷」项就是盯着这张清单：有 open 不放行

### 6.3 双类缺陷

- **代码缺陷**：实现与规格不符，关联用例失败——修代码后 close
- **规格缺陷**：规格本身有问题——回 SpecCore 改规格，重新 gen 让用例跟上

---

## 阶段七：出答卷 report / summary / trend

### 7.1 详细报告 report

```bash
spectest report -i Q1
```

产出 `.spectest/reports/REPORT-Q1.md`，三节：

1. **概览**：11 项指标一张表——单元/套件/用例数、已执行与未执行、通过/失败/跳过、通过率、AC 覆盖率、P0 通过、缺陷开关数、规格缺口/漂移
2. **AC 覆盖矩阵**：逐端逐单元，每条 AC → 场景 → 证明用例 → 用例状态——一眼看出哪条 AC 没人管
3. **套件明细**：每个套件逐用例列 ID / 名称 / 优先级 / 状态

### 7.2 一页总结 summary

```bash
spectest summary -i Q1
```

产出 `summary-Q1.md`：质量度量单表，给决策者看结论（能不能发，差在哪）。

### 7.3 跨期次趋势 trend

```bash
spectest trend       # 通过率/覆盖率/缺陷数随期次走向——质量在爬坡还是滑坡
spectest status      # 当前状态面板：套件/用例/缺口速览
```

### 7.4 导出案例 export（交卷 / 归档）

```bash
spectest export -i Q1                   # 该期次全部用例
spectest export -i Q1 --units "A,B"     # 只挑几个功能单元
spectest export -i Q1 --owner 张三      # 按负责人过滤
spectest export -i Q1 -f yaml           # 机读格式（json 同）
```

导出落盘 `.spectest/exports/{期次|ALL}/EXPORT-{ts}.{fmt}`。md 人读：概览 → 负责人分布 → 逐套件用例表 + 步骤明细；yaml/json 机读，对接归档与 SpecCore。多需求、多人分头生成时，导出就是总装：按单元挑、按人挑、全部拼盘，一份答卷交出去。

---

## 完整示例：一轮端到端

以「预订功能」迭代 Q1（含 booking-service 后端 + h5-mobile 前端）为例，测试人员一天的操作：

```bash
# ① 建领地
spectest init --iteration Q1

# ② 生案例（AI 接力：扫全部端，打印接力清单）
spectest gen --iteration Q1
#    → 宿主 AI 按清单为 booking-service / h5-mobile 写 cases/*.yaml
spectest gen --iteration Q1 --apply    # 校验回写，登记追溯矩阵

# ③ 配环境（手动建两个环境文件）
#    .spectest/environments/sit.yaml / uat.yaml

# ④ 提测跑三层
spectest run -i Q1 --env test

# ⑤ SIT 冒烟：只跑 P0
spectest run -i Q1 --priority high --env sit

# ⑥ SIT/UAT 对比回归：环境矩阵
spectest run -i Q1 --env sit,uat

# ⑦ 失败用例 → 记缺陷 → 修复 → 关闭
spectest bug --case-id TS-booking-service-api-contract-api-EP-001 --title "下单金额精度丢失" --severity high
spectest bug close BUG-0001

# ⑧ 发版门禁
spectest gate -i Q1

# ⑨ 出答卷
spectest report -i Q1    # 详细报告
spectest summary -i Q1   # 一页总结
spectest trend           # 跨期次趋势
```

---

## 高频问题

**Q：我不会写代码，用例谁来写？**
gen 只搭骨架，用例内容由宿主 AI 按接力清单填写——你审查、跑、看报告即可。所有命令都支持说人话：`spectest ask "跑一下测试"`。

**Q：Q2 开始后，Q1 的用例会丢吗？**
不会。用例资产在全量层 `GLOBAL/cases/`，跨期次复用；无参 `spectest run` 全量回归会连 Q1 一起验。归档（`spectest archive`）也只快照事实、随附用例副本，不搬走资产。

**Q：UAT 环境还没配好，会挡住 SIT 的回归吗？**
不会。环境矩阵单环境原子——`--env sit,uat` 时 UAT 缺配置只跳过该环境行，SIT 结果照常产出。

**Q：为什么有静态验证和契约执行两层？**
静态验证零成本拦低级错误（格式、骨架空洞）；契约执行验证接口契约面，不需要业务代码就能跑。先轻后重，把昂贵的宿主框架跑留到最后。

**Q：视觉回归测试需要视觉模型吗？**
不需要。像素比对由 playwright 完成（确定性计算）；视觉模型只补「基线确认 / diff 分析」这类需要看懂图的环节，未配置时人工确认——报缺不脑补。

---

## 更多文档

| 文档 | 内容 |
|:---|:---|
| [quick-start.md](quick-start.md) | 5 分钟上手（本文的精简版） |
| [command-reference.md](command-reference.md) | 全部命令参数参考 |
| [workspace-organization.md](workspace-organization.md) | 目录组织与双层资产语义 |
| [overview.md](overview.md) | 产品全景：定位、能力、边界 |
