# Zotero Academic Translator

Zotero 7 学术论文翻译与 AI 阅读助手插件，支持划词翻译、公式渲染、图片问答和 PDF 全文翻译。

## 开发

```bash
npm install
npm test
npm run package
```

打包产物为 `zotero-academic-translator-<version>.xpi`。当前发布版本保持为 `1.0.49`。

## 安装

在 Zotero 的插件管理器中选择“从文件安装插件”，打开对应的 `.xpi` 文件。

## API 配置

插件支持 DeepSeek、Gemini 和 OpenAI 兼容端点。API Key 仅保存在 Zotero 本地首选项中；Gemini 请求通过 `x-goog-api-key` 请求头发送，不放入 URL。

## 自动更新

更新清单位于 `updates.json`，由 GitHub Raw 提供，发布资产通过 GitHub Release 提供。
