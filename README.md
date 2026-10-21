# readme-smith

readme-smith 是一个本地优先的 README 健康检查工具。它只从仓库文件中提取可证明的事实，为现有 README 做五维评分，生成可审阅的 `README.draft.md`，并在 CI 中阻止 README 随代码腐化。

- **默认离线。** 扫描、评分、草稿和检查都在本地完成，不需要账号，也不上传代码。
- **不静默改写。** `readme-smith draft` 只写 `README.draft.md`；只有显式执行 `readme-smith apply` 才会更新 `README.md`，并先保留 `.README.bak.md`。
- **不编造事实。** 命令、参数、环境变量和许可证都来自仓库证据；无法证明的信息标记为 `[verify]`，而不是猜一个看起来合理的值。
- **可接入 CI。** `readme-smith check` 同时校验评分和草稿差异，让过期的 README 在合并前失败，而不是在数月后误导新贡献者。

[快速开始](#快速开始) · [命令](#命令) · [评分](#评分) · [CI 集成](#ci-集成)

## 目录

- [为什么选择 readme-smith](#为什么选择-readme-smith)
- [检查内容](#检查内容)
- [支持的项目](#支持的项目)
- [安装](#安装)
- [快速开始](#快速开始)
- [实测数据：真实仓库与修复前后](#实测数据真实仓库与修复前后)
- [命令](#命令)
- [草稿工作流](#草稿工作流)
- [评分](#评分)
- [配置](#配置)
- [AI 边界](#ai-边界)
- [自定义模板](#自定义模板)
- [CI 集成](#ci-集成)
- [JSON 输出](#json-输出)
- [编程接口](#编程接口)
- [安全与隐私](#安全与隐私)
- [故障排查](#故障排查)
- [项目结构](#项目结构)
- [开发](#开发)
- [贡献](#贡献)
- [许可证](#许可证)

## 为什么选择 readme-smith

README 会悄悄腐化。脚本被重命名、参数被删除、安装命令失效，而 README 仍在描述旧世界。评审者很少注意到，直到新贡献者卡在某个已经坏掉的步骤上。

readme-smith 把 README 当作需要对照仓库验证的文档：

- **事实优先。** 名称、版本、脚本、二进制、入口、环境变量、配置文件、CI 任务、许可证和依赖数量都从文件中提取。无法证明的内容是 `null`，绝不猜测。
- **只生成草稿，不直接改写。** `readme-smith draft` 写入 `README.draft.md`。`README.md` 只会由 `readme-smith apply` 在预览并备份之后修改。
- **为腐化设置 CI 门禁。** `readme-smith check` 把评分与确定性草稿差异结合起来，让过期的 README 在拉取请求中失败，而不是漂移数月。

这个工具刻意保持窄范围：它不生成网站、不改写你的标题风格、不做安全审计，也不翻译已提交的 README。

## 检查内容

| 层次 | 检查对象 |
| --- | --- |
| 仓库事实 | 清单文件、脚本及其真实调用方式、二进制、入口、工作区包、安装/使用命令、环境变量名称及其来源、配置文件、CI 工作流、数据集结构、许可证文件、语言分布和 git 历史。 |
| README 结构 | H1–H3 标题、标准章节、围栏代码块及其语言、目录、命令提及、环境变量提及、许可证声明和演示材料。 |
| 结论 | 五个加权维度、带行号的缺失项、已提交 README 与基于当前事实构建的草稿之间的确定性比较，以及单仓库的受影响包报告。 |

每个关键事实都带有出处：环境变量记得哪些文件提到它，脚本保留真实调用方式，许可证记录来源文件。未知值保持 `null`；缺失的文案变为 `[verify]`。

## 支持的项目

扫描器识别以下清单家族：

| 生态 | 清单证据 |
| --- | --- |
| Node.js / TypeScript | `package.json`，包括 npm/pnpm/yarn/bun 工作区 |
| Python | `pyproject.toml`、`setup.py`、`setup.cfg` |
| Rust | `Cargo.toml` |
| Go | `go.mod` |
| Ruby | `Gemfile`、`*.gemspec` |
| PHP | `composer.json` |
| Java | `pom.xml` |
| .NET | `*.csproj`、`*.sln` |

项目类型按以下顺序解析：单仓库标记，其次主清单，最后语言分布。可用 `--preset` 覆盖检测结果。

| 预设 | 适用场景 | 默认权重（完整性 / 可用性 / 准确性 / 可读性 / 新鲜度） |
| --- | --- | --- |
| `cli` | 命令行工具和二进制 | 35 / 25 / 20 / 10 / 10 |
| `lib` | 库和包 | 35 / 25 / 20 / 10 / 10 |
| `web` | Web 应用和浏览器界面 | 30 / 30 / 20 / 10 / 10 |
| `monorepo` | 包含多个包的工作区 | 35 / 25 / 20 / 10 / 10 |
| `dataset` | 数据和 notebook 仓库 | 40 / 20 / 20 / 10 / 10 |

`auto` 使用检测到的预设，并回退到标准权重。

## 安装

需要 Node.js 18.17 或更新版本。Git 是可选的，但启用新鲜度检查和仓库链接。

```bash
npm install -g readme-smith
readme-smith --version
```

0.3.0 已发布到 npm，可用 `npm install -g readme-smith` 直接安装，版本历史见 [npm 包页面](https://www.npmjs.com/package/readme-smith)。

不想全局安装时，用 `npx` 直接运行：

```bash
npx readme-smith doctor .
```

也可以作为开发依赖装进项目，供 CI 或 `package.json` 脚本调用：

```bash
npm install --save-dev readme-smith
npx readme-smith check .
```

> **关于短命令 `rf`**：npm 包只安装 `readme-smith` 一个可执行文件。`rf` 已被 registry 上的其它包占用，本包不再分发它，避免覆盖或命令冲突。如果你喜欢更短的输入，可以在自己的 shell 配置里加一行别名：
>
> ```bash
> alias rf='readme-smith'
> ```
>
> 这只是本机别名，不会安装第二个 npm 包。

从源码安装（贡献者，或需要使用未发布的提交时）：

```bash
git clone https://github.com/yuvan-bit/readme-smith.git
cd readme-smith
npm ci
npm run build
npm link
```

## 快速开始

```bash
readme-smith init                 # 可选：写入 .readme-smith.yaml
readme-smith scan .               # 以 JSON 输出确定性事实
readme-smith doctor .             # 五维评分和缺失项
readme-smith draft . --ai off     # 写入 README.draft.md，不动 README.md
readme-smith diff . --show        # 章节级差异和统一摘录
readme-smith apply . --dry-run    # 预览写入结果
readme-smith apply .              # 更新 README.md，保留 .README.bak.md
readme-smith check .              # CI 门禁：评分加草稿差异
```

`scan` 始终以 JSON 打印事实表。`doctor` 告诉你缺什么。`draft` 提出一份文档。`diff` 展示章节级变化。`apply` 写入草稿并保留备份。`check` 从不写草稿，也不修改 README。

如果项目类型无法识别，命令会以退出码 `2` 结束，并列出它查找过的清单文件。你可以用 `--preset cli|lib|web|monorepo|dataset` 强制指定模板。

## 实测数据：真实仓库与修复前后

以下分数不是示意值，而是用 `readme-smith doctor <path> --json --ai off` 在 2026-10-21 实际测得的。每个仓库用 `git clone --depth 1` 检出并固定到表中的提交；阈值使用默认的 `80`。

| 真实仓库 | 固定提交 | 分数 | 结果 | 主要发现 |
| --- | --- | --- | --- | --- |
| [`jonschlinkert/is-number`](https://github.com/jonschlinkert/is-number) | `98e8ff1` | **97** | 通过 | 1 个代码块无语言标记；章节较多但没有目录 |
| [`kentcdodds/cross-env`](https://github.com/kentcdodds/cross-env) | `9951937` | **92** | 通过 | 未在 README 中链接 `CONTRIBUTING.md`；缺少演示；2 个代码块无语言标记；没有目录 |
| [`chalk/chalk`](https://github.com/chalk/chalk) | `47fc05a` | **91** | 通过 | 仓库有 MIT LICENSE，但 README 没有许可证章节；未链接贡献指南；没有目录 |
| [`expressjs/express`](https://github.com/expressjs/express) | `0dee2c5` | **79** | 未通过 | README 没有 H1（仅 logo）；Quick Start 中的 npm start 不在本仓库的 `package.json` 脚本中 |

本仓库自身也跑同一套门禁：在 0.3.0 发布前，`readme-smith doctor . --min-score 85` 与 `readme-smith check . --min-score 85` 都是 **100/100**。

几点说明，避免把分数当成玄学：

- 浅克隆看不到完整提交历史，因此工具在无法判断 README 历史时把新鲜度记为中性满分，而不是猜一个“过期”。表中的新鲜度均为 10/10。
- Express 的 npm start 属于 `express-generator` 生成的应用，不是这个仓库自己的脚本。工具按“README 声明的命令必须能在本仓库清单中找到”判定，因此把它标为命令漂移；这类上下文歧义会以行列号原样展示，交由人判断。
- 除了 git 相关的新鲜度，评分和草稿都是确定性的；相同仓库状态会得到相同结果。

### 修复前后：Click

以 [`pallets/click`](https://github.com/pallets/click)（提交 `2247b35`）的 README 为例，在副本上执行确定性合并草稿，不启用 AI：

```bash
readme-smith doctor /tmp/click-demo --ai off     # 74/100
readme-smith draft  /tmp/click-demo --ai off --lang en
readme-smith apply  /tmp/click-demo
readme-smith doctor /tmp/click-demo --ai off     # 99/100
```

| 阶段 | 总分 | 完整性 | 可用性 | 准确性 | 可读性 | 新鲜度 |
| --- | --- | --- | --- | --- | --- | --- |
| 修复前 | **74** | 22/35 | 13/25 | 20/20 | 9/10 | 10/10 |
| 修复后 | **99** | 35/35 | 25/25 | 20/20 | 9/10 | 10/10 |

修复前工具指出的问题都是真实存在的：README 没有安装/环境准备章节、没有许可证章节（仓库实际是 BSD-3-Clause），并有 1 个代码块没有语言标记。合并草稿只补缺失章节和来自清单的安装命令，不改写原有文案；修复后只剩那个无语言标记的代码块，因此可读性仍是 9/10——工具没有把 99 分伪装成 100 分。

合并模式刻意不改写已有命令。如果想用基于事实的全新文档替换过期文案，请请求完整草稿：

```bash
readme-smith draft . --force --ai off
readme-smith diff . --show
readme-smith apply .
readme-smith doctor .
```

### SECURITY.md 实测

本仓库自带一份真实的 [SECURITY.md](SECURITY.md)。扫描器会把它记录为可核验的社区文件，而不是只存在于文档里的承诺：

```console
$ readme-smith scan . --json
"community": {
  "contributing": true,
  "changelog": true,
  "security": true,
  ...
}
```

README 的「安全与隐私」章节用 `mailto:` 指向维护者邮箱，并链接 `SECURITY.md`，不提供公开 issue 作为漏洞入口。`test/unit/governance.test.ts` 会验证文件存在、支持版本、私下报告邮箱和 README 链接；运行 `npm test` 即可复现。

## 命令

| 命令 | 作用 | 退出码 |
| --- | --- | --- |
| `readme-smith scan [path]` | 提取确定性事实表并打印 JSON。 | `0` 成功，`2` 项目类型无法识别 |
| `readme-smith draft [path]` | 写入 `README.draft.md`；绝不修改 `README.md`。 | `0` 成功，`2` 扫描/类型失败 |
| `readme-smith diff [path]` | 逐章节比较 `README.md` 与草稿。 | `0` 完全一致，`1` 有差异，`2` 错误或草稿缺失（与 `git diff --exit-code` 一致） |
| `readme-smith doctor [path]` | 评分完整性、可用性、准确性、可读性和新鲜度。 | `0` 通过，`1` 低于阈值，`2` 执行错误 |
| `readme-smith check [path]` | 为 CI 运行 doctor 加确定性草稿差异；`--changed` 额外检查受影响的工作区包。 | `0` 通过，`1` 失败，`2` 错误 |
| `readme-smith apply [path]` | 把草稿复制到 `README.md`，并创建备份。 | `0` 成功，`2` 草稿缺失或写入失败 |
| `readme-smith init [path]` | 写入带注释的 `.readme-smith.yaml`。 | `0` 成功 |

所有命令都接受仓库路径（默认当前目录）以及下面的全局选项。

| 选项 | 取值 | 含义 |
| --- | --- | --- |
| `--preset <name>` | `cli`、`lib`、`web`、`monorepo`、`dataset` | 强制指定预设，而不是自动检测。 |
| `--ai <backend>` | `local`、`openai`、`off` | 仅对 `draft` 生效；其它命令接受该选项但会忽略，`check` 始终使用 `off`。 |
| `--min-score <n>` | `0`–`100` | `doctor` 和 `check` 的阈值。 |
| `--json` | 标志 | 在 stdout 输出结构化数据，包括结构化错误。 |
| `--quiet` | 标志 | 只打印最终分数、结论或写入路径。 |
| `--verbose` | 标志 | 在 stderr 叙述事实提取过程。 |

命令专属选项：

| 命令 | 选项 | 含义 |
| --- | --- | --- |
| `draft` | `--lang auto\|en\|zh` | 草稿语言；`auto` 跟随现有 README。 |
| `draft` | `--force` | 生成完整草稿，并允许 AI 改写现有文案。 |
| `diff` | `--show` | 在章节摘要之外打印统一行摘录。 |
| `apply` | `--dry-run` | 只打印待执行的修改，不写入任何内容。 |
| `init` | `--force` | 覆盖现有配置文件。 |
| `check` | `--changed` | 同时评估清单或包 README 发生变化的工作区包。根 README 始终会被检查。 |
| `check` | `--base <ref>` | `--changed` 模式下用于比较的 git 修订。默认为 `HEAD^`。 |

## 草稿工作流

`readme-smith draft` 有两种模式：

- **合并模式**（README 已存在且语言未变化时的默认模式）：只追加缺失的章节。现有标题、文案和代码逐字节保留。
- **完整草稿**（新 README、`--force` 或语言变化）：预设或自定义模板基于事实渲染完整文档。只有此模式才可能使用 AI 文案，且仅限简介、最多四条功能要点，以及使用章节的引导句。

审阅和应用是两个独立步骤：

```bash
readme-smith draft .
readme-smith diff . --show       # 完全一致时退出 0，有差异时退出 1（与 git diff --exit-code 一致）
readme-smith apply . --dry-run   # 退出 0；不写入，也不创建备份
readme-smith apply .             # 备份到 .README.bak.md，然后替换 README.md
```

草稿缺失或不可读时，`readme-smith diff` 退出 `2`。没有草稿时，`readme-smith apply` 拒绝运行。应用完全相同的草稿是空操作。

## 评分

分数是五个维度的加权和。每个适用的检查都带部分分，未通过的检查会被压到低于其全部权重，避免四舍五入掩盖缺陷。

| 维度 | 默认权重 | 检查内容 |
| --- | --- | --- |
| 完整性 | 35 | 预设要求的标题、简介、安装、使用、许可证、贡献、演示和包章节 |
| 可用性 | 25 | 从清单推导的安装命令、可运行的使用示例、无命令漂移 |
| 准确性 | 20 | 脚本存在、环境变量存在、声明的许可证与仓库一致 |
| 可读性 | 10 | 唯一 H1、标题层级不跳级、代码围栏带语言标记、长文档有目录 |
| 新鲜度 | 10 | 最后一次 README 更新之后清单是否变化，依据 git 历史和工作区状态 |

预设会按上文调整权重。在配置中设置 `minScore` 或传入 `--min-score`。分数低于阈值时，`doctor` 和 `check` 退出 `1`。

### 权重可以是相对值

配置里的权重不必凑成 100。可以只写相对比例，例如 `2/1/1/1/1`、`3/2/2/1/1`，工具会用最大余数法把它们归一化为总和正好 100 的整数，因此满分仍然可以到达 100。只写部分维度时，其余维度继承预设默认值；把某个维度设为 `0` 可以把它从评分中排除。只有当所有权重都非法或全部为 0 时，整个权重块才回退到预设默认值，并在 stderr 给出警告。

`check` 比 `doctor` 更严格：项目类型未知、README 缺失、分数低于阈值，**或**已提交的 README 与确定性草稿不同，都会失败。最后一条规则正是用来抓住已经偏离当前事实的文案。

## 配置

运行 `readme-smith init` 创建 `.readme-smith.yaml`，然后只修改你需要的部分。该文件是可选的，默认值相同。`.readme-smith.yaml` 和 `.readme-smith.yml` 都会被识别。

```yaml
version: 1
preset: auto          # auto | cli | lib | web | monorepo | dataset
language: auto        # auto | en | zh
minScore: 80

ai:
  backend: local      # local | openai | off
  baseUrl: null       # OpenAI 兼容端点
  model: null         # 本地默认 llama3.2，openai 默认 gpt-4o-mini

weights:              # 任意相对值，会自动归一化到 100；设为 0 可排除
  completeness: 35
  usability: 25
  accuracy: 20
  readability: 10
  freshness: 10
```

| 环境变量 | 使用时机 |
| --- | --- |
| `OPENAI_API_KEY` | 仅在你显式选择 `--ai openai` 时使用。本地或离线运行绝不会读取它。 |

配置警告会打印到 stderr，绝不中止运行；无效值回退到默认值。权重会自动归一化，合计不必为 `100`；只有全部为 0 或全部非法时才整体回退到预设默认值。

## AI 边界

AI 是可选的，且范围很窄。它把事实块改写成三段文案：一段简介、最多四条功能要点，以及使用章节的引导句。它永远看不到你的源文件，也不能添加命令、参数、环境变量、API 名称、徽章、作者、版本或许可证。温度固定为 `0.2`。

| 后端 | 行为 |
| --- | --- |
| `local`（默认） | 与 `http://127.0.0.1:11434/v1` 的 OpenAI 兼容服务器通信（默认 Ollama）。不可用时回退到确定性模板并给出警告。 |
| `openai` | 显式选择云端。需要 `OPENAI_API_KEY`。事实块是唯一发送的项目数据。 |
| `off` | 不访问网络。所有内容都由事实渲染。`readme-smith check` 始终使用此模式。 |

每个 AI 字段都会独立对照事实表验证。未声明的脚本、未知环境变量、不支持的参数、错误的许可证声明、未知 URL、作者和版本声明都会被拒绝。被拒绝的字段会被丢弃，其余字段保留，并由确定性模板文案填补该字段；如果三个字段全部失败，整个响应会被丢弃并给出警告。缺失的事实会变成 `[verify]` 标记，而不是听起来合理的猜测。

AI 绝不会用于合并模式或 `readme-smith check`；请求 AI 需要 `--force`（或新建/语言变化的 README）。

## 自定义模板

在 `.readme-smith/templates/` 下添加 Markdown 文件即可覆盖预设：

- `cli.md` 适用于所有 CLI 草稿。
- 中文草稿中，`cli.zh.md` 优先于 `cli.md`。

```markdown
# {{displayName}}

{{description}}

## Installation

{{installBlock}}
```

可用变量都由事实支撑：`name`、`displayName`、`description`、`version`、`type`、`preset`、`primaryLanguage`、`license`、`licenseFile`、`repository`、`install`、`installConsumer`、`installDev`、`usage`、`binaries`、`entryPoints`、`packages`、`scripts`、`scriptsTable`、`env`、`envTable`、`data`、`testCommand`、`buildCommand`、`contributing`、`ci`、`stats` 和 `installBlock`。未知变量会替换为 `[verify]`，并作为警告报告。

新文档、`--force`，或 `--lang` 改变现有 README 的语言时，会使用自定义模板。普通合并模式中，内置预设只填补缺失的章节，逐字节保留你的文案。

## CI 集成

CLI 与 CI 平台无关。仓库以 GitHub Actions 为主，Gitee Go 配置作为镜像保留。

### GitHub Actions

`.github/workflows/` 中包含三条工作流：

| 工作流 | 触发条件 | 用途 |
| --- | --- | --- |
| `ci.yml` | push 到 `main`/`master`，以及任意 PR | 在 Node.js 22 上运行 `npm ci`、类型检查、构建、覆盖率门禁，并以 `--min-score 85` 运行 `doctor` 和 `check` |
| `readme-check.yml` | 修改 README、清单或工作流的 PR | 用仓库自带的 composite action 运行 changed-only 检查，默认阈值 `80` |
| `readme-proposal.yml` | 手动触发 | 生成 `README.draft.md`，并创建可审阅的拉取请求；不会直接修改 `README.md` |

仓库附带 composite action（`action.yml`），支持两种模式：

- `check` 运行 `readme-smith check`，在分数过低或草稿过期时使任务失败。结果写入 GitHub 步骤摘要。
- `proposal` 写入 `README.draft.md`，报告有多少章节需要处理，并保持 `README.md` 不变。随附的 `README proposal` 工作流随后从草稿创建可审阅的拉取请求；是否合并仍由人决定。

本仓库的 `readme-check.yml` 使用本地 action：

```yaml
name: README check
on: [pull_request]
permissions:
  contents: read
jobs:
  readme:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./
        with:
          mode: check
          min-score: "80"
          changed-only: "true"
          base: ${{ github.event.pull_request.base.sha }}
```

其他仓库可以直接引用带 tag 的 action：

```yaml
      - uses: yuvan-bit/readme-smith@v0.3.0
        with:
          mode: check
          min-score: "80"
```

使用 `changed-only: "true"` 时，根 README 仍会被检查，并且每个在 `base` 与 `HEAD` 之间清单或包 README 发生变化的工作区包，都会用根阈值和预设自动检测进行评估。action 通过 `affected-packages` 暴露被评估的包数量，`--json` 会在 `affected` 下报告每个包。对于拉取请求，请把 `base` 设为 PR 的 base SHA；否则默认使用 `HEAD^`。

action 的输入是 `mode`、`path`、`min-score`、`lang`、`ai`、`changed-only` 和 `base`。只有 `check` 模式使用 `changed-only` 和 `base`。本仓库的主 CI 使用 `--min-score 85`，比 CLI、action 和 `readme-check.yml` 的默认值 `80` 更严格，为合并前的评分波动留出余量；其它项目可以按需统一为 `80`。

action 会从检出的源码构建 CLI，因此 action 本身不依赖 npm 发布。对于其他仓库，也可以直接安装 CLI：

```bash
npm install --save-dev readme-smith
npx readme-smith check . --min-score 80
```

`npm run ci` 在本地复现主 CI 的检查：

```bash
npm run typecheck
npm run test:coverage
node dist/cli.js doctor . --min-score 85
node dist/cli.js check . --min-score 85
```

### Gitee Go（镜像配置，待开通）

`.workflow/` 中定义了两条与主 CI 等价的流水线：

| 文件 | 触发条件 | 用途 |
| --- | --- | --- |
| `.workflow/master-pipeline.yml` | push 到 `master` | 主干验证 |
| `.workflow/pr-pipeline.yml` | 向 `master` 发起或更新 PR | 合并前验证 |

两条流水线都在 Node.js 22.14.0 上执行 `npm ci && npm run ci`。Gitee Go 是 Gitee 的增值服务，需要先在仓库的「流水线」页面开通；**当前尚未开通，因此没有 Gitee Go 的实际运行记录**。在开通前，流水线文件只是可审阅的镜像配置，本地和 GitHub Actions 的结果不受影响。

用于 pre-commit 时，安装 CLI 并添加钩子：

```yaml
repos:
  - repo: https://github.com/yuvan-bit/readme-smith
    rev: v0.3.0
    hooks:
      - id: readme-smith
        args: ["--min-score", "80"]
```

CI 检出较浅时，请设置 `fetch-depth: 2`（或更大）；新鲜度依赖最近的提交历史。`changed-only` 还需要比较基准存在于历史中，因此请使用 `fetch-depth: 0` 或显式获取基准引用。

`check` 会识别 head 提交信息中的 `#rf-skip` 标记：问题仍会报告，但门禁会通过，以便人工审阅例外。请谨慎使用。

## JSON 输出

`--json` 让所有命令都可被机器读取，并把人类可读的叙述保留在 stderr。错误使用相同的信封，因此脚本也能解析失败：

```json
{
  "error": {
    "code": "invalid_min_score",
    "message": "--min-score must be an integer between 0 and 100 (got 101).",
    "exitCode": 2
  }
}
```

报告包含相对路径而非绝对路径，并且绝不包含环境变量的值。`scan --json --quiet` 适合通过管道传给 `jq` 或其他工具。

使用 `check --changed` 时，报告还包含 `base` 和 `affected` 数组。每个条目有 `path`、`score`、`threshold`、`passed`、`skipped`、`reasons` 和 `missing`；包检查的原因会加上 `[packages/name]` 前缀。

## 编程接口

ESM 入口导出确定性流水线：

```js
import { scanFacts, scoreReadme, buildDraft, computeDiff } from 'readme-smith';

const facts = scanFacts({ root: process.cwd(), skipGit: false });
const draft = await buildDraft({
  root: process.cwd(),
  facts,
  preset: facts.project.type === 'unknown' ? 'lib' : facts.project.type,
  language: 'en',
  ai: { backend: 'off', baseUrl: null, model: null },
});
console.log(draft.markdown);
```

主要导出包括 `scanFacts`、`detectProjectType`、`analyseReadme`、`analyseCodeCommands`、`scoreReadme`、`computeFreshness`、`buildDraft`、`mergeDraft`、`requestCopy`、`validateProse`、`computeDiff`、`defaultWeights` 以及配置辅助函数。

## 安全与隐私

- **无遥测。** readme-smith 没有账号系统、分析或上传步骤。
- **不上传源码。** 显式启用 AI 时，它只接收事实块。`--ai off` 绝不打开网络连接。
- **不记录密钥值。** 扫描器只记录环境变量名称及其来源文件，绝不记录值。
- **无静默写入。** `scan`、`doctor`、`diff` 和 `check` 都是只读的。`draft` 只写 `README.draft.md`。`apply` 是显式操作，并保留 `.README.bak.md`。
- **确定性（`--ai off` 时）。** 除 git 新鲜度外，相同的仓库状态产生相同的事实、分数和草稿；启用 AI 时，只有简介、功能要点和使用引导句可能不同，并且仍会逐字段接受事实校验。
- **漏洞私下报告。** 请发送邮件至 [yuwan41064@gmail.com](mailto:yuwan41064@gmail.com)，不要在公开 issue 中附带复现细节；处理流程见 [SECURITY.md](SECURITY.md)。

## 故障排查

| 症状 | 原因与修复 |
| --- | --- |
| 退出码 `2`，提示 “project type is unknown” | 添加受支持的清单文件，或用 `--preset` 强制指定。 |
| `doctor` 通过但 `check` 失败 | `check` 还要求 README 与确定性草稿一致。运行 `readme-smith draft`，审阅 `readme-smith diff`，然后 `readme-smith apply`；仅在有意例外时使用 `#rf-skip`。 |
| 草稿添加了章节，但错误的命令仍在 | 合并模式保留现有文案。请自行修改，或用 `readme-smith draft . --force` 生成完整草稿。 |
| AI 警告后端不可用 | 启动本地 OpenAI 兼容服务器、配置 `ai.baseUrl`，或使用 `--ai off` 获得确定性输出。 |
| CI 上新鲜度看起来不对 | 浅克隆隐藏历史。看不到 README 历史时工具会把新鲜度记为中性，而不是误报过期；需要精确判断时设置 `fetch-depth: 2` 或更深。 |
| `check --changed` 以 `git_base_not_found` 退出 `2` | 比较修订在检出中不存在。请获取 PR 基准（或传入有效的 `--base`）。 |
| 配置警告权重问题 | 权重可以是任意相对值，会自动归一化到 100；只有全部为 0 或全部非法时才回退默认值。 |
| `diff` 退出 `1` | README 与草稿之间存在差异。运行 `readme-smith diff . --show` 查看章节摘要与统一摘录。 |
| `diff` 退出 `0` | README 与草稿完全一致。这是“已经同步”的情况。 |

## 项目结构

- `src/facts/` — 针对清单、语言、脚本、二进制、环境变量、配置文件、CI 工作流、构建命令和许可证的确定性检测器。
- `src/readme/` — README 解析器和五维评分器。
- `src/draft/` — 内置模板、自定义模板、仅合并缺失内容的逻辑，以及可选的 AI 边界。
- `src/diff/` — 章节级差异和统一摘录。
- `src/ci/` — 从变更文件到受影响工作区包的确定性映射。
- `src/commands/` — 每个 CLI 命令一个模块，包括退出码。
- `.github/` — 主 CI：GitHub Actions、composite action 示例、issue 表单和拉取请求模板。
- `.workflow/` — Gitee Go 主干与 PR 流水线的镜像配置（待开通）。
- `.gitee/` — Gitee 专用的 issue 表单和拉取请求模板。
- `test/unit/` — 单元、黄金和端到端测试。
- `test/fixtures/` 和 `test/golden/` — 语言夹具和黄金事实快照。

## 开发

| 命令 | 用途 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npm run build` | 把 TypeScript 编译到 `dist/` |
| `npm test` | 运行 Node 测试套件 |
| `npm run test:coverage` | 带行、分支和函数覆盖率门禁运行测试（Node.js 22+） |
| `npm run typecheck` | 只做类型检查，不产出文件 |
| `npm run ci` | 本地运行与 GitHub Actions 主 CI 相同的类型检查、覆盖率、doctor 和 check |
| `npm run dev` | 变更时重新构建 |
| `npm run clean` | 删除 `dist/` 和 `dist-test/` |
| `npm run self:doctor` | 为本仓库评分 |
| `npm run self:check` | 对本仓库运行 CI 门禁 |

测试套件覆盖九个夹具（Node、Python、Rust、Go、Ruby、单仓库、Web、数据集和一个无法识别的项目）、黄金事实表、评分、权重归一化、HTML/大小写 README 解析、合并幂等性、差异语义、使用本地桩的 AI 校验、受影响包检测，以及每个 CLI 退出码。`npm run test:coverage` 强制执行至少 80% 行覆盖、70% 分支覆盖和 80% 函数覆盖；`npm run ci` 和 GitHub Actions 主 CI 都会调用同一命令。

### 版本与发布

版本号遵循 [Semantic Versioning](https://semver.org/)。每个发布版本都有对应的 `vX.Y.Z` git tag、GitHub Release 和 [CHANGELOG.md](CHANGELOG.md) 条目；变更日志按“新增 / 变更 / 修复 / 移除”分类，说明该版本实际改了什么。当前版本为 **0.3.0**，已发布到 npm；GitHub 主仓库、权重归一化、真实仓库实测和 `rf` 命令移除都记录在该条目中。

## 贡献

开发环境搭建、事实契约以及添加语言或生态检测器的步骤，请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。拉取请求应保持两条 dogfood 命令为绿色。

## 许可证

MIT。完整文本请参阅 [LICENSE](LICENSE)。
