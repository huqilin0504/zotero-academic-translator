# Zotero 学术论文翻译

一个面向 Zotero PDF 阅读器的学术翻译与论文问答插件。当前发布版本为 **1.0.49**，仓库地址：

<https://github.com/huqilin0504/zotero-academic-translator>

插件清单当前声明支持 Zotero `7.0` 至 `10.*`。Zotero 6 不在当前构建和测试范围内。

## 功能范围

- PDF 阅读器划词翻译：流式输出、LaTeX/KaTeX 公式渲染、译文复制。
- 划词提问和常驻 AI 助手侧边栏：显示当前论文元数据、摘要、当前选区和上下文对话。
- 多模态提问：可附加图片；图片会按所选服务的接口格式发送。
- Markdown 和数学公式渲染；Agy 问答使用独立 high worker，DeepSeek 问答请求使用 high reasoning，翻译路径保持低延迟。
- 问答输入：Enter 换行，Ctrl+Enter 发送；回答和历史对话可以复制。
- 本地持久化：最近 30 轮问答会保存到 Zotero 首选项，重启 Zotero 后可恢复；发送给 API 的上下文会额外限制为最近 6 轮，避免请求无限增长。
- PDF 全文翻译：调用外部 `pdf2zh`，支持中文单语/中英双语、后台任务、百分比进度、取消、自动打开译本和文内链接校验修复。

全文翻译和划词翻译是两条独立路径：全文翻译由 `pdf2zh` 子进程处理，不能把它当成划词翻译的单次 API 请求。

## 翻译引擎

在 Zotero 的插件设置页中选择“翻译引擎”。供应商切换后，设置页会展示对应的模型目录，也允许填写自定义模型。

| 模式 | 运行方式 | 需要的配置 |
| --- | --- | --- |
| DeepSeek | DeepSeek OpenAI 兼容接口 | API 地址、DeepSeek API Key、模型名 |
| Gemini | Gemini 原生流式接口 | Gemini API 地址、Gemini API Key、模型名 |
| 本机模型（agy） | 启动本机 `agy` CLI，并通过 `stream-json` 长连接通信 | `agy` 可执行文件、模型名 |
| 本机 Ollama | OpenAI 兼容的 Ollama 地址 | Base URL、已下载的模型名 |

当前默认值来自 [`src/defaults.json`](src/defaults.json)：DeepSeek、`https://api.deepseek.com`、模型 `deepseek-flash`、目标语言“简体中文”、KaTeX 开启、全文翻译并发数 6。

### Agy 会话行为

选择 `agy` 后，插件会在 Zotero 启动或保存设置后后台预热本机进程，不需要等到第一次划词才启动。普通翻译共用一个 low worker，问答使用独立的 high worker。

每个 worker 的 Agy `conversation_id` 会保存到 Zotero 首选项。下次启动会把它作为 `--conversation <ID>` 传回 Agy，继续以前的会话；如果会话已过期或失效，插件会清理旧 ID，并自动创建一次新会话。Agy 进程退出时，插件关闭时会清理进程。

这意味着：

- Agy 的会话历史由 Agy 服务本身维护；插件保存的是最近的会话 ID，不是完整的远端会话内容。
- 翻译 worker 和问答 worker 是两个不同的会话，避免 high/low 思考档位互相污染。
- 本机 Agy 是否支持图片，取决于实际启动的模型和 Agy 配置；插件会把图片路径作为受限上下文交给 Agy，无法打开时不会凭空猜测。

## 安装

### 从 GitHub Release 安装

打开仓库的 [Releases](https://github.com/huqilin0504/zotero-academic-translator/releases) 页面，下载当前版本的 `zotero-academic-translator-1.0.49.xpi`，然后在 Zotero 中执行：

`工具` → `插件` → 齿轮图标 → `从文件安装插件…`

也可以直接下载：[zotero-academic-translator-1.0.49.xpi](https://github.com/huqilin0504/zotero-academic-translator/releases/download/v1.0.49/zotero-academic-translator-1.0.49.xpi)

### 从源码打包

需要 Node.js 18+、npm 和 zip：

```bash
cd /absolute/path/to/plugin
npm install
npm run package
```

安装包会生成在：

- `zotero-academic-translator-1.0.49.xpi`：带版本号的安装包；
- `zotero-academic-translator.xpi`：同一安装包的稳定文件名副本。

## 设置

打开 `工具` → `文献翻译设置…`，可以配置：

- 翻译引擎、接口地址、模型和对应的 API Key；
- 目标语言、翻译提示词、自动划词翻译、KaTeX 和缓存条数；
- 全文翻译的中文单语/中英双语模式、并发任务数、`pdf2zh` 路径和完成后是否自动打开。

`agy` 和 `pdf2zh` 默认按系统 `PATH` 查找，也可以在设置页填写绝对路径。设置页的“检查环境”会实际执行 `--version` 探针，不会假设维护者电脑上的固定 home 路径。

可在终端先检查：

```bash
command -v agy
agy --version
command -v pdf2zh
pdf2zh --version
```

## 全文 PDF 翻译

从 Zotero PDF 附件的条目菜单选择 `全文翻译（高保真排版）…`。任务在后台队列运行，状态栏显示准备、解析、逐页翻译、排版和链接校验阶段。

全文翻译使用当前设置的供应商配置，并通过环境变量传给 `pdf2zh`：

- DeepSeek：`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`；
- Gemini：`GEMINI_API_KEY`、`GEMINI_MODEL`；
- Agy：`AGY_BIN`、`AGY_MODEL`、`AGY_WORKERS`；
- OpenAI/Ollama 兼容路径：使用 `OPENAI_BASE_URL`、`OPENAI_MODEL`。

全文翻译的服务路由由当前配置决定：DeepSeek、Gemini、Agy 和 OpenAI 兼容端点分别传给 pdf2zh 对应的服务名。Ollama 在设置页保存为 OpenAI 兼容端点，因此使用 `OPENAI_*` 环境变量。

同一个输出 PDF 路径会串行排队，避免两个任务同时覆盖译本。译文导入 Zotero 前后都会检查取消状态；如果在附件导入过程中取消，任务会显示“已取消（译文附件已导入）”，不会错误地标记为完成。

## pdf2zh 本地补丁

仓库中的 `scripts/patch_pdf2zh_*.py` 是针对本机已安装 `pdf2zh` 的可选补丁，用于图中文字保留、排版、标点校验和 Agy 翻译器行为。它们不会被打进 XPI，也不会自动修改其他用户的环境。

默认路径是维护者机器上的示例路径；在自己的机器上请显式传入实际文件：

```bash
python3 scripts/patch_pdf2zh_figure_text.py \
  --pdfinterp /absolute/path/to/pdf2zh/pdfinterp.py
python3 scripts/patch_pdf2zh_layout.py \
  --converter /absolute/path/to/pdf2zh/converter.py
python3 scripts/patch_pdf2zh_punctuation.py \
  --converter /absolute/path/to/pdf2zh/converter.py
python3 scripts/patch_pdf2zh_translator.py \
  --translator /absolute/path/to/pdf2zh/translator.py
```

`npm run patch:pdf2zh` 仍然保留为维护者本机的快捷入口；它使用脚本内的默认路径，不建议直接用于其他电脑。

## 许可证与第三方依赖

插件自有代码按 MIT 许可证发布，见 [`LICENSE`](LICENSE)。`pdf2zh` 不包含在 XPI 中，而是用户自行安装的外部程序；上游 PDFMathTranslate 使用 AGPL-3.0，四个本地补丁脚本也单独标记为 AGPL-3.0-only。KaTeX 公式样式和字体按其 MIT 许可证保留，完整归属和链接见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

不要把修改后的完整 `pdf2zh` 源码或二进制重新打进 XPI；如果要分发修改版 `pdf2zh`，必须同时提供对应源代码、保留上游版权/许可证声明并遵守 AGPL-3.0。

## 数据与隐私

- API Key、引擎配置、问答历史、翻译缓存和 Agy 会话 ID 存在本机 Zotero 首选项中。
- 选中的文字、问题和用户附加的图片会发送给当前选择的服务；服务端的保存策略由相应供应商决定。
- Agy 只使用插件传入的受限提示和图片路径；插件不会把其他本地路径主动写入提示词。
- 非 Agy 图片请求会在发送前临时写入 `/tmp/zotero-gemini-translator-images`，请求结束后清理；单张图片上限为 8 MiB。
- 插件不会把 API Key 写入 Gemini URL 查询参数，而是使用请求头；切换到 Agy、Ollama 等本地端点时不会携带旧的云端 Key。

## 工程结构

```text
plugin/
├── src/
│   ├── bootstrap.ts          Zotero 生命周期、阅读器事件、菜单和工具栏
│   ├── client.ts             DeepSeek/Gemini/Ollama/Agy 请求与流式解析
│   ├── assistantSidebar.ts   AI 助手侧边栏、对话历史和布局交互
│   ├── docTranslator.ts      pdf2zh 启动、进度、链接修复和输出路径
│   ├── docTranslateTasks.ts  全文翻译后台任务队列、取消和输出互斥
│   ├── markdownRenderer.ts   Markdown 安全渲染
│   ├── mathRenderer.ts       KaTeX 数学公式渲染
│   ├── persistentStore.ts    Zotero Prefs/localStorage 持久化适配
│   └── defaults.json         设置页和运行时共用的默认配置源
├── preferences.xhtml/js/css  Zotero 设置页
├── scripts/build.js          生成 CSS、KaTeX 字体、设置默认值和 bootstrap.js
├── scripts/package.js        构建并打包 XPI
├── scripts/patch_pdf2zh_*.py pdf2zh 本地补丁脚本
├── tests/                    TypeScript 单元/集成边界测试
└── manifest.json             Zotero 插件清单和更新地址
```

`bootstrap.js`、`src/stylesString.ts`、`preferences-defaults.js` 和 `fonts/` 中的部分内容由构建脚本生成。修改源码时优先修改 `src/` 或 `src/defaults.json`，不要只编辑生成文件。

## 本地开发与测试

```bash
# 类型检查 + 全部测试
npm test

# 重新生成 bootstrap.js、内嵌 CSS/KaTeX 字体和设置默认值
npm run build

# 监听 src/ 变化并持续构建
npm run dev

# 生成带版本号和稳定文件名的 XPI
npm run package
```

测试覆盖配置规范化、供应商 Key 隔离、Agy 参数/会话恢复、流式响应、Markdown/公式、助手历史、全文任务队列、PDF 排版参数、链接修复和 manifest 版本范围。

## 发布检查清单

当前仓库的发布元数据位于 `manifest.json` 和 `updates.json`。发布新版本时：

1. 同步修改 `package.json`、`manifest.json` 和 `src/defaults.json`（如默认配置发生变化），保持版本号一致。
2. 运行 `npm test` 和 `npm run package`。
3. 校验安装包哈希，并确认 `updates.json` 的 `update_hash` 与带版本号的 XPI 一致：

   ```bash
   sha256sum zotero-academic-translator-<version>.xpi
   ```

4. 创建同名 `v<version>` GitHub Release，上传带版本号的 XPI；稳定文件名只用于本地安装。
5. 推送 `main` 后检查 raw `updates.json` 和 Release 下载链接可访问。

文档修改不会改变现有 XPI；仅修改 README 时不应重新生成或替换发布资产。

## 常见问题

### 为什么切换到 Agy 后还需要登录或等待？

Agy 是本机 CLI，但其模型/会话能力仍由 Agy 的本机配置和登录状态决定。插件会后台预热并在失败时退避重试；可在设置页点击“检查环境”，再查看 Zotero debug log。

### 为什么重启后问答内容还在？

问答 UI 历史以论文条目身份保存在 Zotero 首选项中，最多保留最近 12 篇论文、每篇最近 30 轮。Agy 的远端连续上下文另由 `conversation_id` 恢复，两者是不同层次的持久化。

### 全文翻译需要先手动启动 pdf2zh 吗？

不需要。插件会在后台启动设置中的 `pdf2zh` 可执行文件；但必须已安装并且能被 `PATH` 找到，或在设置页填写绝对路径。

### 为什么安装包不支持 Zotero 6？

当前 manifest 的最低版本是 Zotero 7.0，运行时使用 Zotero 7 的 Subprocess、Reader 和 PreferencePanes 接口。若要支持 Zotero 6，需要单独实现兼容层并重新验证，不是 README 配置可以解决的。
