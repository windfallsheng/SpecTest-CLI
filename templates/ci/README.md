# SpecTest CI 模板

两个可直接复用的 CI 模板（GitHub Actions / GitLab CI），把 SpecTest 接进持续集成：

| 文件 | 平台 | 内容 |
|:---|:---|:---|
| `github-actions.yml` | GitHub Actions | 手动触发：静态验证 → P0 契约冒烟 → gate 门禁 |
| `gitlab-ci.yml` | GitLab CI | 三阶段流水线：verify / contract / gate |

## 使用三步

1. 复制模板到对应位置（GitHub：`.github/workflows/`；GitLab：`.gitlab-ci.yml` 或 include 引用）
2. 改两个变量：`ITERATION`（期次名）、`ENV`（目标环境：sit/uat/test）
3. 在 CI 密钥中配置 `SIT_TOKEN`（环境 YAML 里的 `${SIT_TOKEN}` 占位符由 CI 注入，敏感值不落盘）

## 要点

- **先轻后重**：verify（零成本）先拦，contract（P0 冒烟）再跑，gate 把关
- **防假绿**：gate 不达标 exitCode 1，流水线如实变红
- **环境矩阵**：`ENV: sit,uat` 一行变两行，同一批用例 SIT/UAT 对比回归
- **门禁回流**：`spectest gate --json` 输出机器可解析结果，供发版系统消费
