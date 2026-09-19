import { getFetch } from './env';

export type ModelCatalogEndpoint = 'deepseek' | 'gemini' | 'ollama' | 'openai' | 'agy';

export interface ModelOption {
  value: string;
  label: string;
}

export interface ModelCatalogRequest {
  endpointType: ModelCatalogEndpoint | string;
  apiBaseUrl?: string;
  apiKey?: string;
}

export interface ModelCatalogResult {
  available: boolean;
  models: ModelOption[];
  detail: string;
}

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const MAX_MODEL_COUNT = 200;
const REQUEST_TIMEOUT_MS = 8000;

function cleanBaseUrl(value: string | undefined, fallback: string): string {
  const normalized = String(value || fallback).trim().replace(/\/+$/, '');
  return normalized.replace(/\/(?:chat\/completions|models|tags)$/i, '');
}

function modelId(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^models\//, '')
    .slice(0, 200);
}

function uniqueModels(models: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  const result: ModelOption[] = [];
  for (const model of models) {
    const value = modelId(model.value);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push({ value, label: model.label?.trim() || value });
    if (result.length >= MAX_MODEL_COUNT) break;
  }
  return result;
}

function requestFor(config: ModelCatalogRequest): { url: string; headers: Record<string, string> } | null {
  const endpoint = String(config.endpointType || '').trim().toLowerCase();
  const apiKey = String(config.apiKey || '').trim();
  if (endpoint === 'deepseek') {
    const base = cleanBaseUrl(config.apiBaseUrl, DEFAULT_DEEPSEEK_BASE_URL)
      .replace(/\/v1$/i, '');
    return {
      url: `${base}/v1/models`,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    };
  }
  if (endpoint === 'gemini') {
    const base = cleanBaseUrl(config.apiBaseUrl, DEFAULT_GEMINI_BASE_URL)
      .replace(/\/v1beta$/i, '');
    return {
      url: `${base}/v1beta/models?pageSize=1000`,
      headers: apiKey ? { 'x-goog-api-key': apiKey } : {},
    };
  }
  if (endpoint === 'ollama') {
    const base = cleanBaseUrl(config.apiBaseUrl, 'http://127.0.0.1:11434/v1');
    const url = `${base.replace(/\/v1$/i, '')}/api/tags`;
    return {
      url,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    };
  }
  if (endpoint === 'openai') {
    const base = cleanBaseUrl(config.apiBaseUrl, 'http://127.0.0.1:11434/v1');
    return {
      url: `${base}/models`,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    };
  }
  return null;
}

function parseModels(endpoint: string, payload: any): ModelOption[] {
  if (endpoint === 'gemini') {
    const models = Array.isArray(payload?.models) ? payload.models : [];
    return uniqueModels(models
      .filter((item: any) => {
        const methods = item?.supportedGenerationMethods || item?.supportedActions;
        return !Array.isArray(methods) || methods.includes('generateContent');
      })
      .map((item: any) => {
        const value = modelId(item?.baseModelId || item?.name);
        const displayName = String(item?.displayName || '').trim();
        return { value, label: displayName && displayName !== value ? `${displayName} (${value})` : value };
      }));
  }

  if (endpoint === 'ollama') {
    const models = Array.isArray(payload?.models) ? payload.models : [];
    return uniqueModels(models.map((item: any) => {
      const value = modelId(item?.name || item?.model || item?.id);
      return { value, label: value };
    }));
  }

  const models = Array.isArray(payload?.data) ? payload.data : [];
  return uniqueModels(models.map((item: any) => {
    const value = modelId(typeof item === 'string' ? item : item?.id || item?.name);
    const displayName = String(item?.displayName || '').trim();
    return { value, label: displayName && displayName !== value ? `${displayName} (${value})` : value };
  }));
}

/** Fetch the provider's current model list without ever putting the key in the URL. */
export async function fetchProviderModels(config: ModelCatalogRequest): Promise<ModelCatalogResult> {
  const endpoint = String(config.endpointType || '').trim().toLowerCase();
  if (endpoint === 'agy') {
    return { available: false, models: [], detail: 'agy 没有可读取的模型列表 API' };
  }
  if ((endpoint === 'deepseek' || endpoint === 'gemini') && !String(config.apiKey || '').trim()) {
    return { available: false, models: [], detail: '请先填写 API Key' };
  }

  const request = requestFor(config);
  if (!request) return { available: false, models: [], detail: '当前引擎不支持模型列表 API' };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const response = await getFetch()(
      request.url,
      {
        method: 'GET',
        headers: request.headers,
        ...(controller ? { signal: controller.signal } : {}),
      }
    );
    if (!response.ok) {
      return { available: false, models: [], detail: `模型列表请求失败（HTTP ${response.status}）` };
    }
    const payload = await response.json();
    const models = parseModels(endpoint, payload);
    if (!models.length) {
      return { available: false, models: [], detail: 'API 未返回可用于生成内容的模型' };
    }
    return { available: true, models, detail: `已读取 ${models.length} 个模型` };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return { available: false, models: [], detail: '读取模型列表超时' };
    }
    return { available: false, models: [], detail: '无法连接模型列表 API' };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
