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

export interface ImageAttachment {
  name: string;
  mimeType: string;
  size: number;
  path?: string;
  dataUrl?: string;
}

export interface PluginConfig {
  endpointType: EndpointType;
  apiBaseUrl: string;
  apiKey: string;
  deepseekApiKey?: string;
  geminiApiKey?: string;
  model: string;
  agyPath?: string;
  targetLanguage: string;
  systemPrompt: string;
  enableKaTeX: boolean;
  cacheSize: number;
  autoTranslate: boolean;
  docTranslateMode?: 'mono' | 'dual';
  docTranslateThreads?: number;
  pdf2zhPath?: string;
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
