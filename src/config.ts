import { PluginConfig } from './types';
import sharedDefaults from './defaults.json';
import { readSecureApiKeys, writeSecureApiKeys } from './secretStore';

export const DEEPSEEK_API_BASE_URL = sharedDefaults.apiBaseUrl;
export const DEEPSEEK_MODEL = sharedDefaults.model;
export const GEMINI_MODEL = 'gemini-3.8-flash';

export const DEFAULT_SYSTEM_PROMPT = sharedDefaults.systemPrompt;

export const DEFAULT_CONFIG: PluginConfig = { ...sharedDefaults } as PluginConfig;

const LEGACY_DEEPSEEK_MODELS = new Set([
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
]);

let currentConfig: PluginConfig = { ...DEFAULT_CONFIG };

const PREF_PREFIX = 'extensions.gemini-translator.';

export function normalizeModelForEndpoint(endpointType: string, model: string): string {
  const normalized = String(model || '').trim();
  if (String(endpointType || '').trim().toLowerCase() === 'deepseek' &&
    LEGACY_DEEPSEEK_MODELS.has(normalized.toLowerCase())) {
    return DEEPSEEK_MODEL;
  }
  return normalized;
}

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

export function normalizeConfig(config: Partial<PluginConfig> = {}): PluginConfig {
  const merged = { ...DEFAULT_CONFIG, ...config } as PluginConfig;
  const hasProviderKeyFields = Object.prototype.hasOwnProperty.call(config, 'deepseekApiKey') ||
    Object.prototype.hasOwnProperty.call(config, 'geminiApiKey');
  const legacyApiKey = hasProviderKeyFields ? '' : String(config.apiKey ?? '').trim();
  const deepseekApiKey = String(merged.deepseekApiKey || '').trim()
    || (merged.endpointType === 'deepseek' ? legacyApiKey : '');
  const geminiApiKey = String(merged.geminiApiKey || '').trim()
    || (merged.endpointType === 'gemini' ? legacyApiKey : '');
  merged.deepseekApiKey = deepseekApiKey;
  merged.geminiApiKey = geminiApiKey;
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

export function getApiKeyForEndpoint(config: Pick<PluginConfig, 'endpointType' | 'apiKey' | 'deepseekApiKey' | 'geminiApiKey'>): string {
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

export function loadConfig(): PluginConfig {
  if (typeof Zotero !== 'undefined' && Zotero.Prefs) {
    try {
      const raw = Zotero.Prefs.get(`${PREF_PREFIX}config`);
      const parsed = typeof raw === 'string' && raw ? JSON.parse(raw) : {};
      const normalized = normalizeConfig(parsed);
      const secureResult = secureConfigFromStoredSecrets(normalized);
      currentConfig = secureResult.config;
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
