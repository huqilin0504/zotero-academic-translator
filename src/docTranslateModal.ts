import { PluginConfig } from './types';
import { documentTranslationManager } from './docTranslateTasks';
import { ensureDocumentTaskStatusBar } from './docTranslateStatus';

/**
 * 打开全文翻译配置面板。
 * 点击开始后只提交后台任务并立即关闭面板，进度和取消操作统一放到状态栏。
 */
export function openDocTranslateModal(
  doc: Document,
  item: any,
  inputPdfPath: string,
  config: PluginConfig
): void {
  const existingModal = doc.getElementById('gemini-doc-translate-modal');
  if (existingModal) existingModal.remove();

  ensureDocumentTaskStatusBar(doc);

  const backdrop = doc.createElement('div');
  backdrop.id = 'gemini-doc-translate-modal';
  backdrop.className = 'gemini-modal-backdrop';

  const dialog = doc.createElement('div');
  dialog.className = 'gemini-modal-dialog';

  const header = doc.createElement('div');
  header.className = 'gemini-modal-header';
  const titleBox = doc.createElement('div');
  titleBox.className = 'gemini-modal-title';
  titleBox.textContent = '文档全文翻译';
  const closeBtn = doc.createElement('button');
  closeBtn.className = 'gemini-modal-close';
  closeBtn.type = 'button';
  closeBtn.textContent = '关闭';
  header.appendChild(titleBox);
  header.appendChild(closeBtn);

  const infoCard = doc.createElement('div');
  infoCard.className = 'gemini-modal-info';
  const itemTitle = item.getField?.('title') || '当前论文';
  const titleP = doc.createElement('div');
  titleP.className = 'gemini-info-title';
  titleP.textContent = itemTitle;
  const pathP = doc.createElement('div');
  pathP.className = 'gemini-info-path';
  pathP.textContent = inputPdfPath;
  infoCard.appendChild(titleP);
  infoCard.appendChild(pathP);

  const formBox = doc.createElement('div');
  formBox.className = 'gemini-modal-form';

  const engineRow = doc.createElement('div');
  engineRow.className = 'gemini-form-group';
  const engineLabel = doc.createElement('label');
  engineLabel.textContent = '翻译引擎';
  const engineValue = doc.createElement('div');
  engineValue.className = 'gemini-readonly-value';
  engineValue.textContent = config.endpointType === 'deepseek'
    ? `DeepSeek API（${config.model || 'deepseek-chat'}）`
    : config.endpointType === 'gemini'
      ? 'Gemini 官方接口'
      : config.endpointType === 'openai'
        ? 'OpenAI 兼容接口'
        : '旧版本机 Agy';
  engineRow.appendChild(engineLabel);
  engineRow.appendChild(engineValue);

  const modeRow = doc.createElement('div');
  modeRow.className = 'gemini-form-group';
  const modeLabel = doc.createElement('label');
  modeLabel.textContent = '排版模式';
  const modeSelect = doc.createElement('select');
  modeSelect.className = 'gemini-select';
  const optMono = doc.createElement('option');
  optMono.value = 'mono';
  optMono.textContent = '单语译文';
  const optDual = doc.createElement('option');
  optDual.value = 'dual';
  optDual.textContent = '双语对照';
  modeSelect.appendChild(optMono);
  modeSelect.appendChild(optDual);
  modeSelect.value = config.docTranslateMode === 'dual' ? 'dual' : 'mono';
  modeRow.appendChild(modeLabel);
  modeRow.appendChild(modeSelect);

  const pagesRow = doc.createElement('div');
  pagesRow.className = 'gemini-form-group';
  const pagesLabel = doc.createElement('label');
  pagesLabel.textContent = '翻译范围';
  const pagesInput = doc.createElement('input');
  pagesInput.className = 'gemini-input';
  pagesInput.type = 'text';
  pagesInput.placeholder = '全部页面，也可填写 1-5';
  pagesRow.appendChild(pagesLabel);
  pagesRow.appendChild(pagesInput);

  const backgroundHint = doc.createElement('div');
  backgroundHint.className = 'gemini-background-hint';
  backgroundHint.textContent = '开始后可关闭此窗口，任务会在后台继续运行。';

  formBox.appendChild(engineRow);
  formBox.appendChild(modeRow);
  formBox.appendChild(pagesRow);
  formBox.appendChild(backgroundHint);

  const footer = doc.createElement('div');
  footer.className = 'gemini-modal-footer';
  const cancelBtn = doc.createElement('button');
  cancelBtn.className = 'gemini-btn-secondary';
  cancelBtn.type = 'button';
  cancelBtn.textContent = '取消';
  const startBtn = doc.createElement('button');
  startBtn.className = 'gemini-btn-primary';
  startBtn.type = 'button';
  startBtn.textContent = '后台翻译';
  footer.appendChild(cancelBtn);
  footer.appendChild(startBtn);

  dialog.appendChild(header);
  dialog.appendChild(infoCard);
  dialog.appendChild(formBox);
  dialog.appendChild(footer);
  backdrop.appendChild(dialog);

  const mountTarget = doc.body || doc.documentElement;
  if (!mountTarget) return;
  mountTarget.appendChild(backdrop);

  const closeModal = () => backdrop.remove();
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    const mode = modeSelect.value as 'mono' | 'dual';
    const pages = pagesInput.value.trim() || undefined;
    documentTranslationManager.start({
      doc,
      item,
      inputPdfPath,
      mode,
      pages,
      config,
      title: itemTitle,
    });
    // 任务已交给管理器，关闭弹窗不会中断子进程。
    closeModal();
  });
}
