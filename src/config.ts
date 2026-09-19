import { PluginConfig } from './types';
import sharedDefaults from './defaults.json';
import { readSecureApiKeys, writeSecureApiKeys } from './secretStore';

export const DEEPSEEK_API_BASE_URL = sharedDefaults.apiBaseUrl;
export const DEEPSEEK_MODEL = sharedDefaults.model;
export const GEMINI_MODEL = 'gemini-3.8-flash';

export const DEFAULT_SYSTEM_PROMPT = sharedDefaults.systemPrompt;

export const DEFAULT_CONFIG: PluginConfig = { ...sharedDefaults } as PluginConfig;

// 这些名称曾经由旧版 API 使用，当前 DeepSeek API 已统一到 Flash/Pro
// 模型名。保留兼容迁移，但不改写当前仍有效的 deepseek-v4-pro。
const LEGACY_DEEPSEEK_MODELS = new Set([
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
]);

let currentConfig: PluginConfig = { ...DEFAULT_CONFIG };

const PREF_PREFIX = 'extensions.gemini-translator.';

/**
 * 返回可交给供应商 API 和各级缓存的稳定模型名。
 * 动态模型列表中的未知自定义模型保持原样，只有插件历史内置别名迁移。
 */
export function normalizeModelForEndpoint(endpointType: string, model: string): string {
  const normalized = String(model || '').trim();
  if (String(endpointType || '').trim().toLowerCase() === 'deepseek' &&
    LEGACY_DEEPSEEK_MODELS.has(normalized.toLowerCase())) {
    return DEEPSEEK_MODEL;
  }
  return normalized;
}

/** Remove secrets before a config object is serialized into Zotero.Prefs. */
export function stripApiKeysForStorage(config: PluginConfig): PluginConfig {
  return {
    ...config,
    apiKey: '',
    deepseekApiKey: '',
    geminiApiKey: '',
  };
}

function activeApiKey(config: PluginConfig): string {
  return config.endpointType === 'deepseek'
    ? String(config.deepseekApiKey || '').trim()
    : config.endpointType === 'gemini'
      ? String(config.geminiApiKey || '').trim()
      : '';
}

function secureConfigFromStoredSecrets(config: PluginConfig): {
  config: PluginConfig;
  available: boolean;
  migrated: boolean;
} {
  const secure = readSecureApiKeys();
  if (!secure.available) return { config, available: false, migrated: false };

  const legacyDeepSeek = String(config.deepseekApiKey || '').trim();
  const legacyGemini = String(config.geminiApiKey || '').trim();
  const deepseekApiKey = secure.deepseekApiKey || legacyDeepSeek;
  const geminiApiKey = secure.geminiApiKey || legacyGemini;
  const migrated = !secure.deepseekApiKey && !secure.geminiApiKey && Boolean(legacyDeepSeek || legacyGemini);

  // A legacy install may have the keys in prefs.js. Move them into the login
  // manager once, then keep only empty compatibility fields in prefs.js.
  if ((legacyDeepSeek || legacyGemini) && !writeSecureApiKeys({ deepseekApiKey, geminiApiKey })) {
    return { config, available: false, migrated: false };
  }

  const hydrated = {
    ...config,
    deepseekApiKey,
    geminiApiKey,
  };
  hydrated.apiKey = activeApiKey(hydrated);
  return { config: hydrated, available: true, migrated };
}

function persistConfig(config: PluginConfig, secureAvailable: boolean): void {
  if (typeof Zotero === 'undefined' || !Zotero.Prefs) return;
  const value = secureAvailable ? stripApiKeysForStorage(config) : config;
  Zotero.Prefs.set(`${PREF_PREFIX}config`, JSON.stringify(value));
}

/**
 * 规范化配置。DeepSeek 是新安装的默认端点，但显式选择的 Agy 仍保留为
 * 插件运行时的可选兼容引擎；它与本代理是否使用 Agy 无关。
 */
export function normalizeConfig(config: Partial<PluginConfig> = {}): PluginConfig {
  const merged = { ...DEFAULT_CONFIG, ...config } as PluginConfig;
  // 只有完全没有供应商字段时才把旧版单字段 apiKey 当作迁移来源。
  // 这样从 DeepSeek 切到 Gemini 的部分更新不会把旧 Key 误认成 Gemini Key。
  const hasProviderKeyFields = Object.prototype.hasOwnProperty.call(config, 'deepseekApiKey') ||
    Object.prototype.hasOwnProperty.call(config, 'geminiApiKey');
  const legacyApiKey = hasProviderKeyFields ? '' : String(config.apiKey ?? '').trim();
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
  merged.model = normalizeModelForEndpoint(merged.endpointType, merged.model);
  return merged;
}

/** 返回当前端点允许发送的密钥；本地 Agy/Ollama/兼容端点永不携带云端 Key。 */
export function getApiKeyForEndpoint(config: Pick<PluginConfig, 'endpointType' | 'apiKey' | 'deepseekApiKey' | 'geminiApiKey'>): string {
  // 若供应商字段存在但为空，表示用户明确清除了该供应商的 Key，不能再
  // 回退到可能属于另一供应商的旧 apiKey。旧版调用方未提供供应商字段时
  // 才允许使用兼容字段。
  if (config.endpointType === 'deepseek') {
    return Object.prototype.hasOwnProperty.call(config, 'deepseekApiKey')
      ? String(config.deepseekApiKey || '').trim()
      : String(config.apiKey || '').trim();
  }
  if (config.endpointType === 'gemini') {
    return Object.prototype.hasOwnProperty.call(config, 'geminiApiKey')
      ? String(config.geminiApiKey || '').trim()
      : String(config.apiKey || '').trim();
  }
  return '';
}

/**
 * 从 Zotero 首选项加载配置，若不在 Zotero 环境中则返回当前内存配置
 */
export function loadConfig(): PluginConfig {
  if (typeof Zotero !== 'undefined' && Zotero.Prefs) {
    try {
      const raw = Zotero.Prefs.get(`${PREF_PREFIX}config`);
      const parsed = typeof raw === 'string' && raw ? JSON.parse(raw) : {};
      const normalized = normalizeConfig(parsed);
      const secureResult = secureConfigFromStoredSecrets(normalized);
      currentConfig = secureResult.config;
      // 供应商密钥进入 Zotero 的登录管理器后，prefs.js 只保留空字段。
      // 若当前 Gecko 环境没有登录管理器，则仅保留已有旧值用于升级兼容；
      // 新配置保存会拒绝把新的明文 Key 写入 prefs.js。
      const storedConfig = secureResult.available
        ? stripApiKeysForStorage(currentConfig)
        : currentConfig;
      if (JSON.stringify(parsed) !== JSON.stringify(storedConfig)) {
        persistConfig(currentConfig, secureResult.available);
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
      const deepseekApiKey = String(currentConfig.deepseekApiKey || '').trim();
      const geminiApiKey = String(currentConfig.geminiApiKey || '').trim();
      const secureAvailable = readSecureApiKeys().available;
      if ((deepseekApiKey || geminiApiKey) &&
        (!secureAvailable || !writeSecureApiKeys({ deepseekApiKey, geminiApiKey }))) {
        throw new Error('安全密钥存储不可用，未保存 API Key');
      }
      // 即便当前没有 Key，也清理登录管理器中的旧值；不把敏感字段重新
      // 写回 prefs.js。已有旧版明文配置只会在 loadConfig 中读取并迁移。
      if (secureAvailable && !deepseekApiKey && !geminiApiKey &&
        !writeSecureApiKeys({ deepseekApiKey: '', geminiApiKey: '' })) {
        throw new Error('安全密钥存储不可用，未清理 API Key');
      }
      persistConfig(currentConfig, secureAvailable);
    } catch (e) {
      Zotero.debug?.(`[Gemini Translator] 保存首选项失败: ${e}`);
    }
  }
  return currentConfig;
}

export function getConfig(): PluginConfig {
  return currentConfig;
}
