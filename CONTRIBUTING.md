# 为 readme-smith 做贡献

感谢你帮助 README 少一些错误。这个项目刻意保持小而确定，因此最有价值的贡献是有证据支撑的检测器、测试和文档，而不是新的文案生成器。

## 开发环境

运行时需要 Node.js 18.17 或更新版本；开发和测试建议使用 Node.js 22（与 `.workflow/` 中的 Gitee Go 流水线、GitHub Actions 工作流一致，`npm run test:coverage` 的覆盖率参数也要求 22+）。

```bash
npm install
npm run build
npm test
```

开发期间：

```bash
npm run dev          # tsc --watch
npm run typecheck    # 不产出文件
node dist/cli.js scan test/fixtures/node-cli
```

测试套件使用 Node 测试运行器和黄金文件。它没有网络依赖；AI 测试会启动本地桩服务器。`npm test` 会先清理并重新构建 `dist/` 与 `dist-test/`，因此分支切换后残留的旧编译产物不会造成假失败。测试源码统一位于 `test/unit/`。

## 不可谈判的规则

1. **事实绝不编造。** 如果仓库无法证明某个值，该事实就是 `null`，草稿使用 `[verify]`。不要添加猜测描述、命令、参数、环境变量、许可证或作者的兜底逻辑。
2. **绝不隐式修改 README.md。** `draft`、`diff`、`doctor` 和 `check` 只读取它。只有 `apply` 写入，并会先创建 `.README.bak.md`。
3. **AI 只改写事实。** 提示词包含事实块，绝不包含源文件。校验器拒绝的内容都会回退到确定性模板。
4. **提交中不得包含密钥。** 不要添加令牌、密钥、`.env` 文件或包含凭据的截图。

## 架构地图

| 路径 | 职责 |
| --- | --- |
| `src/facts/` | 遍历仓库并构建事实表。每个检测器都是纯函数且基于文件系统。 |
| `src/readme/parse.ts` | 解析标题、围栏代码块、命令、环境变量和标准章节。 |
| `src/readme/score.ts` | 五个加权维度：完整性、可用性、准确性、可读性、新鲜度。 |
| `src/draft/templates.ts` | 仅由事实渲染的内置中英文预设。 |
| `src/draft/merge.ts` | 保留现有章节；只追加缺失内容。 |
| `src/draft/ai.ts` | 可选的 OpenAI 兼容文案改写，以及事实校验器。 |
| `src/diff/structured.ts` | 章节级差异和统一摘录。 |
| `src/commands/` | 每个 CLI 命令一个模块；退出码也在这里。 |
| `.workflow/` | Gitee Go 的 master push 与 PR 流水线；两者都运行 `npm ci && npm run ci`。 |
| `.gitee/` | Gitee issue 表单和拉取请求模板。 |
| `.github/` | 可选的 GitHub Actions、issue 表单和拉取请求模板。 |
| `test/unit/` | 单元、黄金和端到端测试（编译到 `dist-test/`）。 |
| `test/fixtures/`、`test/golden/` | 语言夹具和黄金事实快照。 |

## 添加语言或生态检测器

添加一门语言通常需要两处改动：统计和清单元数据。

1. **语言统计** — 在 `src/facts/languages.ts` 的 `EXTENSION_MAP`（无扩展名文件用 `BASENAME_MAP`）中添加或扩展条目。颜色和权重字段要保持合理；权重会影响主语言百分比。
2. **清单** — 添加解析器和检测条目：
   - `src/facts/manifests.ts` 中的 `detectManifests()` 和 `pickEcosystem()` 声明哪些文件存在，以及哪个生态胜出。
   - 实现 `parseX()`，返回共享的 `ManifestResult`：名称、显示名、版本、描述、许可证、依赖、脚本、入口、二进制、工作区包和发布状态。
   - 仅当清单本身声明可执行文件（或存在真实二进制目标，如 Cargo 的 `src/main.rs` 和 Go 的 `package main`）时才设置 `binNames`。
3. **安装与使用** — 在同一文件中教会 `installCommandFor()` 消费者和开发安装命令。使用方式会自动从声明的二进制或 `dev`/`start` 脚本推导；不要添加文案。
4. **夹具** — 在 `test/fixtures/<name>/` 下添加一个真实项目，包含清单、小型源文件、许可证和 README。它不得包含密钥、生成的构建产物，或手动运行 CLI 留下的 `README.draft.md` / `.README.bak.md`。
5. **测试** — 在 `test/unit/facts.test.ts` 中添加断言，并把夹具加入 `GOLDEN_CASES`。有意重新生成黄金事实：

   ```bash
   npm run build:test
   UPDATE_GOLDEN=1 node --test "dist-test/test/unit/facts.test.js"
   git diff test/golden
   ```

6. **端到端验证**：

   ```bash
   node dist/cli.js scan test/fixtures/<name> --json
   node dist/cli.js doctor test/fixtures/<name> --json
   node dist/cli.js draft test/fixtures/<name> --ai off
   ```

如果检测器无法证明某个事实，请返回 `null` 并添加警告。缺失的事实胜过自信的谎言。

## 修改评分或模板

- 每条评分规则都需要测试。每个预设的权重仍必须合计为 100。
- 模板必须基于事实，并使用分析器识别的中英文标题（`Installation`/`安装`、`Usage`/`使用`、`Configuration`/`配置`、`License`/`许可证`）。
- 没有缺失章节时，合并模式草稿必须逐字节返回输入。幂等性由测试覆盖；请保持这一点。
- 如果修改内置模板，请对 `test/fixtures/node-cli`、`monorepo` 和 `dataset` 运行 CLI，并检查 `rf diff --show`。

## 提交和拉取请求

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
feat(facts): detect uv workspaces
fix(score): never round a failing check to full credit
docs: explain the AI privacy boundary
test(diff): cover insertion line numbers
```

## 持续集成

Gitee Go 配置位于 `.workflow/`：push 到 `master` 触发 `master-pipeline.yml`，向 `master` 发起或更新 PR 触发 `pr-pipeline.yml`。两者都在 Node.js 22.14.0 上运行：

```bash
npm ci
npm run ci
```

Gitee Go 是 Gitee 的增值服务，需要先在仓库的「流水线」页面开通；未开通时流水线不会执行，但本地命令仍然有效。GitHub Actions 的对应工作流位于 `.github/workflows/`，只在 GitHub 上运行。

打开拉取请求之前，至少运行：

```bash
npm run ci
```

`npm run ci` 依次执行 `npm run typecheck`、`npm run test:coverage`、`node dist/cli.js doctor . --min-score 85` 和 `node dist/cli.js check . --min-score 85`。最后两条命令是项目在自我 dogfood，使用 85 作为比默认 80 更严的自检阈值。输出发生变化时，请把结果包含在 PR 描述中。保持拉取请求聚焦；混合重构和行为变更很难审阅。参与讨论和贡献即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 报告缺陷

使用 issue 模板，并包含：

- 你运行的命令（相关时加上 `--verbose`），
- 退出码，
- `rf scan --json` 中相关的事实 JSON（必要时遮盖路径），
- 你期望的结果。

请不要粘贴专有源码或凭据。最小夹具是最好的复现方式。安全漏洞不要提交公开 issue，请按 [SECURITY.md](SECURITY.md) 通过邮件私下报告。

## 许可证

通过贡献，你同意你的贡献按 [LICENSE](LICENSE) 中的 MIT 许可证授权。
