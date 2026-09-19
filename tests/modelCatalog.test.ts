import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchProviderModels } from '../src/modelCatalog';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port)));
}

test('model catalog: DeepSeek 通过 /v1/models 和 Bearer Key 读取模型', async () => {
  let receivedAuthorization = '';
  let receivedPath = '';
  const server = http.createServer((request, response) => {
    receivedAuthorization = String(request.headers.authorization || '');
    receivedPath = String(request.url || '');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'deepseek-flash', object: 'model' },
        { id: 'deepseek-v4-pro', object: 'model' },
      ],
    }));
  });
  const port = await listen(server);
  try {
    const result = await fetchProviderModels({
      endpointType: 'deepseek',
      apiBaseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'deepseek-test-key',
    });
    assert.equal(result.available, true);
    assert.deepEqual(result.models.map((model) => model.value), ['deepseek-flash', 'deepseek-v4-pro']);
    assert.equal(receivedPath, '/v1/models');
    assert.equal(receivedAuthorization, 'Bearer deepseek-test-key');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('model catalog: Gemini 过滤不支持 generateContent 的模型并使用请求头鉴权', async () => {
  let receivedKey = '';
  let receivedPath = '';
  const server = http.createServer((request, response) => {
    receivedKey = String(request.headers['x-goog-api-key'] || '');
    receivedPath = String(request.url || '');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      models: [
        { name: 'models/gemini-embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
      ],
    }));
  });
  const port = await listen(server);
  try {
    const result = await fetchProviderModels({
      endpointType: 'gemini',
      apiBaseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'gemini-test-key',
    });
    assert.equal(result.available, true);
    assert.deepEqual(result.models.map((model) => model.value), ['gemini-3.8-flash']);
    assert.equal(result.models[0].label, 'Gemini 3.8 Flash (gemini-3.8-flash)');
    assert.equal(receivedPath, '/v1beta/models?pageSize=1000');
    assert.equal(receivedKey, 'gemini-test-key');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('model catalog: Ollama 读取本机 /api/tags，云端 Key 缺失时不发起请求', async () => {
  let requestCount = 0;
  let receivedPath = '';
  const server = http.createServer((_request, response) => {
    requestCount += 1;
    receivedPath = String(_request.url || '');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'gemma3:4b' }] }));
  });
  const port = await listen(server);
  try {
    const ollama = await fetchProviderModels({
      endpointType: 'ollama',
      apiBaseUrl: `http://127.0.0.1:${port}`,
    });
    assert.equal(ollama.available, true);
    assert.deepEqual(ollama.models.map((model) => model.value), ['qwen3:8b', 'gemma3:4b']);
    assert.equal(receivedPath, '/api/tags');
    assert.equal(requestCount, 1);

    const missingKey = await fetchProviderModels({
      endpointType: 'deepseek',
      apiBaseUrl: `http://127.0.0.1:${port}`,
    });
    assert.equal(missingKey.available, false);
    assert.match(missingKey.detail, /API Key/);
    assert.equal(requestCount, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
