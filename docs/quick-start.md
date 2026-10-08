# 快速上手教程

> 本教程面向测试人员：不需要写代码，跟着做，十分钟走完"生成 → 执行 → 把关"全流程。

## 先决条件

- Node.js ≥ 18（`node --version` 可查）
- 一个 SpecCore 项目（含 `020-specs/` 测试规格；没有也没关系，教程附了造样例的办法）
- 一个能协作的 AI 编程工具（生成用例时 AI 接力用；不用 AI 也可以手工写用例）

## 第 0 步：安装

```bash
npm install -g spectest-cli   # 命令名仍是 spectest
spectest --version   # 看到版本号即成功
```

## 第 1 步：初始化

进入 SpecCore 项目目录（就是有 `.speccore/` 和 `Iteration-*/` 的地方）：

```bash
cd 你的项目
spectest init --iteration Q1
```

`init` 会在项目里创建 `.spectest/` 测试领地（配置、环境、报告目录等），并把 Q1 记为期次。如果项目里已有 `.speccore/local/context.json`，不传 `--iteration` 也会自动识别当前期次。

## 第 2 步：生成测试用例（AI 接力）

```bash
spectest gen --iteration Q1
```

这一步做了什么：
1. CLI 扫描 `020-specs/` 下每个"功能单元 × 端"的 TEST.md，读出验收标准（AC）清单
2. 为每个单元预建**骨架**：`SUITE.yaml`（套件元信息）+ `SCAFFOLD.md`（骨架说明），并登记追溯矩阵
3. 输出一段 `[SPECTEST_PROMPT]` 接力提示，进程以退出码 10 结束

接下来把接力提示交给你的 AI 编程工具，让它按提示把用例写成 `cases/TS-…-AC-…​.yaml` 文件。**用例必须锚定 AC**：每条 AC 至少一条用例，四象限场景（正向/异常/边界/边缘）按 AC 场景覆盖。

写完后回写校验：

```bash
spectest gen --iteration Q1 --apply
```

`--apply` 会 zod 校验每个用例文件 → 登记追溯矩阵（AC ↔ 用例双向可见）→ 重建索引 → 报告骨架完成度。看到"骨架完成度 100%"就齐了；有 AC 空缺会提示补齐。

> **不想用 AI 怎么办**：手工照 `SCAFFOLD.md` 里的结构写 yaml 用例文件，再 `--apply`，效果一样。

### 增量生成的妙处

再跑一次 `spectest gen` 会看到"复用不重建"：

```
│  待接力套件│  0
│  复用套件  │  1
[OK] ✅ 全量层用例已存在：1 个套件全部复用，无需重新生成
```

用例已经住在全量层 `GLOBAL/cases`，规格没变就不重做；规格变了才标记"增量补充"。

## 第 3 步：执行测试流水线

```bash
spectest run              # 全量回归：跨所有期次，逐期推进三层链
spectest run -i Q1        # 只跑 Q1
spectest run -i Q1 -s TS-h5-mobile-booking-unit   # 只跑某个套件
```

三层链依次推进，先轻后重、失败即停：

| 层 | 干什么 | 什么时候跳过 |
|:---|:---|:---|
| 1 静态验证 | 规格骨架、AC 覆盖、用例完整性 | 零成本，永远跑 |
| 2 契约执行 | 真 HTTP 请求 + 断言（接口类用例） | 没配环境 `environments/test.yaml` 时自动跳过 |
| 3 宿主框架 | 调度项目自带的 vitest/jest/pytest/playwright | 项目没接这些框架时如实报"未接入" |

**契约执行的环境配置**（要跑接口测试就配一个）：

```yaml
# .spectest/environments/test.yaml
name: test
baseUrl: http://localhost:8080
auth:
  type: none        # none / bearer / basic
  token: ""
```

## 第 4 步：质量门禁

```bash
spectest gate --iteration Q1
```

八项检查（Task 关联、覆盖率、规格完备性、执行完备性、通过率、P0 用例、规格漂移、未修复缺陷）逐项给结论。**不过就是不过**：

- 退出码 1 = 拦截（SpecCore 的 execute 门禁会读这个结论，不让上线）
- `--json` 输出机器可读的结论，供流水线回流

门禁不通过的常见处理：

| 不过的原因 | 处理 |
|:---|:---|
| 覆盖率不够 | 补用例：`spectest gap -i Q1` 看缺口在哪，再 `gen`/`--apply` |
| 有未修复缺陷 | `spectest bug list` 看清单 → 开发修复 → `spectest bug close <BUG-ID>` |
| 规格漂移 | 回 SpecCore 更新规格（TEST.md）→ `spectest gen` 增量补充 |

## 第 5 步：记录缺陷（bug 闭环）

测试发现缺陷，随手记录：

```bash
# 记录
spectest bug --case-id TS-h5-mobile-booking-unit-AC-001 \
  --title "金额精度丢失" --severity high --description "1.99 元订单结算成 2 元"

# 查看（默认只看未关闭）
spectest bug list
spectest bug list --status all

# 修复后关闭
spectest bug close BUG-1790669695502
```

缺陷分两类：**代码缺陷**（开发修）和**规格缺陷**（AC 写得不合理，回流给 SpecProt 改规格）。`bug close` 后 gate 的"未修复缺陷"检查才放行。

## 第 6 步：看结果

```bash
spectest report -i Q1      # 完整测试报告（覆盖、用例、缺陷全貌）
spectest summary -i Q1     # 一页总结
spectest trend             # 跨期次趋势（通过率走势、覆盖率成长）
spectest status            # 当前状态面板
spectest archive -i Q1     # 期次归档（快照随附用例副本，可随时翻阅）
```

## 日常高频操作（一分钟版）

```bash
spectest ask "跑一下测试"              # 说人话，自动识别意图
spectest ask "质量门禁能不能放行"       # 等价 gate
spectest ask "记录缺陷 用例 TS-xxx-AC-001 标题 金额精度丢失"
```

## 进阶：一句话流程总结

**init 建领地 → gen 长用例 → run 跑三层 → gate 把硬关 → bug 闭缺陷 → report 出答卷**。

---

> 📖 想了解全流程的每一个环节（AI 接力细节、环境矩阵、视觉回归、八项门禁、报告产出形态）？
> 读 [workflow.md](workflow.md)——《测试工作流全解》，测试人员的完整手册。
