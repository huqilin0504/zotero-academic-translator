export type EndpointType = 'agy' | 'openai' | 'gemini' | 'deepseek';
export type DocumentTranslationService =
  | 'agy'
  | 'openai'
  | 'deepseek'
  | 'ollama'
  | 'gemini'
  | 'google'
  | 'bing'
  | 'modelscope';

/**
 * 由问答面板上传、并交给模型查看的本地图片。
 *
 * Agy 的 headless stream-json 目前只接受文本块，因此旧 Agy 路径使用
 * path 让本机 agent 的图片/文件查看工具读取图片；HTTP 路径使用 dataUrl
 * 发送原生多模态内容。
 */
export interface ImageAttachment {
  name: string;
  mimeType: string;
  size: number;
  path?: string;
  dataUrl?: string;
}

export interface PluginConfig {
  /** 接口类型：deepseek (官方 OpenAI 兼容接口)、openai (兼容 Ollama/本地代理)、gemini 或旧版 agy */
  endpointType: EndpointType;
  /** API 基础请求地址，例如 https://api.deepseek.com、http://127.0.0.1:11434/v1 或 Gemini 地址 */
  apiBaseUrl: string;
  /** API 密钥，DeepSeek/Gemini 云端直连需要填写 */
  apiKey: string;
  /** DeepSeek 专用密钥；切换到本地端点时不会发送 */
  deepseekApiKey?: string;
  /** Gemini 专用密钥；切换到本地端点时不会发送 */
  geminiApiKey?: string;
  /** 模型名称，例如 deepseek-flash, gemini-3.8-flash-low 或 gemma2 */
  model: string;
  /** agy 执行路径或 PATH 中的命令名，默认使用 agy */
  agyPath?: string;
  /** 目标语言，例如 "简体中文" */
  targetLanguage: string;
  /** 极速学术翻译专属 System Prompt */
  systemPrompt: string;
  /** 是否启用 KaTeX 渲染公式 */
  enableKaTeX: boolean;
  /** 内存 LRU 缓存容量，默认 500 条 */
  cacheSize: number;
  /** 是否划词后自动翻译（若为 false 则需点击翻译按钮） */
  autoTranslate: boolean;
  /** 全文翻译输出模式：'mono' (单语高保真排版) 或 'dual' (双语对照) */
  docTranslateMode?: 'mono' | 'dual';
  /** 全文翻译并发线程数。仅影响吞吐，不改变翻译提示或排版策略。 */
  docTranslateThreads?: number;
  /** pdf2zh 执行文件路径或 PATH 中的命令名，默认使用 pdf2zh */
  pdf2zhPath?: string;
  /** 全文翻译完成后是否自动在 Zotero 阅读器中打开 */
  docAutoOpen?: boolean;
}

export interface StreamCallbacks {
  onStart?: () => void;
  onChunk: (delta: string, accumulated: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

export interface TranslateResult {
  originalText: string;
  translatedText: string;
  fromCache: boolean;
  durationMs: number;
}

export interface DocTranslateProgress {
  stage: 'prepare' | 'extract' | 'translating' | 'typesetting' | 'done' | 'error';
  currentPage?: number;
  totalPages?: number;
  percent: number;
  message: string;
}

export interface DocTranslateOptions {
  inputPdfPath: string;
  outputDir?: string;
  mode?: 'mono' | 'dual';
  pages?: string;
  service?: DocumentTranslationService;
  onProgress?: (progress: DocTranslateProgress) => void;
  signal?: AbortSignal;
}
