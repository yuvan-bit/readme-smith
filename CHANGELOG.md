# 变更日志

本项目的重要变更都记录在这里。格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/)。

## [未发布]

### 新增

- 完整草稿中的 AI 文案现在覆盖简介、最多四条有事实支撑的功能要点，以及使用章节的引导句。每个字段独立校验，因此某个字段被拒绝时会回退到模板文案，而不会丢弃有效的 AI 文本。
- `rf check --changed` 检查根 README 以及每个清单或包 README 发生变化的工作区包。`--base <ref>` 选择比较修订（默认 `HEAD^`）；JSON 报告包含 `affected` 数组。
- 复合 action 接受 `changed-only` 和 `base` 输入，并暴露 `affected-packages` 输出。随附的拉取请求工作流使用 PR base SHA 启用 changed-only 模式。
- `npm run test:coverage` 使用行、分支和函数覆盖率阈值（80/70/80）运行测试套件；CI 现在强制执行这些阈值。

### 变更

- README、贡献指南和本变更日志已完整中文化，面向 Gitee 项目页；重复的 `中文简介` 章节已并入开篇。
- CI 测试任务运行在 Node.js 22 上，以支持覆盖率阈值参数。
- README 和变更日志记录了扩展后的 AI 边界、changed-only 单仓库检查和覆盖率门禁。

## [0.2.0] — 2026-10-21

此版本用规范描述的本地优先健康医生替换了双语 README 生成器。

### 新增

- `rf scan`：带出处的确定性事实表，支持按项目类型检测、安装/使用推导、环境变量、CI 工作流和构建命令。
- `rf doctor`：五维评分（完整性、可用性、准确性、可读性、新鲜度），并给出各维度问题和行号。
- `rf draft`：只写 `README.draft.md`，把缺失章节合并到现有 README，支持 `--lang en|zh` 和 `.readme-smith/templates/` 中的自定义模板。
- `rf diff`：章节级结构化差异，以及可选的统一摘录（`--show`）。
- `rf check`：结合 doctor 和确定性草稿差异的 CI 门禁；识别 `#rf-skip` 并写入 GitHub 步骤摘要。
- `rf apply`：用 `--dry-run` 预览，备份到 `.README.bak.md`，然后把草稿复制到 `README.md`。
- `rf init`：带注释的 `.readme-smith.yaml` 配置。
- 通过 OpenAI 兼容端点进行可选 AI 改写（默认本地 Ollama；只有显式提供密钥时才使用 `openai`）。提示词只包含事实块；文案在使用前会对照事实校验。
- 复合 GitHub Action（`action.yml`），支持 `check` 和 `proposal` 模式，附带示例工作流和 pre-commit 钩子定义。
- 面向 Node/TypeScript、Python、Rust、Go、Ruby、单仓库、Web 和数据集项目的夹具，以及黄金事实快照和端到端 CLI 测试。

### 变更

- 事态提取对未知值使用 `null` 和 `[verify]`，而不是推断。
- CLI 现在名为 `rf`，带有 `readme-smith` 别名，并遵循规范中的退出码。
- 评分会把未通过的检查压到低于满分，因此四舍五入永远无法掩盖缺陷。
- 差异行号由单遍编辑脚本推导，保持新增行的偏移正确。
- README 分析对标准章节标题不区分大小写。

### 移除

- 双向 README 翻译流水线及其提供方。
- 0.1.x 生成器中的徽章、Mermaid 和自定义章节生成。
- 旧的 `scanner/` 和 `generate/` 模块。

## [0.1.0] — 2026-10-20

### 新增

- 初始仓库扫描器和双语 README 生成原型。
- 语言统计、清单检测和中英文模板。

[0.2.0]: https://gitee.com/yuwan41064/readme-smith/compare/v0.1.0...v0.2.0
[0.1.0]: https://gitee.com/yuwan41064/readme-smith/releases/tag/v0.1.0
