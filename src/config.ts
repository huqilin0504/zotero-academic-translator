import { PluginConfig } from './types';
import sharedDefaults from './defaults.json';

export const DEEPSEEK_API_BASE_URL = sharedDefaults.apiBaseUrl;
export const DEEPSEEK_MODEL = sharedDefaults.model;
export const GEMINI_MODEL = 'gemini-3.8-flash';

export const DEFAULT_SYSTEM_PROMPT = sharedDefaults.systemPrompt;

export const DEFAULT_CONFIG: PluginConfig = { ...sharedDefaults } as PluginConfig;

let currentConfig: PluginConfig = { ...DEFAULT_CONFIG };

const PREF_PREFIX = 'extensions.gemini-translator.';

/**
 * 规范化配置。DeepSeek 是新安装的默认端点，但显式选择的 Agy 仍保留为
 * 插件运行时的可选兼容引擎；它与本代理是否使用 Agy 无关。
 */
export function normalizeConfig(config: Partial<PluginConfig> = {}): PluginConfig {
  const merged = { ...DEFAULT_CONFIG, ...config } as PluginConfig;
  const legacyApiKey = String(config.apiKey ?? '').trim();
  const deepseekApiKey = String(merged.deepseekApiKey || '').trim()
    || (merged.endpointType === 'deepseek' ? legacyApiKey : '');
  const geminiApiKey = String(merged.geminiApiKey || '').trim()
    || (merged.endpointType === 'gemini' ? legacyApiKey : '');
  merged.deepseekApiKey = deepseekApiKey;
  merged.geminiApiKey = geminiApiKey;
  // apiKey 只保留当前云端供应商的兼容字段。本地端点永远清空，避免
  // 从旧 DeepSeek/Gemini 配置把 Bearer Token 带到 Ollama 或任意兼容地址。
  merged.apiKey = merged.endpointType === 'deepseek'
    ? deepseekApiKey
    : merged.endpointType === 'gemini'
      ? geminiApiKey
      : '';
  const model = String(merged.model || '').trim().toLowerCase();
  if (merged.endpointType === 'deepseek' && /^(gemini-|gpt-|qwen|llama|ollama|claude|agy-)/.test(model)) {
    merged.model = DEEPSEEK_MODEL;
  } else if (merged.endpointType === 'gemini' && /^(deepseek-|qwen|llama|ollama|gpt-|claude|agy-)/.test(model)) {
    merged.model = GEMINI_MODEL;
  }
  return merged;
}

/** 返回当前端点允许发送的密钥；本地 Agy/Ollama/兼容端点永不携带云端 Key。 */
export function getApiKeyForEndpoint(config: Pick<PluginConfig, 'endpointType' | 'apiKey' | 'deepseekApiKey' | 'geminiApiKey'>): string {
  if (config.endpointType === 'deepseek') return String(config.deepseekApiKey || config.apiKey || '').trim();
  if (config.endpointType === 'gemini') return String(config.geminiApiKey || config.apiKey || '').trim();
  return '';
}

/**
 * 从 Zotero 首选项加载配置，若不在 Zotero 环境中则返回当前内存配置
 */
export function loadConfig(): PluginConfig {
  if (typeof Zotero !== 'undefined' && Zotero.Prefs) {
    try {
      const raw = Zotero.Prefs.get(`${PREF_PREFIX}config`);
      if (typeof raw === 'string' && raw) {
        const parsed = JSON.parse(raw);
        currentConfig = normalizeConfig(parsed);
        // 一次性把旧版单字段 apiKey 迁移到供应商字段，并清掉本地端点
        // 不应继续持有的活动 Key，避免后续运行时意外读取旧值。
        if (JSON.stringify(parsed) !== JSON.stringify(currentConfig)) {
          Zotero.Prefs.set(`${PREF_PREFIX}config`, JSON.stringify(currentConfig));
        }
      }
    } catch (e) {
      Zotero.debug?.(`[Gemini Translator] 加载首选项失败，使用默认配置: ${e}`);
    }
  }
  return currentConfig;
}

/**
 * 保存配置到 Zotero 首选项与内存
 */
export function saveConfig(newConfig: Partial<PluginConfig>): PluginConfig {
  currentConfig = normalizeConfig({ ...currentConfig, ...newConfig });
  if (typeof Zotero !== 'undefined' && Zotero.Prefs) {
    try {
      Zotero.Prefs.set(`${PREF_PREFIX}config`, JSON.stringify(currentConfig));
    } catch (e) {
      Zotero.debug?.(`[Gemini Translator] 保存首选项失败: ${e}`);
    }
  }
  return currentConfig;
}

export function getConfig(): PluginConfig {
  return currentConfig;
}
