import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEEPSEEK_API_BASE_URL,
  DEEPSEEK_MODEL,
  DEFAULT_CONFIG,
  GEMINI_MODEL,
  getApiKeyForEndpoint,
  normalizeConfig,
  stripApiKeysForStorage,
} from '../src/config';

test('config: 默认端点为 DeepSeek Flash 而不是本机 Agy', () => {
  assert.equal(DEFAULT_CONFIG.endpointType, 'deepseek');
  assert.equal(DEFAULT_CONFIG.apiBaseUrl, DEEPSEEK_API_BASE_URL);
  assert.equal(DEFAULT_CONFIG.model, DEEPSEEK_MODEL);
});

test('config: DeepSeek 端点不会继续使用旧 Gemini 模型名', () => {
  const normalized = normalizeConfig({
    endpointType: 'deepseek',
    model: 'gemini-3.8-flash-low',
  });
  assert.equal(normalized.model, DEEPSEEK_MODEL);

  const gemini = normalizeConfig({
    endpointType: 'gemini',
    model: 'deepseek-flash',
  });
  assert.equal(gemini.model, GEMINI_MODEL);
});

test('config: 显式 Agy 首选项保持为插件可选端点', () => {
  const preserved = normalizeConfig({
    endpointType: 'agy',
    agyPath: '/tmp/agy',
    model: 'legacy-agy-model',
    targetLanguage: '简体中文',
  });
  assert.equal(preserved.endpointType, 'agy');
  assert.equal(preserved.model, 'legacy-agy-model');
  assert.equal(preserved.agyPath, '/tmp/agy');
});

test('config: 云端 Key 按供应商隔离，本地端点清空活动 Key', () => {
  const migrated = normalizeConfig({ endpointType: 'deepseek', apiKey: 'legacy-deepseek-key' });
  assert.equal(migrated.deepseekApiKey, 'legacy-deepseek-key');
  assert.equal(migrated.apiKey, 'legacy-deepseek-key');
  assert.equal(getApiKeyForEndpoint(migrated), 'legacy-deepseek-key');

  const ollama = normalizeConfig({
    endpointType: 'openai',
    apiKey: 'must-not-leak',
    deepseekApiKey: 'deepseek-key',
  });
  assert.equal(ollama.apiKey, '');
  assert.equal(getApiKeyForEndpoint(ollama), '');
  assert.equal(ollama.deepseekApiKey, 'deepseek-key');
});

test('config: 切换供应商时不会把旧 apiKey 当成新供应商密钥', () => {
  const switched = normalizeConfig({
    endpointType: 'gemini',
    apiKey: 'stale-deepseek-key',
    deepseekApiKey: 'deepseek-key',
    geminiApiKey: '',
  });
  assert.equal(switched.geminiApiKey, '');
  assert.equal(switched.apiKey, '');
  assert.equal(getApiKeyForEndpoint(switched), '');
});

test('config: 写入 prefs 前清除所有 API Key 字段', () => {
  const config = normalizeConfig({
    endpointType: 'deepseek',
    apiKey: 'legacy-key',
    deepseekApiKey: 'deepseek-key',
    geminiApiKey: 'gemini-key',
  });
  const stored = stripApiKeysForStorage(config);
  assert.equal(stored.apiKey, '');
  assert.equal(stored.deepseekApiKey, '');
  assert.equal(stored.geminiApiKey, '');
  assert.equal(stored.endpointType, 'deepseek');
  assert.equal(stored.model, config.model);
});

test('config: 默认可执行文件使用 PATH 命令名而不是维护者绝对路径', () => {
  assert.equal(DEFAULT_CONFIG.agyPath, 'agy');
  assert.equal(DEFAULT_CONFIG.pdf2zhPath, 'pdf2zh');
  assert.match(DEFAULT_CONFIG.systemPrompt, /aligned/);
  assert.match(DEFAULT_CONFIG.systemPrompt, /cases/);
});
