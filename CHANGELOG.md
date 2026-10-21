# 变更日志

本项目的重要变更都记录在这里。格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/)。

## [0.3.0] — 2026-10-21

把安装入口从源码构建改为 npm 包、以 GitHub 为主仓库的版本。重点降低安装门槛，并用真实开源仓库校准准确率。

### 新增

- 提供 npm 分发包 `readme-smith`：`package.json` 只暴露一个可执行文件，`npm pack` 产物已通过干净安装验证；已发布到 npm registry，支持 `npm install -g readme-smith`、`npm install --save-dev readme-smith` 和 `npx readme-smith`，不再要求 `git clone` + `build` + `link`。
- 新增 GitHub composite action 的 tag 用法 `yuvan-bit/readme-smith@v0.3.0`，与 npm 安装路径并存。
- 新增真实仓库实测数据：`is-number` 97、`cross-env` 92、`chalk` 91、`express` 79；并给出 `pallets/click` 从 **74 分修复到 99 分** 的可复现前后对比。
- 新增 `SECURITY.md` 实测：扫描事实表记录 `community.security`，治理测试验证支持版本、私下报告邮箱和 README 链接。
- 新增权重归一化：配置可写任意正的相对值或只写部分维度，加载时用最大余数法归一化为总和 100 的整数。
- 新增 HTML 标题解析（含多行 `<h1>` 和 logo 的 `alt` 文本）、小写 `readme.md` / `Readme.md` 识别、单引号 MIT 许可证文本识别，以及系统环境变量与 shell 示例变量的排除规则。
- 新增 Gitee Go 流水线 `.workflow/master-pipeline.yml` 与 `.workflow/pr-pipeline.yml`：分别在 push 到 `master` 和向 `master` 发起或更新 PR 时，用 Node.js 22.14.0 运行 `npm ci && npm run ci`。需在 Gitee 仓库的「流水线」页面开通后才会执行。
- 新增 `.gitee/ISSUE_TEMPLATE/` 的缺陷、功能与文档表单、`.gitee/pull_request_template.md`，以及 `CODE_OF_CONDUCT.md`；漏洞报告入口改为维护者邮箱。

### 变更

- **GitHub 成为主仓库**：`repository`、`homepage`、`bugs`、文档链接、pre-commit 示例和版本链接全部指向 GitHub；Gitee 保留为镜像，Gitee Go 流水线仍需在 Gitee 侧开通。
- **`rf` 不再是 npm 包的可执行文件**：`bin` 只保留 `readme-smith`，避免与 registry 上已有的 `rf` 包冲突；需要短命令的用户可以在 shell 中自行设置 `alias rf='readme-smith'`。
- 权重配置从“必须合计 100，否则整块回退”改为自动归一化；部分权重继承预设，设为 `0` 可排除维度，只有全零或全非法才回退默认值。
- README 的安装、快速开始、CI、故障排查和版本发布章节改为 GitHub/npm 优先，并明确 Gitee Go 当前未开通、没有实际流水线记录。
- 支持版本范围更新为 `0.3.x`；`0.2.x` 及更早版本不再接收安全更新。

### 修复

- 修复 HTML 标题和小写 README 文件名导致的“无 H1 / README 不存在”误判。
- 修复 `FORCE_COLOR`、`NODE_ENV` 等平台环境变量被当作项目未声明配置的误报；`$GREET`、`$ENV_VAR` 这类示例用法不再被当作配置声明。
- 修复单引号 `'AS IS'` 的 MIT 许可证被识别为 Custom 的问题。
- 修复浅克隆下把 README 误判为过期的问题；看不到 README 历史时新鲜度记为中性。
- 修复纯版本号、release、bump、依赖更新等提交触发“README 过期”的误报。
- 修复 `readme.md` 与 `README.md` 大小写不一致时新鲜度永远为 0 的问题。

### 移除

- npm 包中的 `rf` 可执行文件（历史版本仍可通过旧包使用）。
- “权重必须合计 100”的硬性限制。

## [0.2.0] — 2026-10-21

此版本用规范描述的本地优先健康医生替换了双语 README 生成器。

### 新增

- `rf scan`：带出处的确定性事实表，支持按项目类型检测、安装/使用推导、环境变量、CI 工作流和构建命令。
- `rf doctor`：五维评分（完整性、可用性、准确性、可读性、新鲜度），并给出各维度问题和行号。
- `rf draft`：只写 `README.draft.md`，把缺失章节合并到现有 README，支持 `--lang en|zh` 和 `.readme-smith/templates/` 中的自定义模板。
- 完整草稿中的 AI 文案覆盖简介、最多四条有事实支撑的功能要点，以及使用章节的引导句。每个字段独立校验，因此某个字段被拒绝时会回退到模板文案，而不会丢弃有效的 AI 文本。
- `rf diff`：章节级结构化差异，以及可选的统一摘录（`--show`）。
- `rf check`：结合 doctor 和确定性草稿差异的 CI 门禁；识别 `#rf-skip` 并写入 GitHub 步骤摘要。
- `rf check --changed` 检查根 README 以及每个清单或包 README 发生变化的工作区包。`--base <ref>` 选择比较修订（默认 `HEAD^`）；JSON 报告包含 `affected` 数组。
- `rf apply`：用 `--dry-run` 预览，备份到 `.README.bak.md`，然后把草稿复制到 `README.md`。
- `rf init`：带注释的 `.readme-smith.yaml` 配置。
- 通过 OpenAI 兼容端点进行可选 AI 改写（默认本地 Ollama；只有显式提供密钥时才使用 `openai`）。提示词只包含事实块；文案在使用前会对照事实校验。
- 复合 GitHub Action（`action.yml`），支持 `check` 和 `proposal` 模式，接受 `changed-only` 和 `base` 输入并暴露 `affected-packages` 输出，附带示例工作流和 pre-commit 钩子定义。
- `npm run test:coverage` 使用行、分支和函数覆盖率阈值（80/70/80）运行测试套件；随附的 GitHub Actions 工作流调用同一命令，因此会执行这些阈值。
- 面向 Node/TypeScript、Python、Rust、Go、Ruby、单仓库、Web 和数据集项目的夹具，以及黄金事实快照和端到端 CLI 测试。

### 变更

- 事实提取对未知值使用 `null` 和 `[verify]`，而不是推断。
- CLI 提供 `readme-smith` 和短别名 `rf`，并遵循规范中的退出码。
- **`rf diff` 退出码与 `git diff --exit-code` 保持一致**：`0` 完全一致，`1` 存在差异，`2` 错误或草稿缺失。CI 中可直接使用 `rf diff || echo changed`。
- 评分会把未通过的检查压到低于满分，因此四舍五入永远无法掩盖缺陷。
- 差异行号由单遍编辑脚本推导，保持新增行的偏移正确。
- README 分析对标准章节标题不区分大小写。
- 测试源码统一到 `test/unit/`，测试构建输出到 `dist-test/`；`npm test` 和 `npm run test:coverage` 会先清理并重建 `dist/` 与 `dist-test/`，分支切换后不会再执行已删除测试的陈旧编译产物。
- README、贡献指南和本变更日志已完整中文化，面向 Gitee 项目页；重复的 `中文简介` 章节已并入开篇。
- 随附的 GitHub Actions 测试工作流运行在 Node.js 22 上，以支持覆盖率阈值参数；工具本身的运行时要求仍是 Node.js 18.17+。

### 修复

- 手动对夹具运行 `rf draft` / `rf apply` 后留下的 `README.draft.md`、`.README.bak.md` 不再污染测试：测试复制夹具时会跳过这些生成文件，`.gitignore` 也已覆盖它们。

### 移除

- 双向 README 翻译流水线及其提供方。
- 0.1.x 生成器中的徽章、Mermaid 和自定义章节生成。
- 旧的 `scanner/` 和 `generate/` 模块。

## [0.1.0] — 2026-10-20

### 新增

- 初始仓库扫描器和双语 README 生成原型。
- 语言统计、清单检测和中英文模板。

[0.3.0]: https://github.com/yuvan-bit/readme-smith/releases/tag/v0.3.0
[0.2.0]: https://github.com/yuvan-bit/readme-smith/tree/v0.2.0
[0.1.0]: https://github.com/yuvan-bit/readme-smith/tree/v0.1.0
