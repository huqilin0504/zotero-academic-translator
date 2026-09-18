import { cleanPdfText } from './cleaner';
import { LRUCache } from './lruCache';
import { loadConfig } from './config';
import { streamAsk, streamTranslate, syncAgySession, shutdownAgySession } from './client';
import { createTranslationCard } from './ui';
import { AssistantPaperInfo, AssistantSidebarController, createAssistantSidebar } from './assistantSidebar';
import { PLUGIN_CSS } from './stylesString';
import { checkExecutable, getAbortController, persistImageFile, removeTempImageAttachment } from './env';
import { openDocTranslateModal } from './docTranslateModal';
import { documentTranslationManager } from './docTranslateTasks';
import { destroyDocumentTaskStatusBar, ensureDocumentTaskStatusBar } from './docTranslateStatus';
import { ImageAttachment } from './types';
import { readPersistentJson, writePersistentJson } from './persistentStore';
import { readSecureApiKeys, readSecureApiKeysAsync, writeSecureApiKeysAsync } from './secretStore';
import { fetchProviderModels, ModelCatalogRequest } from './modelCatalog';

let listenerID: string | null = null;
let popupHandler: any = null;
let toolbarHandler: any = null;
let activeAbortController: any = null;
let activeQuestionAbortController: any = null;
let activeAssistantAbortController: any = null;
const assistantSidebars = new WeakMap<Document, AssistantSidebarController>();
const assistantSidebarControllers = new Set<AssistantSidebarController>();
const assistantPaperRefreshTokens = new WeakMap<Document, number>();
type AssistantLayoutState = {
  target: HTMLElement;
  originalRight: string;
  originalInsetInlineEnd: string;
  originalInsetInlineEndPriority: string;
  originalMarginRight: string;
  originalPaddingRight: string;
  originalTransition: string;
  resizeHandler: () => void;
};
const assistantLayouts = new WeakMap<Document, AssistantLayoutState>();
const menuItemElements: any[] = [];
let translationCache = new LRUCache<string, string>(500);
let translationCacheCapacity = 500;
const TRANSLATION_HISTORY_STORAGE_KEY = 'extensions.gemini-translator.translation-history';
const MAX_PERSISTED_TRANSLATIONS = 80;
const MAX_PERSISTED_TRANSLATION_TEXT_LENGTH = 24000;
interface PersistedTextEntry {
  text: string;
  updatedAt: number;
}
type PersistedTextStore = Record<string, PersistedTextEntry>;
const MAX_QUESTION_LENGTH = 2000;
const PREFERENCE_PANE_ID = 'gemini-translator-preferences';
let preferencePaneRegistered = false;
let preferencePaneRegistration: Promise<unknown> | null = null;
let shuttingDown = false;
let pluginRootURI = '';

function openPluginPreferences(): void {
  try {
    const internal = (Zotero as any).Utilities?.Internal;
    if (typeof internal?.openPreferences === 'function') {
      internal.openPreferences(PREFERENCE_PANE_ID);
      return;
    }
    Zotero.debug?.('[Gemini Translator] 当前 Zotero 未提供插件偏好页入口');
  } catch (err: any) {
    Zotero.debug?.(`[Gemini Translator] 打开插件偏好页失败: ${err.message || err}`);
  }
}

function registerSettingsMenu(win: any): void {
  const doc = win?.document;
  if (!doc || doc.getElementById?.('gemini-translator-settings-menuitem')) return;

  const menuPopup = doc.getElementById?.('menu_ToolsPopup') ||
    doc.getElementById?.('menu_Tools')?.querySelector?.('menupopup');
  if (!menuPopup) return;

  const menuitem = doc.createXULElement
    ? doc.createXULElement('menuitem')
    : doc.createElement('menuitem');
  menuitem.id = 'gemini-translator-settings-menuitem';
  menuitem.setAttribute('label', '文献翻译设置…');
  menuitem.addEventListener('command', openPluginPreferences);
  menuPopup.appendChild(menuitem);
  menuItemElements.push(menuitem);
}

function registerPreferencePane(rootURI: string, pluginID: string, win: any): void {
  if (preferencePaneRegistered || preferencePaneRegistration) return;
  const panes = (Zotero as any).PreferencePanes;
  if (!panes || typeof panes.register !== 'function') {
    Zotero.debug?.('[Gemini Translator] Zotero.PreferencePanes 不可用，跳过插件设置页注册');
    return;
  }

  try {
    preferencePaneRegistration = Promise.resolve(panes.register({
      pluginID,
      id: PREFERENCE_PANE_ID,
      src: `${rootURI}preferences.xhtml`,
      scripts: [`${rootURI}preferences-defaults.js`, `${rootURI}preferences.js`],
      stylesheets: [`${rootURI}preferences.css`],
      label: '文献翻译',
      image: `${rootURI}icon.png`,
    }))
      .then(() => {
        if (shuttingDown) return;
        preferencePaneRegistered = true;
        registerSettingsMenu(win || Zotero.getMainWindow?.());
      })
      .catch((err: any) => {
        Zotero.debug?.(`[Gemini Translator] 注册插件设置页失败: ${err.message || err}`);
      })
      .finally(() => {
        preferencePaneRegistration = null;
      });
  } catch (err: any) {
    preferencePaneRegistration = null;
    Zotero.debug?.(`[Gemini Translator] 注册插件设置页异常: ${err.message || err}`);
  }
}

function exposeRuntimeBridge(): void {
  try {
    (Zotero as any).GeminiTranslatorRuntime = {
      syncConfig: (config: ReturnType<typeof loadConfig>) => {
        if (shuttingDown) return;
        syncAgySession(config);
      },
      getApiKeys: () => readSecureApiKeys(),
      getApiKeysAsync: async () => readSecureApiKeysAsync(),
      setApiKeys: async (keys: { deepseekApiKey?: string; geminiApiKey?: string }) => writeSecureApiKeysAsync({
        deepseekApiKey: String(keys?.deepseekApiKey || '').trim(),
        geminiApiKey: String(keys?.geminiApiKey || '').trim(),
      }),
      listModels: async (request: ModelCatalogRequest) => {
        const secure = readSecureApiKeys();
        const endpoint = String(request?.endpointType || '').trim().toLowerCase();
        const apiKey = String(request?.apiKey || '').trim() ||
          (endpoint === 'deepseek' ? secure.deepseekApiKey : endpoint === 'gemini' ? secure.geminiApiKey : '');
        return fetchProviderModels({ ...request, apiKey });
      },
      checkTools: async (config: ReturnType<typeof loadConfig>) => ({
        agy: await checkExecutable(config.agyPath || 'agy'),
        pdf2zh: await checkExecutable(config.pdf2zhPath || 'pdf2zh'),
      }),
    };
  } catch (err: any) {
    Zotero.debug?.(`[Gemini Translator] 暴露运行时配置桥接失败: ${err.message || err}`);
  }
}

function getTranslationCache(config: ReturnType<typeof loadConfig>): LRUCache<string, string> {
  const requestedCapacity = Number.isFinite(config.cacheSize) && config.cacheSize > 0
    ? Math.floor(config.cacheSize)
    : 500;
  if (requestedCapacity !== translationCacheCapacity) {
    translationCache = new LRUCache<string, string>(requestedCapacity);
    translationCacheCapacity = requestedCapacity;
  }
  return translationCache;
}

function compactPersistentKey(key: string): string {
  // 问答上下文可能包含摘要和多轮历史；不要把整段上下文重复写进 Zotero.Prefs 的键名。
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16)}:${key.length}`;
}

function getCachedText(cache: LRUCache<string, string>, key: string, doc?: Document): string | undefined {
  const inMemory = cache.get(key);
  if (inMemory !== undefined) return inMemory;
  const store = readPersistentJson<PersistedTextStore>(TRANSLATION_HISTORY_STORAGE_KEY, {}, doc);
  const entry = store && typeof store === 'object' && !Array.isArray(store)
    ? store[compactPersistentKey(key)]
    : undefined;
  if (!entry || typeof entry.text !== 'string' || !entry.text) return undefined;
  cache.set(key, entry.text);
  return entry.text;
}

function setCachedText(cache: LRUCache<string, string>, key: string, text: string, doc?: Document): void {
  if (!text) return;
  cache.set(key, text);
  const store = readPersistentJson<PersistedTextStore>(TRANSLATION_HISTORY_STORAGE_KEY, {}, doc);
  const normalizedStore = store && typeof store === 'object' && !Array.isArray(store) ? store : {};
  normalizedStore[compactPersistentKey(key)] = {
    text: text.slice(0, MAX_PERSISTED_TRANSLATION_TEXT_LENGTH),
    updatedAt: Date.now(),
  };
  const recentKeys = Object.entries(normalizedStore)
    .sort(([, left], [, right]) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))
    .slice(0, MAX_PERSISTED_TRANSLATIONS)
    .map(([entryKey]) => entryKey);
  const recent = new Set(recentKeys);
  for (const entryKey of Object.keys(normalizedStore)) {
    if (!recent.has(entryKey)) delete normalizedStore[entryKey];
  }
  writePersistentJson(TRANSLATION_HISTORY_STORAGE_KEY, normalizedStore, doc);
}

function buildTranslationCacheKey(text: string, config: ReturnType<typeof loadConfig>): string {
  return JSON.stringify({
    text,
    endpointType: config.endpointType,
    apiBaseUrl: config.apiBaseUrl,
    model: config.model,
    targetLanguage: config.targetLanguage,
    systemPrompt: config.systemPrompt,
  });
}

function buildQuestionCacheKey(
  selectedText: string,
  question: string,
  config: ReturnType<typeof loadConfig>,
  imageAttachments: ImageAttachment[] = []
): string {
  return JSON.stringify({
    kind: 'question',
    selectedText,
    question,
    endpointType: config.endpointType,
    apiBaseUrl: config.apiBaseUrl,
    model: config.model,
    targetLanguage: config.targetLanguage,
    images: imageAttachments.map((image) => ({
      name: image.name,
      mimeType: image.mimeType,
      size: image.size,
      // HTTP 端点用 dataUrl 的尾部做轻量指纹；Agy 不保留 dataUrl，只能
      // 使用本次临时路径，宁可少命中缓存，也不能让同名同大小图片串答案。
      dataFingerprint: image.dataUrl
        ? `${image.dataUrl.length}:${image.dataUrl.slice(-96)}`
        : `${image.path || ''}:${image.size}`,
    })),
  });
}

async function prepareQuestionImages(
  files: File[],
  endpointType: ReturnType<typeof loadConfig>['endpointType']
): Promise<ImageAttachment[]> {
  const prepared: ImageAttachment[] = [];
  try {
    for (const file of files) {
      // 旧 Agy 通过本地图片查看工具读取 path；HTTP 多模态端点则需要 dataUrl。
      prepared.push(await persistImageFile(file, endpointType !== 'agy'));
    }
    return prepared;
  } catch (err) {
    await Promise.all(prepared.map((image) => removeTempImageAttachment(image)));
    throw err;
  }
}

async function cleanupQuestionImages(images: ImageAttachment[]): Promise<void> {
  await Promise.all(images.map((image) => removeTempImageAttachment(image)));
}

function readItemField(item: any, field: string): string {
  try {
    const value = item?.getField?.(field);
    return value == null ? '' : String(value).trim();
  } catch (_) {
    return '';
  }
}

function formatItemCreators(item: any): string {
  try {
    const creators = item?.getCreators?.() || [];
    return creators.map((creator: any) => {
      if (creator?.name) return String(creator.name).trim();
      return [creator?.firstName, creator?.lastName].filter(Boolean).join(' ').trim();
    }).filter(Boolean).join(', ');
  } catch (_) {
    return '';
  }
}

function readItemTags(item: any): string[] {
  try {
    return (item?.getTags?.() || [])
      .map((tag: any) => typeof tag === 'string' ? tag : tag?.tag)
      .filter(Boolean)
      .map((tag: any) => String(tag).trim())
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function buildReaderPaperInfo(reader: any): Promise<AssistantPaperInfo> {
  const itemID = reader?.itemID;
  const item = itemID ? await Zotero.Items.getAsync(itemID) : null;
  if (!item) return { itemID };

  let paperItem = item;
  if (item.isAttachment?.() && item.parentItemID) {
    const parent = await Zotero.Items.getAsync(item.parentItemID);
    if (parent) paperItem = parent;
  }

  let fileName = '';
  try {
    const filePath = await (item.getFilePathAsync ? item.getFilePathAsync() : item.getFilePath?.());
    if (filePath) fileName = String(filePath).split(/[\\/]/).pop() || '';
  } catch (_) {}

  return {
    itemID: paperItem.id || itemID,
    title: readItemField(paperItem, 'title'),
    creators: formatItemCreators(paperItem),
    year: readItemField(paperItem, 'year') || readItemField(paperItem, 'date'),
    publicationTitle: readItemField(paperItem, 'publicationTitle') || readItemField(paperItem, 'conferenceName'),
    doi: readItemField(paperItem, 'DOI'),
    url: readItemField(paperItem, 'url'),
    tags: readItemTags(paperItem),
    fileName,
    abstractNote: readItemField(paperItem, 'abstractNote'),
  };
}

function refreshReaderPaperInfo(
  doc: Document,
  reader: any,
  sidebar: AssistantSidebarController
): void {
  const token = (assistantPaperRefreshTokens.get(doc) || 0) + 1;
  assistantPaperRefreshTokens.set(doc, token);
  void buildReaderPaperInfo(reader)
    .then((info) => {
      // renderToolbar 可能在异步读取元数据期间再次触发；只接受最后一次绑定结果。
      if (assistantPaperRefreshTokens.get(doc) !== token) return;
      sidebar.setPaperInfo(info);
    })
    .catch((err: any) => {
      if (assistantPaperRefreshTokens.get(doc) !== token) return;
      Zotero.debug?.(`[Gemini Translator] AI 助手读取论文信息失败: ${err.message || err}`);
      sidebar.setPaperInfo({ itemID: reader?.itemID, title: '论文信息读取失败' });
    });
}

async function askAssistantSidebar(
  doc: Document,
  sidebar: AssistantSidebarController,
  question: string,
  context: string,
  imageFiles: File[]
): Promise<void> {
  if (activeAssistantAbortController) {
    try {
      activeAssistantAbortController.abort();
    } catch (_) {}
    activeAssistantAbortController = null;
  }

  const config = loadConfig();
  const cache = getTranslationCache(config);
  // 先把当前问题放进对话流；图片预处理失败时也能保留用户刚刚提交的问题。
  sidebar.setLoading(question);
  let imageAttachments: ImageAttachment[] = [];
  try {
    imageAttachments = await prepareQuestionImages(imageFiles, config.endpointType);
  } catch (err: any) {
    sidebar.setError(err?.message || '图片读取失败', () => {
      void askAssistantSidebar(doc, sidebar, question, context, imageFiles);
    });
    return;
  }

  const cacheKey = buildQuestionCacheKey(context, question, config, imageAttachments);
  const cached = getCachedText(cache, cacheKey, doc);
  if (cached) {
    sidebar.setDone(cached, true, config.enableKaTeX);
    await cleanupQuestionImages(imageAttachments);
    return;
  }

  const AbortControllerClass = getAbortController(doc);
  const abortController = new AbortControllerClass();
  activeAssistantAbortController = abortController;
  try {
    await streamAsk(
      context,
      question,
      config,
      {
        onStart: () => sidebar.setLoading(question),
        onChunk: (_, accumulated) => sidebar.setStreaming(accumulated),
        onDone: (fullText) => {
          if (!fullText.trim()) {
            sidebar.setError('服务未返回回答', () => {
              void askAssistantSidebar(doc, sidebar, question, context, imageFiles);
            });
          } else {
            setCachedText(cache, cacheKey, fullText, doc);
            sidebar.setDone(fullText, false, config.enableKaTeX);
          }
          if (activeAssistantAbortController === abortController) {
            activeAssistantAbortController = null;
          }
        },
        onError: (err) => {
          if (abortController.signal.aborted) return;
          sidebar.setError(err.message, () => {
            void askAssistantSidebar(doc, sidebar, question, context, imageFiles);
          });
          if (activeAssistantAbortController === abortController) {
            activeAssistantAbortController = null;
          }
        },
      },
      abortController.signal,
      doc,
      imageAttachments
    );
  } catch (_) {
    // 错误已经通过 onError 呈现；用户主动关闭/切换时不显示失败。
  } finally {
    await cleanupQuestionImages(imageAttachments);
  }
}

function findAssistantLayoutTarget(doc: Document): HTMLElement | null {
  const selectors = [
    // Zotero reader.html owns the PDF iframe inside this flex viewport.
    // Reflowing it moves the complete page/spread instead of shifting an
    // inner PDF.js element underneath the assistant.
    '#split-view',
    '.split-view',
    '#primary-view',
    '.primary-view',
    '#viewerContainer',
    '.viewerContainer',
    '.reader-container',
    '.reader-content',
    '.pdfViewer',
    '.page-container',
    'body',
  ];
  for (const selector of selectors) {
    const candidate = doc.querySelector?.(selector) as HTMLElement | null;
    if (candidate && !candidate.closest?.('.gemini-assistant-sidebar')) return candidate;
  }
  return doc.documentElement as HTMLElement | null;
}

function restoreAssistantReaderLayout(doc: Document, keepResizeListener = false): void {
  const state = assistantLayouts.get(doc);
  doc.documentElement?.classList.remove('gemini-assistant-reader-reflow-active', 'gemini-assistant-reader-overlay');
  if (!state) return;
  if (!keepResizeListener) {
    doc.defaultView?.removeEventListener?.('resize', state.resizeHandler);
  }
  state.target.style.right = state.originalRight;
  if (state.originalInsetInlineEnd) {
    state.target.style.setProperty('inset-inline-end', state.originalInsetInlineEnd, state.originalInsetInlineEndPriority);
  } else {
    state.target.style.removeProperty('inset-inline-end');
  }
  state.target.style.marginRight = state.originalMarginRight;
  state.target.style.paddingRight = state.originalPaddingRight;
  state.target.style.transition = state.originalTransition;
  state.target.classList.remove('gemini-assistant-reader-reflow');
  if (!keepResizeListener) assistantLayouts.delete(doc);
}

/**
 * Let the PDF viewport give the assistant its own column on wide readers.
 * Small windows keep the overlay behavior so the paper never becomes
 * narrower than a usable reading width.
 */
function applyAssistantReaderLayout(doc: Document, sidebarElement: HTMLElement, open: boolean): void {
  if (!open) {
    restoreAssistantReaderLayout(doc);
    return;
  }

  const view = doc.defaultView;
  const viewportWidth = Math.max(1, view?.innerWidth || doc.documentElement?.clientWidth || 1024);
  const sidebarWidth = Math.ceil(sidebarElement.getBoundingClientRect?.().width || sidebarElement.offsetWidth || 370);
  let state = assistantLayouts.get(doc);
  if (!state) {
    const target = findAssistantLayoutTarget(doc);
    if (!target) return;
    state = {
      target,
      originalRight: target.style.right,
      originalInsetInlineEnd: target.style.getPropertyValue('inset-inline-end'),
      originalInsetInlineEndPriority: target.style.getPropertyPriority('inset-inline-end'),
      originalMarginRight: target.style.marginRight,
      originalPaddingRight: target.style.paddingRight,
      originalTransition: target.style.transition,
      resizeHandler: () => applyAssistantReaderLayout(doc, sidebarElement, true),
    };
    assistantLayouts.set(doc, state);
    view?.addEventListener?.('resize', state.resizeHandler);
  }
  if (!state) return;

  const narrowReader = viewportWidth < 900 || viewportWidth - sidebarWidth < 560;
  if (narrowReader) {
    restoreAssistantReaderLayout(doc, true);
    doc.documentElement?.classList.add('gemini-assistant-reader-overlay');
    return;
  }

  doc.documentElement?.classList.remove('gemini-assistant-reader-overlay');

  const position = (view as any)?.getComputedStyle?.(state.target)?.position || '';
  state.target.style.transition = 'right 160ms ease, inset-inline-end 160ms ease, margin-right 160ms ease';
  if (position === 'absolute' || position === 'fixed' || position === 'sticky') {
    // reader.css uses logical inset properties for #split-view. Set both
    // forms so this also works in older Zotero PDF reader documents.
    state.target.style.setProperty('inset-inline-end', `${sidebarWidth}px`, 'important');
    state.target.style.setProperty('right', `${sidebarWidth}px`);
  } else {
    state.target.style.marginRight = `${sidebarWidth}px`;
    state.target.style.paddingRight = '0px';
  }
  state.target.classList.add('gemini-assistant-reader-reflow');
  doc.documentElement?.classList.add('gemini-assistant-reader-reflow-active');
}

function ensureAssistantSidebar(
  doc: Document,
  reader: any,
  onOpenChange?: (open: boolean) => void,
  onResize?: (width: number) => void
): AssistantSidebarController {
  const existing = assistantSidebars.get(doc);
  if (existing) {
    refreshReaderPaperInfo(doc, reader, existing);
    return existing;
  }

  let sidebar!: AssistantSidebarController;
  sidebar = createAssistantSidebar(doc, {
    onOpenChange,
    onResize,
    onPaperChange: () => {
      if (activeAssistantAbortController) {
        try {
          activeAssistantAbortController.abort();
        } catch (_) {}
        activeAssistantAbortController = null;
      }
    },
    onAsk: (question, images, context) => {
      void askAssistantSidebar(doc, sidebar, question, context, images);
    },
  });
  assistantSidebars.set(doc, sidebar);
  assistantSidebarControllers.add(sidebar);
  const mount = doc.body || doc.documentElement;
  mount?.appendChild(sidebar.element);
  refreshReaderPaperInfo(doc, reader, sidebar);
  return sidebar;
}

function ensureStylesInjected(doc: Document): void {
  const styleId = 'gemini-translator-style';
  if (!doc.getElementById(styleId)) {
    const styleEl = doc.createElement('style');
    styleEl.id = styleId;
    // KaTeX 的字体位于 XPI 的 fonts/ 目录；把占位根 URI 换成当前插件资源根，
    // 避免 Zotero 阅读器把相对路径解析到 reader 文档自身。
    styleEl.textContent = PLUGIN_CSS.replace(/__GEMINI_ROOT__/g, pluginRootURI);
    const target = doc.head || doc.documentElement;
    if (target) {
      target.appendChild(styleEl);
    }
  }
}

export function install(): void {
  Zotero.debug?.('[Gemini Translator] Plugin installed');
}

export function uninstall(): void {
  Zotero.debug?.('[Gemini Translator] Plugin uninstalled');
}

export function startup({ id, version, rootURI }: { id: string; version: string; rootURI: string }): void {
  Zotero.debug?.(`[Gemini Translator] 插件正在启动 (v${version}, id: ${id})`);
  shuttingDown = false;
  listenerID = id;
  pluginRootURI = rootURI;

  // Zotero 原生偏好页承载引擎、模型、端点和全文翻译设置，划词浮层不再内嵌配置表单。
  registerPreferencePane(rootURI, id, Zotero.getMainWindow?.());

  // Agy 配置在插件启动时立即后台预热；DeepSeek/Gemini 仍按需请求。
  const startupConfig = loadConfig();
  exposeRuntimeBridge();
  syncAgySession(startupConfig);

  // 状态栏属于 Zotero 主窗口，而全文翻译入口通常运行在阅读器 iframe；
  // 启动时先挂载一次并注入主窗口样式，避免首次点击时跨文档挂载或无样式闪烁。
  try {
    const mainDocument = Zotero.getMainWindow?.()?.document;
    if (mainDocument) {
      ensureStylesInjected(mainDocument);
      ensureDocumentTaskStatusBar(mainDocument);
    }
  } catch (err: any) {
    Zotero.debug?.(`[Gemini Translator] 初始化全文翻译状态栏失败: ${err.message || err}`);
  }

  // 1. 注册 Zotero 7 原生 PDF 阅读器划选气泡事件
  popupHandler = async (event: any) => {
    let controller: any = null;
    try {
      const { doc, params, append } = event;
      const rawText = params?.annotation?.text || '';
      if (!rawText || !rawText.trim()) return;

      // 注入自适应 CSS 样式
      ensureStylesInjected(doc);

      // 清洗 PDF 跨行断词与连字符
      const cleanedText = cleanPdfText(rawText);
      if (!cleanedText) return;

      // 选区弹窗只是上下文入口；常驻 AI 助手侧栏如果已打开，始终同步
      // 最近一次选区，但不自动弹出侧栏或改变用户当前的阅读布局。
      assistantSidebars.get(doc)?.setSelectedText(cleanedText);

      // 切换到新的选区时，停止上一张卡片的问答请求，避免旧回答串到新选区。
      if (activeQuestionAbortController) {
        try {
          activeQuestionAbortController.abort();
        } catch (_) {}
        activeQuestionAbortController = null;
      }

      async function askSelectedText(question: string, imageFiles: File[] = []): Promise<void> {
        const normalizedQuestion = question.trim();
        if (!normalizedQuestion) return;
        if (normalizedQuestion.length > MAX_QUESTION_LENGTH) {
          controller?.setQuestionError(`问题不能超过 ${MAX_QUESTION_LENGTH} 个字符`);
          return;
        }

        if (activeQuestionAbortController) {
          try {
            activeQuestionAbortController.abort();
          } catch (_) {}
          activeQuestionAbortController = null;
        }

        const config = loadConfig();
        const cache = getTranslationCache(config);
        let imageAttachments: ImageAttachment[] = [];
        try {
          imageAttachments = await prepareQuestionImages(imageFiles, config.endpointType);
        } catch (err: any) {
          controller?.setQuestionError(err?.message || '图片读取失败', () => {
            void askSelectedText(normalizedQuestion, imageFiles);
          });
          return;
        }

        const cacheKey = buildQuestionCacheKey(cleanedText, normalizedQuestion, config, imageAttachments);

        controller?.setQuestionLoading(normalizedQuestion);

        const cached = getCachedText(cache, cacheKey, doc);
        if (cached) {
          controller?.setQuestionDone(cached, true, config.enableKaTeX);
          await cleanupQuestionImages(imageAttachments);
          return;
        }

        const AbortControllerClass = getAbortController(doc);
        const abortController = new AbortControllerClass();
        activeQuestionAbortController = abortController;

        try {
          await streamAsk(
              cleanedText,
              normalizedQuestion,
              config,
              {
                onStart: () => {
                  controller?.setQuestionLoading(normalizedQuestion);
                },
                onChunk: (_, accumulated) => {
                  controller?.setQuestionStreaming(accumulated);
                },
                onDone: (fullText) => {
                  if (!fullText.trim()) {
                    controller?.setQuestionError('服务未返回回答', () => {
                      void askSelectedText(normalizedQuestion, imageFiles);
                    });
                  } else {
                    setCachedText(cache, cacheKey, fullText, doc);
                    controller?.setQuestionDone(fullText, false, config.enableKaTeX);
                  }
                  if (activeQuestionAbortController === abortController) {
                    activeQuestionAbortController = null;
                  }
                },
                onError: (err) => {
                  if (abortController.signal.aborted) return;
                  controller?.setQuestionError(err.message, () => {
                    void askSelectedText(normalizedQuestion, imageFiles);
                  });
                  if (activeQuestionAbortController === abortController) {
                    activeQuestionAbortController = null;
                  }
                },
              },
              abortController.signal,
              doc,
              imageAttachments
            );
        } catch (_) {
          // 已在 onError 回调中处理；取消请求属于预期行为。
        } finally {
          await cleanupQuestionImages(imageAttachments);
        }
      }

      // 构建请求执行函数
      const doRequest = async () => {
        const config = loadConfig();
        const cache = getTranslationCache(config);
        const cacheKey = buildTranslationCacheKey(cleanedText, config);

        // 检查 0ms LRU 内存缓存
        const cached = getCachedText(cache, cacheKey, doc);
        if (cached) {
          controller?.setDone(cached, true, config.enableKaTeX);
          return;
        }

        // 中断上一次未完成的翻译请求
        if (activeAbortController) {
          try {
            activeAbortController.abort();
          } catch (_) {}
          activeAbortController = null;
        }

        const AbortControllerClass = getAbortController(doc);
        const abortController = new AbortControllerClass();
        activeAbortController = abortController;

        controller?.setLoading();

        try {
          await streamTranslate(
            cleanedText,
            config,
            {
              onStart: () => {
                controller?.setLoading();
              },
              onChunk: (_, accumulated) => {
                controller?.setStreaming(accumulated);
              },
              onDone: (fullText) => {
                setCachedText(cache, cacheKey, fullText, doc);
                controller?.setDone(fullText, false, config.enableKaTeX);
                if (activeAbortController === abortController) {
                  activeAbortController = null;
                }
              },
              onError: (err) => {
                if (abortController.signal.aborted) return;
                controller?.setError(err.message, () => {
                  doRequest();
                });
                if (activeAbortController === abortController) {
                  activeAbortController = null;
                }
              },
            },
            abortController.signal,
            doc
          );
        } catch (_) {
          // 已在 onError 回调中处理
        }
      };

      // 构建现代交互卡片并挂载到划选弹窗
      controller = createTranslationCard(doc, {
        onClose: () => {
          if (activeAbortController) {
            try {
              activeAbortController.abort();
            } catch (_) {}
            activeAbortController = null;
          }
          if (activeQuestionAbortController) {
            try {
              activeQuestionAbortController.abort();
            } catch (_) {}
            activeQuestionAbortController = null;
          }
        },
        onQuestion: (question: string, images: File[]) => {
          void askSelectedText(question, images);
        },
      });
      append(controller.element);

      // 容器协调一致性调谐：保持轻量工具条宽度，避免遮挡 PDF 正文
      try {
        const popup = (controller.element.closest?.('.selection-popup') ||
          doc.querySelector?.('.selection-popup')) as HTMLElement | null;
        if (popup) {
          popup.classList.add('has-gemini-card');
          const viewportWidth = doc.defaultView?.innerWidth || 1024;
          const popupWidth = Math.min(360, Math.max(0, viewportWidth - 16));
          popup.style.minWidth = '0';
          popup.style.maxWidth = `${popupWidth}px`;
          popup.style.width = `${popupWidth}px`;
          popup.style.boxSizing = 'border-box';
          const colors = popup.querySelector?.('.colors') as HTMLElement | null;
          if (colors) {
            colors.style.width = '100%';
            colors.style.justifyContent = 'space-between';
          }
        }
      } catch (_) {}

      // 立即发起翻译请求
      doRequest();
    } catch (err: any) {
      Zotero.debug?.(`[Gemini Translator] 渲染浮窗失败: ${err}`);
      if (controller) {
        controller.setError(`初始化失败: ${err.message || err}`);
      }
    }
  };

  Zotero.Reader.registerEventListener('renderTextSelectionPopup', popupHandler, listenerID);

  // 2. 注册 Zotero 7 原生 PDF 阅读器顶部工具栏按钮（⚡ 全文高保真翻译）
  toolbarHandler = async (event: any) => {
    try {
      const { reader, doc, append } = event;
      if (!reader || !append) return;

      ensureStylesInjected(doc);

      // 避免重复挂载按钮
      if (doc.getElementById('gemini-doc-translate-toolbar-btn')) return;

      const btn = doc.createElement('button');
      btn.id = 'gemini-doc-translate-toolbar-btn';
      btn.className = 'toolbar-button gemini-toolbar-btn';
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-label', '全文翻译');
      btn.setAttribute('title', '全文翻译');
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block;vertical-align:middle;margin-right:4px;"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg><span class="text">全文翻译</span>`;

      btn.addEventListener('click', async (e: Event) => {
        e.stopPropagation();
        e.preventDefault();

        try {
          const itemID = reader.itemID;
          if (!itemID) {
            Zotero.debug?.('[Gemini Translator] 未找到当前阅读器的 itemID');
            return;
          }

          const item = await Zotero.Items.getAsync(itemID);
          if (!item) {
            Zotero.debug?.(`[Gemini Translator] 无法获取条目: ${itemID}`);
            return;
          }

          const filePath = await (item.getFilePathAsync ? item.getFilePathAsync() : item.getFilePath?.());
          if (!filePath) {
            const win = Zotero.getMainWindow?.() || doc.defaultView;
            win?.alert?.('当前文献尚未关联本地 PDF 文件，请先下载或关联 PDF 后再翻译！');
            return;
          }

          // 获取条目的主元数据条目（若当前为附件，挂载至主文献条目）
          let targetItem = item;
          if (item.isAttachment && item.isAttachment() && item.parentItemID) {
            const parent = await Zotero.Items.getAsync(item.parentItemID);
            if (parent) targetItem = parent;
          }

          const config = loadConfig();
          openDocTranslateModal(doc, targetItem, filePath, config);
        } catch (err: any) {
          Zotero.debug?.(`[Gemini Translator] 触发全文翻译对话框异常: ${err.message}`);
        }
      });

      append(btn);

      // 常驻 AI 助手入口：与全文翻译并列，只显示图标，点击后侧栏保持在
      // 当前阅读器内，直到用户再次点击按钮或关闭侧栏。
      if (!doc.getElementById('gemini-assistant-toolbar-btn')) {
        const assistantButton = doc.createElement('button');
        let sidebar!: AssistantSidebarController;
        sidebar = ensureAssistantSidebar(doc, reader, (open) => {
          assistantButton.setAttribute('aria-pressed', String(open));
          applyAssistantReaderLayout(doc, sidebar.element, open);
        }, () => {
          if (sidebar.isOpen()) applyAssistantReaderLayout(doc, sidebar.element, true);
        });
        assistantButton.id = 'gemini-assistant-toolbar-btn';
        assistantButton.className = 'toolbar-button gemini-assistant-toolbar-btn';
        assistantButton.type = 'button';
        assistantButton.setAttribute('aria-label', 'AI助手');
        assistantButton.setAttribute('title', 'AI助手');
        assistantButton.setAttribute('aria-pressed', String(sidebar.isOpen()));
        assistantButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 4h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5.2l-4.4 3.2c-.7.5-1.7 0-1.7-.9V18H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm2 5v2h10V9H7Zm0 4v2h7v-2H7Z"/></svg>';
        assistantButton.addEventListener('click', (event: Event) => {
          event.stopPropagation();
          event.preventDefault();
          sidebar.setOpen(!sidebar.isOpen());
        });
        append(assistantButton);
      }
    } catch (err: any) {
      Zotero.debug?.(`[Gemini Translator] 注册阅读器顶部工具栏异常: ${err}`);
    }
  };

  Zotero.Reader.registerEventListener('renderToolbar', toolbarHandler, listenerID);

  // 3. 注册主界面文献条目右键菜单（支持在文献库列表中右键论文直接翻译）
  try {
    const initItemMenu = (win: any) => {
      const doc = win?.document;
      const menu = doc?.getElementById?.('zotero-itemmenu');
      if (!menu || doc.getElementById('gemini-doc-translate-menuitem')) return;

      const menuitem = doc.createXULElement ? doc.createXULElement('menuitem') : doc.createElement('menuitem');
      menuitem.id = 'gemini-doc-translate-menuitem';
      menuitem.setAttribute('label', '全文翻译 (高保真排版)...');
      menuitem.addEventListener('command', async () => {
        try {
          const pane = Zotero.getActiveZoteroPane?.();
          const items = pane?.getSelectedItems?.();
          if (!items || items.length === 0) return;
          const item = items[0];

          let pdfItem: any = null;
          if (item.isAttachment && item.isAttachment() && item.attachmentContentType === 'application/pdf') {
            pdfItem = item;
          } else if (item.getAttachments) {
            const attachmentIDs = item.getAttachments();
            for (const attId of attachmentIDs) {
              const att = await Zotero.Items.getAsync(attId);
              if (att && att.isAttachment && att.isAttachment() && att.attachmentContentType === 'application/pdf') {
                pdfItem = att;
                break;
              }
            }
          }

          if (!pdfItem) {
            win.alert('所选条目未找到关联的 PDF 文件！');
            return;
          }

          const filePath = await (pdfItem.getFilePathAsync ? pdfItem.getFilePathAsync() : pdfItem.getFilePath?.());
          if (!filePath) {
            win.alert('无法定位本地 PDF 物理文件路径！');
            return;
          }

          ensureStylesInjected(doc);
          const parentItem = (item.isRegularItem && item.isRegularItem()) ? item : ((item.parentItemID && await Zotero.Items.getAsync(item.parentItemID)) || item);
          openDocTranslateModal(doc, parentItem, filePath, loadConfig());
        } catch (err: any) {
          Zotero.debug?.(`[Gemini Translator] 右键菜单全文翻译触发失败: ${err.message}`);
        }
      });

      menu.appendChild(menuitem);
      menuItemElements.push(menuitem);
    };

    const mainWin = Zotero.getMainWindow?.();
    if (mainWin) {
      initItemMenu(mainWin);
    }
  } catch (err: any) {
    Zotero.debug?.(`[Gemini Translator] 注册条目右键菜单失败: ${err.message}`);
  }
}

export function shutdown(): void {
  Zotero.debug?.('[Gemini Translator] 插件正在卸载/禁用');
  shuttingDown = true;
  // 插件卸载时停止后台 PDF 子进程，避免留下孤儿 pdf2zh/Agy worker。
  documentTranslationManager.cancelAll();
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  if (activeQuestionAbortController) {
    activeQuestionAbortController.abort();
    activeQuestionAbortController = null;
  }
  if (activeAssistantAbortController) {
    activeAssistantAbortController.abort();
    activeAssistantAbortController = null;
  }
  if (popupHandler) {
    Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', popupHandler);
    popupHandler = null;
  }
  if (toolbarHandler) {
    Zotero.Reader.unregisterEventListener('renderToolbar', toolbarHandler);
    toolbarHandler = null;
  }
  for (const el of menuItemElements) {
    try {
      el.remove();
    } catch (_) {}
  }
  menuItemElements.length = 0;
  for (const sidebar of assistantSidebarControllers) {
    try {
      const ownerDocument = sidebar.element.ownerDocument;
      if (ownerDocument) restoreAssistantReaderLayout(ownerDocument);
      sidebar.destroy();
    } catch (_) {}
  }
  assistantSidebarControllers.clear();

  if (preferencePaneRegistered) {
    try {
      (Zotero as any).PreferencePanes?.unregister?.(PREFERENCE_PANE_ID);
    } catch (err: any) {
      Zotero.debug?.(`[Gemini Translator] 注销插件设置页失败: ${err.message || err}`);
    }
  }
  preferencePaneRegistered = false;
  preferencePaneRegistration = null;
  try {
    if ((Zotero as any).GeminiTranslatorPreferences) {
      delete (Zotero as any).GeminiTranslatorPreferences;
    }
    if ((Zotero as any).GeminiTranslatorRuntime) {
      delete (Zotero as any).GeminiTranslatorRuntime;
    }
  } catch (_) {}

  try {
    const mainDocument = Zotero.getMainWindow?.()?.document;
    if (mainDocument) destroyDocumentTaskStatusBar(mainDocument);
  } catch (_) {}

  listenerID = null;
  translationCache.clear();
  shutdownAgySession();
}

// 确保在 Zotero 7 Sandbox / SubscriptLoader 环境下全局可访问
if (typeof globalThis !== 'undefined') {
  const g = globalThis as any;
  g.install = install;
  g.uninstall = uninstall;
  g.startup = startup;
  g.shutdown = shutdown;
}
