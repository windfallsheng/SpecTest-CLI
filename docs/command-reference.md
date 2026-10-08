# 命令参考

> 全部 17 个命令的参数与示例。`spectest <命令> --help` 可随时查看。

## 全局选项

| 选项 | 说明 |
|:---|:---|
| `--lang <locale>` | 语言：`zh-CN`（默认）或 `en-US` |

## ask — 自然语言智能入口

说人话，自动识别意图并执行。高置信度直接执行；缺参数时输出 `[SPECTEST_NEEDS_INFO]` 交互提示；低置信度输出建议。

```bash
spectest ask "跑一下测试"
spectest ask "质量门禁能不能放行"
spectest ask "记录缺陷 用例 TS-h5-mobile-booking-unit-AC-001 标题 金额精度丢失"
spectest ask --list     # 列出全部支持的意图类型
```

支持的意图族：run / regress / impact / gap / bug / bug-close / bug-list / gate / report / summary / trend / archive / status / config-set 等（`--list` 看全量）。

## init — 初始化测试项目

在 SpecCore 项目内创建 `.spectest/`（含 config.yaml、environments、templates、reports 等）。

| 选项 | 说明 |
|:---|:---|
| `-f, --force` | 强制重新初始化 |
| `-i, --iteration <name>` | 指定期次名称（缺省自动读 `.speccore/local/context.json`） |

## plan — 生成测试计划

| 选项 | 说明 |
|:---|:---|
| `-i, --iteration <name>` | 期次名称 |
| `-g, --goal <goal>` | 期次目标描述 |

## gen — 从 AC 生成测试用例

骨架预建 + AI 接力；已有用例且规格未变则复用不重建，规格变化则增量补充。

| 选项 | 说明 |
|:---|:---|
| `-i, --iteration <name>` | 期次名称 |
| `-p, --platform <platform>` | 端名过滤（标准端名） |
| `-u, --unit <unit>` | 功能单元过滤（slug 或单元名） |
| `-t, --type <type>` | 测试类型：unit / integration / e2e / api / performance / security（默认 unit） |
| `--apply` | 回写模式：zod 校验 + 矩阵登记 + 索引重建 |

```bash
spectest gen -i Q1                    # 预建骨架 → [SPECTEST_PROMPT] → exitCode 10
spectest gen -i Q1 --apply            # AI 写好用例后回写校验
spectest gen -i Q1 --type api         # 按类型过滤
```

## api — 从 API 契约生成接口测试

| 选项 | 说明 |
|:---|:---|
| `-i, --iteration <name>` | 期次名称 |
| `-p, --platform <platform>` | 标准端名（服务端，必填） |
| `-n, --name <name>` | 测试套件名称 |

## gap — 检测覆盖缺口

| 选项 | 说明 |
|:---|:---|
| `-i, --iteration <name>` | 期次名称 |
| `-o, --output <path>` | 报告输出路径 |

## run — 执行测试流水线

三层链（静态验证 → 契约执行 → 宿主框架），先轻后重、失败即停。**无参 = 全量回归**（跨期次逐期推进）。

| 选项 | 说明 |
|:---|:---|
| `-i, --iteration <name>` | 指定期次（缺省 = 全量回归） |
| `-s, --suite <id>` | 按套件执行 |
| `--pipeline` | 显式声明流水线模式（默认即流水线，兼容保留） |
| `--interactive` | 人机交互模式（覆盖 config，每层确认） |
| `--env <name>` | 契约执行环境（默认取 config.pipeline.defaultEnv；逗号分隔 = 环境矩阵，如 `sit,uat`） |
| `--priority <level>` | 优先级过滤：high/medium/low（high=P0，只作用于契约层） |
| `--case <ids>` | 用例级过滤：幂等 caseId 逗号分隔（只作用于契约层） |
| `--retry <n>` | 契约层失败重试次数（默认 0） |
| `--args <extra...>` | 附加参数透传宿主框架 |

```bash
spectest run                    # 全量回归
spectest run -i Q1              # 单期次
spectest run -i Q1 -s TS-xxx    # 单套件
spectest run --interactive      # 每层停下确认
spectest run -i Q1 --priority high --env sit   # SIT 冒烟：只跑 P0 契约用例
spectest run -i Q1 --env sit,uat               # 环境矩阵：SIT/UAT 对比回归
```

## regress — 变更后回归

| 选项 | 说明 |
|:---|:---|
| `-i, --iteration <name>` | 期次名称 |
| `-t, --task <id>` | 按变更 Task ID 圈定回归范围 |

## contract-run — 契约执行（内置执行器）

真实 HTTP 请求 + 状态码断言，唯一「自己真跑」的层。独立于三层链，可单层直调。

| 选项 | 说明 |
|:---|:---|
| `-i, --iteration <name>` | 期次名称 |
| `--env <name>` | 环境名（默认 test；逗号分隔 = 环境矩阵，如 `sit,uat`） |
| `-p, --platform <name>` | 服务端名过滤 |
| `-s, --suite <id>` | 按套件执行 |
| `--priority <level>` | 优先级过滤：high/medium/low（high=P0，与 gate 定义一致） |
| `--case <ids>` | 用例级过滤：幂等 caseId 逗号分隔 |
| `--retry <n>` | 失败重试次数（默认 0，共执行 1+retry 次） |

```bash
spectest contract-run -i Q1 --env sit              # SIT 环境全量契约执行
spectest contract-run -i Q1 --env sit,uat          # SIT/UAT 环境矩阵对比
spectest contract-run -i Q1 --priority high        # 只跑 P0（冒烟）
spectest contract-run -i Q1 --case TS-xxx-EP-001   # 单用例复跑
spectest contract-run -i Q1 --retry 2              # 失败重试 2 次（抗 flaky）
```
## visual-review — 视觉模型审查（可选审查器）

像素比对由 playwright 完成（确定性计算）；此命令补「看得懂」的环节——基线确认、失败 diff 分析、语义断言。未配置视觉段时如实报缺。

| 选项 | 说明 |
|:---|:---|
| `-i, --iteration <name>` | 期次名称（缺省取最近一次 gen/run 的期次） |
| `--image <path>` | 待审图片路径（可多次指定：基线 / 新图 / diff 图） |
| `-q, --question <text>` | 审查问题（如「该截图是否符合 UI_SPEC 的页面描述」） |
| `-c, --context <text>` | 补充上下文（UI_SPEC 描述 / AC 文本） |

```bash
# 启用视觉模型（OpenAI 兼容协议，密钥走环境变量注入不落盘）
spectest config set visual.enabled true
spectest config set visual.apiKey '${VISUAL_API_KEY}'
spectest config set visual.baseUrl 'https://api.openai.com/v1'
spectest config set visual.model gpt-4o

spectest visual-review -i Q1 --image baseline.png --question "该截图是否符合 UI_SPEC 的页面描述"
spectest visual-review -i Q1 --image base.png --image diff.png --question "两图差异是否为可接受变更"
```

判定：PASS / FAIL / unknown；审查记录落盘迭代层 `matrix/visual/REVIEW-*.json`（执行事实按期次记账）。

## impact — 变更影响分析

| 选项 | 说明 |
|:---|:---|
| `-i, --iteration <name>` | 期次名称 |
| `-p, --platform <name>` | 端名过滤 |
| `-u, --unit <name>` | 单元过滤 |

## gap 相关（缺口族）

| 命令 | 选项 | 说明 |
|:---|:---|:---|
| `gap` | `-i, --iteration` / `-o, --output` | AC ↔ 用例覆盖缺口 |
| `regress --task <id>` | `-t, --task <id>` | 按 Task 圈定回归范围 |
| `impact --task <id>` | `-t, --task <id>` | 按 Task 分析影响 |

## bug — 缺陷记录 / 关闭 / 清单

```bash
# 记录
spectest bug --case-id <用例ID> --title <标题> [--severity high|medium|low] [--description <描述>]

# 关闭
spectest bug close <BUG-ID>

# 清单
spectest bug list [--status open|closed|all]
```

| 选项（记录） | 说明 |
|:---|:---|
| `-c, --case-id <id>` | 失败的测试用例 ID |
| `-t, --title <title>` | 缺陷标题 |
| `-s, --severity <level>` | 严重程度：high / medium / low（默认 medium） |
| `-d, --description <desc>` | 缺陷描述 |

缺陷双类：代码缺陷（开发修）与规格缺陷（回流 SpecProt 改规格）；未关闭缺陷会被 `gate` 拦截。

## gate — 质量门禁

| 选项 | 说明 |
|:---|:---|
| `-i, --iteration <name>` | 期次名称 |
| `-t, --task <id>` | 按 Task 检查 |
| `--threshold <percent>` | 覆盖率阈值（默认取 config.yaml，缺省 80） |
| `--json` | 输出 JSON（供 SpecCore execute 门禁机器解析） |

八项检查：Task 关联、覆盖率、规格完备性、执行完备性、通过率、P0 用例、规格漂移、未修复缺陷。退出码 0 = 放行，1 = 拦截。

## report / summary — 报告与总结

| 命令 | 选项 |
|:---|:---|
| `report` | `-i, --iteration` / `-s, --suite <id>` / `-o, --output <path>` |
| `summary` | `-i, --iteration <name>` |

## trend — 跨期次趋势

| 选项 | 说明 |
|:---|:---|
| `-i, --iterations <list>` | 期次列表，逗号分隔（如 Q1,Q2,Q3） |

## archive — 期次归档

| 选项 | 说明 |
|:---|:---|
| `-i, --iteration <name>` | 期次名称 |

快照随附该期次涉及单元的全量层用例副本（GLOBAL-cases），归档自洽可翻阅。

## status — 测试状态

| 选项 | 说明 |
|:---|:---|
| `-i, --iteration <name>` | 期次名称 |

## config — 配置

```bash
spectest config              # 查看 config.yaml 全貌
spectest config set <key> <value>    # 点路径写入，如 gate.coverageThreshold 85
```

关键配置项：`gate.coverageThreshold`（默认 80）、`gate.passRateThreshold`（默认 90）、`pipeline.interactive`（默认 false）、`pipeline.defaultEnv`（默认 test）。
