(function () {
  'use strict';

  const PREF_KEY = 'extensions.gemini-translator.config';
  const SHARED_DEFAULTS = globalThis.GeminiTranslatorDefaults || {};
  const DEEPSEEK_API_BASE_URL = SHARED_DEFAULTS.apiBaseUrl || 'https://api.deepseek.com';
  const DEEPSEEK_MODEL = SHARED_DEFAULTS.model || 'deepseek-flash';
  const GEMINI_MODEL = 'gemini-3.8-flash';
  const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com';
  const DEFAULTS = Object.assign({}, SHARED_DEFAULTS);

  function providerApiKey(config, endpoint) {
    if (endpoint === 'deepseek') return String(config.deepseekApiKey || (config.endpointType === 'deepseek' ? config.apiKey : '') || '').trim();
    if (endpoint === 'gemini') return String(config.geminiApiKey || (config.endpointType === 'gemini' ? config.apiKey : '') || '').trim();
    return '';
  }

  function normalizeStoredConfig(config) {
    const normalized = Object.assign({}, DEFAULTS, config || {});
    const endpoint = normalized.endpointType === 'openai' ? 'ollama' : normalized.endpointType;
    const legacyKey = String(config?.apiKey || '').trim();
    if (!normalized.deepseekApiKey && endpoint === 'deepseek') normalized.deepseekApiKey = legacyKey;
    if (!normalized.geminiApiKey && endpoint === 'gemini') normalized.geminiApiKey = legacyKey;
    normalized.apiKey = providerApiKey(normalized, endpoint);
    return normalized;
  }

  // 供应商切换时展示与其接口匹配的常用模型。模型名仍允许自定义，避免
  // 本地 Ollama/Agy 的用户被静态列表限制；DeepSeek/Gemini 列表来自各自官方模型目录。
  const MODEL_CATALOG = {
    deepseek: [
      { value: 'deepseek-flash', label: 'deepseek-flash（多模态 / 快速）' },
      { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro（高质量文本）' },
    ],
    gemini: [
      { value: 'gemini-3.8-flash', label: 'gemini-3.8-flash（稳定 / 快速）' },
      { value: 'gemini-3.7-flash', label: 'gemini-3.7-flash（稳定）' },
      { value: 'gemini-3.6-flash', label: 'gemini-3.6-flash（稳定）' },
      { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash（低延迟）' },
      { value: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite（最快 / 低成本）' },
      { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro（复杂任务）' },
    ],
    agy: [
      { value: 'gemini-3.8-flash-low', label: 'gemini-3.8-flash-low（本机配置）' },
      { value: 'gemini-3.8-flash-high', label: 'gemini-3.8-flash-high（本机配置）' },
      { value: 'gemini-3.1-pro-high', label: 'gemini-3.1-pro-high（本机配置）' },
    ],
    ollama: [
      { value: 'qwen3:8b', label: 'qwen3:8b（常见本地模型）' },
      { value: 'gemma3:4b', label: 'gemma3:4b（常见本地模型）' },
      { value: 'llava:7b', label: 'llava:7b（本地多模态）' },
      { value: 'deepseek-r1:8b', label: 'deepseek-r1:8b（本地推理）' },
    ],
  };

  const MODEL_HINTS = {
    deepseek: 'DeepSeek 官方模型；deepseek-flash 支持图片输入，适合划词翻译和图片问答。',
    gemini: 'Gemini 官方模型；可在 Google 模型目录中确认区域与账号可用性。',
    agy: 'Agy 模型取决于本机 CLI 配置；列表仅作常用值提示。',
    ollama: 'Ollama 模型取决于本机已下载的模型；列表仅作常用值提示。',
  };

  function element(id) {
    return document.getElementById(id);
  }

  function readConfig() {
    let parsed = {};
    try {
      const raw = Zotero.Prefs.get(PREF_KEY);
      if (typeof raw === 'string' && raw) parsed = JSON.parse(raw) || {};
    } catch (err) {
      Zotero.debug?.('[Gemini Translator] 设置页读取首选项失败: ' + (err.message || err));
    }
    const config = normalizeStoredConfig(parsed);
    const model = String(config.model || '').trim().toLowerCase();
    if (config.endpointType === 'deepseek' && /^(gemini-|gpt-|qwen|llama|ollama|claude|agy-)/.test(model)) {
      config.model = DEEPSEEK_MODEL;
    } else if (config.endpointType === 'gemini' && /^(deepseek-|qwen|llama|ollama|gpt-|claude|agy-)/.test(model)) {
      config.model = GEMINI_MODEL;
    }
    return config;
  }

  function writeConfig(config) {
    Zotero.Prefs.set(PREF_KEY, JSON.stringify(config));
  }

  function setCheckbox(id, value) {
    const input = element(id);
    if (input) input.checked = Boolean(value);
  }

  function getCheckbox(id) {
    const input = element(id);
    return Boolean(input && input.checked);
  }

  function setValue(id, value) {
    const input = element(id);
    if (input) input.value = value == null ? '' : String(value);
  }

  function getValue(id) {
    const input = element(id);
    return input ? String(input.value || '').trim() : '';
  }

  function currentModelValue() {
    const select = element('gemini-translator-model');
    if (!select) return '';
    if (select.value === '__custom__') return getValue('gemini-translator-model-custom');
    return String(select.value || '').trim();
  }

  function setCustomModelVisibility(visible) {
    const row = element('gemini-translator-model-custom-row');
    if (row) row.hidden = !visible;
  }

  function likelyBelongsToAnotherProvider(endpoint, model) {
    const value = String(model || '').trim().toLowerCase();
    if (!value) return false;
    if (endpoint === 'deepseek') return /^(gemini-|gpt-|qwen|llama|ollama|claude|agy-)/.test(value);
    if (endpoint === 'gemini') return /^(deepseek-|qwen|llama|ollama|gpt-|claude|agy-)/.test(value);
    if (endpoint === 'ollama') return /^(deepseek-|gemini-|gpt-|claude|agy-)/.test(value);
    if (endpoint === 'agy') return /^(deepseek-|qwen|llama|ollama|gpt-|claude)/.test(value);
    return false;
  }

  function populateModelOptions(endpoint, preferredModel) {
    const select = element('gemini-translator-model');
    if (!select) return;
    const options = MODEL_CATALOG[endpoint] || [];
    const original = String(preferredModel || '').trim();
    const useDefault = !original || likelyBelongsToAnotherProvider(endpoint, original);
    const defaultValue = options[0]?.value || original;
    const selectedModel = useDefault ? defaultValue : original;
    while (select.firstChild) select.removeChild(select.firstChild);

    for (const item of options) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    }

    const isKnown = options.some((item) => item.value === selectedModel);
    if (!isKnown && selectedModel) {
      const customOption = document.createElement('option');
      customOption.value = '__custom__';
      customOption.textContent = '自定义模型…';
      select.appendChild(customOption);
      select.value = '__custom__';
      setValue('gemini-translator-model-custom', selectedModel);
      setCustomModelVisibility(true);
    } else {
      select.value = selectedModel || defaultValue;
      setValue('gemini-translator-model-custom', '');
      setCustomModelVisibility(false);
    }

    const hint = element('gemini-translator-model-hint');
    if (hint) hint.textContent = MODEL_HINTS[endpoint] || '可填写供应商提供的自定义模型名。';
  }

  function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  }

  function selectedEndpoint() {
    const select = element('gemini-translator-endpoint-type');
    return select && select.value ? select.value : 'deepseek';
  }

  function updateEndpointFields() {
    const endpoint = selectedEndpoint();
    const previousModel = currentModelValue();
    const label = element('gemini-translator-endpoint-label');
    const value = element('gemini-translator-endpoint-value');
    const keyRow = element('gemini-translator-api-key-row');
    const keyInput = element('gemini-translator-api-key');
    if (!label || !value || !keyRow) return;

    const previousEndpoint = value.dataset.endpoint;
    if (previousEndpoint === 'agy') value.dataset.agyValue = value.value;
    if (previousEndpoint === 'deepseek') value.dataset.deepseekValue = value.value;
    if (previousEndpoint === 'ollama') value.dataset.ollamaValue = value.value;
    if (previousEndpoint === 'gemini') value.dataset.geminiValue = value.value;
    if (keyInput && (previousEndpoint === 'deepseek' || previousEndpoint === 'gemini')) {
      keyInput.dataset[`${previousEndpoint}ApiKey`] = keyInput.value;
    }

    if (endpoint === 'agy') {
      label.value = 'agy 可执行文件';
      label.setAttribute('value', 'agy 可执行文件');
      value.value = value.dataset.agyValue || DEFAULTS.agyPath;
    } else if (endpoint === 'deepseek') {
      label.value = 'DeepSeek API 地址';
      label.setAttribute('value', 'DeepSeek API 地址');
      value.value = value.dataset.deepseekValue || DEEPSEEK_API_BASE_URL;
    } else {
      label.value = endpoint === 'gemini' ? 'Gemini API 地址' : '接口地址（Base URL）';
      label.setAttribute('value', label.value);
      value.value = endpoint === 'gemini'
        ? (value.dataset.geminiValue || GEMINI_API_BASE_URL)
        : (value.dataset.ollamaValue || 'http://127.0.0.1:11434/v1');
    }
    value.dataset.endpoint = endpoint;
    keyRow.hidden = endpoint !== 'gemini' && endpoint !== 'deepseek';
    if (keyInput) {
      keyInput.value = endpoint === 'deepseek'
        ? (keyInput.dataset.deepseekApiKey || '')
        : endpoint === 'gemini'
          ? (keyInput.dataset.geminiApiKey || '')
          : '';
      keyInput.setAttribute('aria-label', endpoint === 'gemini' ? 'Gemini API Key' : 'DeepSeek API Key');
    }
    populateModelOptions(endpoint, previousModel);
  }

  function loadIntoForm(config) {
    const endpoint = config.endpointType === 'openai' ? 'ollama' : (config.endpointType || 'deepseek');
    const select = element('gemini-translator-endpoint-type');
    if (select) select.value = ['agy', 'deepseek', 'ollama', 'gemini'].includes(endpoint) ? endpoint : 'deepseek';
    setValue('gemini-translator-endpoint-value', endpoint === 'agy'
      ? (config.agyPath || DEFAULTS.agyPath)
      : (config.apiBaseUrl || DEFAULTS.apiBaseUrl));
    const endpointInput = element('gemini-translator-endpoint-value');
    if (endpointInput) endpointInput.dataset.endpoint = endpoint;
    populateModelOptions(endpoint, config.model || DEFAULTS.model);
    const keyInput = element('gemini-translator-api-key');
    if (keyInput) {
      keyInput.dataset.deepseekApiKey = config.deepseekApiKey || (endpoint === 'deepseek' ? config.apiKey : '') || '';
      keyInput.dataset.geminiApiKey = config.geminiApiKey || (endpoint === 'gemini' ? config.apiKey : '') || '';
      keyInput.value = endpoint === 'deepseek'
        ? keyInput.dataset.deepseekApiKey
        : endpoint === 'gemini'
          ? keyInput.dataset.geminiApiKey
          : '';
    }
    setValue('gemini-translator-target-language', config.targetLanguage || DEFAULTS.targetLanguage);
    setValue('gemini-translator-system-prompt', config.systemPrompt || DEFAULTS.systemPrompt);
    setCheckbox('gemini-translator-auto-translate', config.autoTranslate);
    setCheckbox('gemini-translator-enable-katex', config.enableKaTeX);
    setValue('gemini-translator-cache-size', clampNumber(config.cacheSize, DEFAULTS.cacheSize, 0, 10000));
    setValue('gemini-translator-doc-mode', config.docTranslateMode === 'dual' ? 'dual' : 'mono');
    setValue('gemini-translator-doc-threads', clampNumber(config.docTranslateThreads, DEFAULTS.docTranslateThreads, 1, 16));
    setValue('gemini-translator-pdf2zh-path', config.pdf2zhPath || DEFAULTS.pdf2zhPath);
    setCheckbox('gemini-translator-doc-auto-open', config.docAutoOpen);
    updateEndpointFields();
  }

  function collectConfig() {
    const current = readConfig();
    const endpoint = selectedEndpoint();
    const endpointValue = getValue('gemini-translator-endpoint-value');
    const keyInput = element('gemini-translator-api-key');
    const enteredKey = getValue('gemini-translator-api-key');
    if (keyInput && (endpoint === 'deepseek' || endpoint === 'gemini')) {
      keyInput.dataset[`${endpoint}ApiKey`] = enteredKey;
    }
    const deepseekApiKey = endpoint === 'deepseek'
      ? enteredKey
      : String(keyInput?.dataset.deepseekApiKey || current.deepseekApiKey || '').trim();
    const geminiApiKey = endpoint === 'gemini'
      ? enteredKey
      : String(keyInput?.dataset.geminiApiKey || current.geminiApiKey || '').trim();
    const next = Object.assign({}, current, {
      endpointType: endpoint === 'ollama' ? 'openai' : endpoint,
      model: currentModelValue() || DEFAULTS.model,
      targetLanguage: getValue('gemini-translator-target-language') || DEFAULTS.targetLanguage,
      systemPrompt: getValue('gemini-translator-system-prompt') || DEFAULTS.systemPrompt,
      autoTranslate: getCheckbox('gemini-translator-auto-translate'),
      enableKaTeX: getCheckbox('gemini-translator-enable-katex'),
      cacheSize: clampNumber(getValue('gemini-translator-cache-size'), DEFAULTS.cacheSize, 0, 10000),
      docTranslateMode: getValue('gemini-translator-doc-mode') === 'dual' ? 'dual' : 'mono',
      docTranslateThreads: clampNumber(getValue('gemini-translator-doc-threads'), DEFAULTS.docTranslateThreads, 1, 16),
      pdf2zhPath: getValue('gemini-translator-pdf2zh-path') || DEFAULTS.pdf2zhPath,
      docAutoOpen: getCheckbox('gemini-translator-doc-auto-open'),
      deepseekApiKey,
      geminiApiKey,
      // 兼容旧版运行时代码，但本地端点必须明确清空活动 Key。
      apiKey: endpoint === 'deepseek' ? deepseekApiKey : endpoint === 'gemini' ? geminiApiKey : '',
    });

    if (endpoint === 'agy') {
      next.agyPath = endpointValue || DEFAULTS.agyPath;
    } else {
      next.apiBaseUrl = endpointValue || (endpoint === 'deepseek' ? DEEPSEEK_API_BASE_URL : DEFAULTS.apiBaseUrl);
    }
    return next;
  }

  function showStatus(text) {
    const status = element('gemini-translator-save-status');
    if (!status) return;
    status.value = text;
    status.setAttribute('value', text);
    if (showStatus.timer) clearTimeout(showStatus.timer);
    showStatus.timer = setTimeout(function () {
      status.value = '';
      status.setAttribute('value', '');
    }, 2200);
  }

  function save() {
    try {
      const nextConfig = collectConfig();
      writeConfig(nextConfig);
      // 设置页与后台插件脚本共享 Zotero 全局对象；保存后立即同步 Agy
      // 常驻会话，避免必须重启 Zotero 或第一次划词时才启动。
      try {
        Zotero.GeminiTranslatorRuntime?.syncConfig?.(nextConfig);
      } catch (runtimeErr) {
        Zotero.debug?.('[Gemini Translator] 保存后同步后台引擎失败: ' + (runtimeErr.message || runtimeErr));
      }
      showStatus('已保存');
    } catch (err) {
      showStatus('保存失败');
      Zotero.debug?.('[Gemini Translator] 设置页保存首选项失败: ' + (err.message || err));
    }
  }

  async function checkEnvironment() {
    const checker = Zotero.GeminiTranslatorRuntime?.checkTools;
    if (typeof checker !== 'function') {
      showStatus('运行时尚未准备好');
      return;
    }
    showStatus('正在检查…');
    try {
      const result = await checker(collectConfig());
      const agy = result?.agy?.available ? 'agy 可用' : 'agy 未找到';
      const pdf2zh = result?.pdf2zh?.available ? 'pdf2zh 可用' : 'pdf2zh 未找到';
      showStatus(`${agy}；${pdf2zh}`);
      Zotero.debug?.(`[Gemini Translator] 环境检查: ${JSON.stringify(result)}`);
    } catch (err) {
      showStatus('环境检查失败');
      Zotero.debug?.('[Gemini Translator] 环境检查失败: ' + (err.message || err));
    }
  }

  function reset() {
    loadIntoForm(Object.assign({}, DEFAULTS));
    showStatus('已恢复默认值（点击保存生效）');
  }

  const api = {
    _initialized: false,
    init: function () {
      if (this._initialized) return;
      this._initialized = true;
      loadIntoForm(readConfig());
      element('gemini-translator-endpoint-type')?.addEventListener('change', updateEndpointFields);
      element('gemini-translator-model')?.addEventListener('change', function () {
        setCustomModelVisibility(this.value === '__custom__');
      });
      element('gemini-translator-save')?.addEventListener('command', save);
      element('gemini-translator-check-env')?.addEventListener('command', checkEnvironment);
      element('gemini-translator-reset')?.addEventListener('command', reset);
    },
  };

  globalThis.GeminiTranslatorPreferences = api;
  if (typeof Zotero !== 'undefined') Zotero.GeminiTranslatorPreferences = api;
}());
