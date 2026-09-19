import { clearChildren, copyTextToClipboard, MAX_IMAGE_ATTACHMENT_BYTES } from './env';
import { renderMarkdownInContainer } from './markdownRenderer';

export interface TranslationCardOptions {
  onClose?: () => void;
  onQuestion?: (question: string, images: File[]) => void;
}

export interface CardController {
  element: HTMLElement;
  setLoading: () => void;
  setStreaming: (accumulatedText: string) => void;
  setDone: (fullText: string, fromCache: boolean, enableKaTeX: boolean) => void;
  setError: (errorMsg: string, onRetry?: () => void) => void;
  setQuestionLoading: (question: string) => void;
  setQuestionStreaming: (accumulatedText: string) => void;
  setQuestionDone: (fullText: string, fromCache: boolean, enableKaTeX: boolean) => void;
  setQuestionError: (errorMsg: string, onRetry?: () => void) => void;
}

function renderTextContent(
  container: HTMLElement,
  text: string,
  enableKaTeX: boolean
): void {
  clearChildren(container);

  renderMarkdownInContainer(container, text, enableKaTeX);
}

function appendSkeleton(doc: Document, container: HTMLElement): void {
  clearChildren(container);
  const skeleton = doc.createElement('div');
  skeleton.className = 'gemini-skeleton';
  const line1 = doc.createElement('div');
  line1.className = 'gemini-skeleton-line';
  const line2 = doc.createElement('div');
  line2.className = 'gemini-skeleton-line short';
  skeleton.appendChild(line1);
  skeleton.appendChild(line2);
  container.appendChild(skeleton);
}

function appendStreamingText(doc: Document, container: HTMLElement, text: string): void {
  let textNode: HTMLElement | null = null;
  let cursor: HTMLElement | null = null;
  const first = container.firstElementChild as HTMLElement | null;
  if (first?.classList.contains('gemini-streaming-text')) {
    textNode = first;
    const next = first.nextElementSibling as HTMLElement | null;
    if (next?.classList.contains('gemini-cursor')) cursor = next;
  }

  if (!textNode) {
    clearChildren(container);
    textNode = doc.createElement('span');
    textNode.className = 'gemini-streaming-text';
    cursor = doc.createElement('span');
    cursor.className = 'gemini-cursor';
    container.appendChild(textNode);
    container.appendChild(cursor);
  }

  textNode.textContent = text;
  if (!cursor) {
    cursor = doc.createElement('span');
    cursor.className = 'gemini-cursor';
    container.appendChild(cursor);
  }
}

interface StreamingUpdater {
  reset: () => void;
  schedule: (text: string) => void;
  cancel: () => void;
}

function createStreamingUpdater(doc: Document, container: HTMLElement): StreamingUpdater {
  const view = doc.defaultView;
  let latestText = '';
  let frameId: number | null = null;

  const cancel = (): void => {
    if (frameId !== null) {
      view?.cancelAnimationFrame?.(frameId);
      frameId = null;
    }
  };

  const flush = (): void => {
    frameId = null;
    appendStreamingText(doc, container, latestText);
  };

  return {
    reset: () => {
      cancel();
      latestText = '';
    },
    schedule: (text: string) => {
      latestText = text;
      if (frameId !== null) return;
      if (view?.requestAnimationFrame) {
        frameId = view.requestAnimationFrame(flush);
      } else {
        flush();
      }
    },
    cancel: () => {
      cancel();
      latestText = '';
    },
  };
}

function appendError(
  doc: Document,
  container: HTMLElement,
  errorMsg: string,
  onRetry?: () => void
): void {
  clearChildren(container);
  const errorBox = doc.createElement('div');
  errorBox.className = 'gemini-error-box';

  const msgSpan = doc.createElement('span');
  msgSpan.textContent = errorMsg;
  errorBox.appendChild(msgSpan);

  if (onRetry) {
    const retryBtn = doc.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'gemini-btn-retry';
    retryBtn.textContent = '重试';
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRetry();
    });
    errorBox.appendChild(retryBtn);
  }

  container.appendChild(errorBox);
}

export function createTranslationCard(
  doc: Document,
  options: TranslationCardOptions = {}
): CardController {
  const shell = doc.createElement('div');
  shell.className = 'gemini-translation-shell';

  const card = doc.createElement('div');
  card.className = 'gemini-translate-card';

  const createIconButton = (label: string, className: string, icon: string): HTMLButtonElement => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `gemini-btn-icon ${className}`;
    button.dataset.icon = icon;
    button.setAttribute('aria-label', label);
    button.title = label;

    const accessibleLabel = doc.createElement('span');
    accessibleLabel.className = 'gemini-sr-only';
    accessibleLabel.textContent = label;
    button.appendChild(accessibleLabel);
    return button;
  };

  const header = doc.createElement('div');
  header.className = 'gemini-card-header';

  const headerLeft = doc.createElement('div');
  headerLeft.className = 'gemini-header-left';

  const title = doc.createElement('span');
  title.className = 'gemini-title';
  title.textContent = '划词翻译';

  const status = doc.createElement('span');
  status.className = 'gemini-status';
  status.setAttribute('aria-live', 'polite');
  status.textContent = '翻译中';

  headerLeft.appendChild(title);
  headerLeft.appendChild(status);

  const rightBtns = doc.createElement('div');
  rightBtns.className = 'gemini-header-right';

  const questionBtn = createIconButton('针对选中文本提问', 'gemini-btn-question', '?');
  questionBtn.setAttribute('aria-expanded', 'false');
  const copyBtn = createIconButton('复制译文', 'gemini-btn-copy', '⧉');
  const closeBtn = createIconButton('关闭翻译浮层', 'gemini-btn-close', '×');

  let currentCompletedText = '';
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentCompletedText) return;
    try {
      await copyTextToClipboard(doc, currentCompletedText);
      copyBtn.classList.add('copied');
      copyBtn.dataset.icon = '✓';
      copyBtn.setAttribute('aria-label', '已复制');
      copyBtn.title = '已复制';
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.dataset.icon = '⧉';
        copyBtn.setAttribute('aria-label', '复制译文');
        copyBtn.title = '复制译文';
      }, 1500);
    } catch (_) {
      copyBtn.classList.add('copy-failed');
      copyBtn.dataset.icon = '!';
      copyBtn.setAttribute('aria-label', '复制失败');
      copyBtn.title = '复制失败';
      setTimeout(() => {
        copyBtn.classList.remove('copy-failed');
        copyBtn.dataset.icon = '⧉';
        copyBtn.setAttribute('aria-label', '复制译文');
        copyBtn.title = '复制译文';
      }, 1500);
    }
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    options.onClose?.();
    const section = shell.closest?.('.section') as HTMLElement | null;
    if (section && section.querySelectorAll?.('.gemini-translate-card').length === 1) {
      section.remove();
    } else {
      shell.remove();
    }
  });

  const contentBox = doc.createElement('div');
  contentBox.className = 'gemini-content-box';
  const translationStream = createStreamingUpdater(doc, contentBox);

  const questionComposer = doc.createElement('form');
  questionComposer.className = 'gemini-question-composer';
  questionComposer.hidden = false;

  const questionInput = doc.createElement('textarea');
  questionInput.className = 'gemini-question-input';
  questionInput.rows = 2;
  questionInput.maxLength = 2000;
  questionInput.placeholder = '针对选中文本提问…';
  questionInput.setAttribute('aria-label', '针对选中文本提问');

  const questionAttachments = doc.createElement('div');
  questionAttachments.className = 'gemini-question-attachments';
  questionAttachments.hidden = true;

  const questionImageInput = doc.createElement('input');
  questionImageInput.type = 'file';
  questionImageInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml';
  questionImageInput.multiple = true;
  questionImageInput.className = 'gemini-question-image-input';
  questionImageInput.hidden = true;
  questionImageInput.setAttribute('aria-label', '选择图片');

  const selectedImageFiles: File[] = [];
  const previewUrls = new Map<File, string>();

  const renderQuestionAttachments = (): void => {
    clearChildren(questionAttachments);
    questionAttachments.hidden = selectedImageFiles.length === 0;
    for (const file of selectedImageFiles) {
      const chip = doc.createElement('div');
      chip.className = 'gemini-question-attachment';

      const preview = doc.createElement('img');
      preview.className = 'gemini-question-attachment-preview';
      let objectUrl = previewUrls.get(file);
      if (!objectUrl) {
        const urlApi = doc.defaultView?.URL || (typeof URL !== 'undefined' ? URL : null);
        objectUrl = urlApi?.createObjectURL?.(file) || '';
        if (objectUrl) previewUrls.set(file, objectUrl);
      }
      if (objectUrl) preview.src = objectUrl;
      preview.alt = '';
      chip.appendChild(preview);

      const name = doc.createElement('span');
      name.className = 'gemini-question-attachment-name';
      name.textContent = file.name || '图片';
      name.title = file.name || '图片';
      chip.appendChild(name);

      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'gemini-question-attachment-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `移除图片 ${file.name || ''}`);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        const index = selectedImageFiles.indexOf(file);
        if (index >= 0) selectedImageFiles.splice(index, 1);
        const urlApi = doc.defaultView?.URL || (typeof URL !== 'undefined' ? URL : null);
        const url = previewUrls.get(file);
        if (url) urlApi?.revokeObjectURL?.(url);
        previewUrls.delete(file);
        renderQuestionAttachments();
      });
      chip.appendChild(remove);
      questionAttachments.appendChild(chip);
    }
  };

  const addQuestionImage = (file: File | null): void => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      questionInput.setCustomValidity('请选择图片文件');
      questionInput.reportValidity?.();
      questionInput.setCustomValidity('');
      return;
    }
    if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      questionInput.setCustomValidity(`图片不能超过 ${Math.floor(MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024)} MB`);
      questionInput.reportValidity?.();
      questionInput.setCustomValidity('');
      return;
    }
    if (selectedImageFiles.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) {
      return;
    }
    if (selectedImageFiles.length >= 3) {
      questionInput.setCustomValidity('最多同时发送 3 张图片');
      questionInput.reportValidity?.();
      questionInput.setCustomValidity('');
      return;
    }
    selectedImageFiles.push(file);
    renderQuestionAttachments();
  };

  questionImageInput.addEventListener('change', () => {
    const files = Array.from(questionImageInput.files || []);
    files.forEach(addQuestionImage);
    questionImageInput.value = '';
  });

  questionInput.addEventListener('paste', (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    const file = imageItem?.getAsFile?.() || null;
    if (file) {
      event.preventDefault();
      addQuestionImage(file);
    }
  });

  const questionActions = doc.createElement('div');
  questionActions.className = 'gemini-question-actions';
  const questionImageButton = doc.createElement('button');
  questionImageButton.type = 'button';
  questionImageButton.className = 'gemini-question-image-button';
  questionImageButton.textContent = '图片';
  questionImageButton.title = '添加图片（也可以直接粘贴图片）';
  questionImageButton.addEventListener('click', (event) => {
    event.stopPropagation();
    questionImageInput.click();
  });
  const questionCancel = doc.createElement('button');
  questionCancel.type = 'button';
  questionCancel.className = 'gemini-question-cancel';
  questionCancel.textContent = '收起';
  const questionSubmit = doc.createElement('button');
  questionSubmit.type = 'submit';
  questionSubmit.className = 'gemini-question-submit';
  questionSubmit.textContent = '发送';
  questionActions.appendChild(questionImageButton);
  questionActions.appendChild(questionCancel);
  questionActions.appendChild(questionSubmit);
  questionComposer.appendChild(questionInput);
  questionComposer.appendChild(questionAttachments);
  questionComposer.appendChild(questionImageInput);
  questionComposer.appendChild(questionActions);

  questionComposer.addEventListener('dragover', (event) => {
    if (Array.from(event.dataTransfer?.items || []).some((item) => item.type.startsWith('image/'))) {
      event.preventDefault();
      questionComposer.classList.add('is-dragging');
    }
  });
  questionComposer.addEventListener('dragleave', () => {
    questionComposer.classList.remove('is-dragging');
  });
  questionComposer.addEventListener('drop', (event) => {
    questionComposer.classList.remove('is-dragging');
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    files.forEach(addQuestionImage);
  });

  const questionResult = doc.createElement('div');
  questionResult.className = 'gemini-result-pane gemini-question-result';
  questionResult.hidden = true;

  const questionResultHeader = doc.createElement('div');
  questionResultHeader.className = 'gemini-question-result-header';
  const questionResultLabel = doc.createElement('span');
  questionResultLabel.className = 'gemini-question-result-label';
  questionResultLabel.textContent = '回答';
  const questionResultPrompt = doc.createElement('span');
  questionResultPrompt.className = 'gemini-question-result-prompt';
  questionResultHeader.appendChild(questionResultLabel);
  questionResultHeader.appendChild(questionResultPrompt);

  const questionContent = doc.createElement('div');
  questionContent.className = 'gemini-question-content';
  const questionStream = createStreamingUpdater(doc, questionContent);
  questionResult.appendChild(questionResultHeader);
  questionResult.appendChild(questionContent);

  const questionPanel = doc.createElement('aside');
  questionPanel.className = 'gemini-question-panel';
  questionPanel.hidden = true;

  const questionPanelHeader = doc.createElement('div');
  questionPanelHeader.className = 'gemini-question-panel-header';
  const questionPanelTitle = doc.createElement('span');
  questionPanelTitle.className = 'gemini-question-panel-title';
  questionPanelTitle.textContent = 'AI 问答';
  const questionPanelClose = createIconButton('关闭问答侧边栏', 'gemini-question-panel-close', '×');
  questionPanelHeader.appendChild(questionPanelTitle);
  questionPanelHeader.appendChild(questionPanelClose);
  questionPanel.appendChild(questionPanelHeader);
  questionPanel.appendChild(questionComposer);
  questionPanel.appendChild(questionResult);

  const translationPane = doc.createElement('div');
  translationPane.className = 'gemini-result-pane gemini-translation-pane';
  const translationPaneHeader = doc.createElement('div');
  translationPaneHeader.className = 'gemini-result-pane-header';
  translationPaneHeader.textContent = '译文';
  translationPane.appendChild(translationPaneHeader);
  translationPane.appendChild(contentBox);

  const setQuestionPanelOpen = (open: boolean, focusInput = false): void => {
    questionPanel.hidden = !open;
    questionBtn.setAttribute('aria-expanded', String(open));
    questionBtn.classList.toggle('is-active', open);
    const view = doc.defaultView;
    if (!open) {
      questionResult.hidden = true;
      card.classList.remove('has-question');
      questionPanel.classList.remove('is-left', 'is-below');
      questionPanel.style.left = '';
      questionPanel.style.right = '';
      questionPanel.style.top = '';
      questionPanel.style.maxWidth = '';
      view?.removeEventListener?.('resize', repositionQuestionPanel);
      return;
    }

    repositionQuestionPanel();
    view?.addEventListener?.('resize', repositionQuestionPanel);
    if (focusInput) {
      setTimeout(() => questionInput.focus(), 0);
    }
  };

  const repositionQuestionPanel = (): void => {
    if (questionPanel.hidden) return;
    const view = doc.defaultView;
    const rect = shell.getBoundingClientRect?.();
    if (!rect) return;

    const margin = 12;
    const gap = 8;
    const viewportWidth = Math.max(1, view?.innerWidth || 1024);
    const viewportHeight = Math.max(1, view?.innerHeight || 768);
    const panelWidth = Math.min(340, Math.max(1, viewportWidth - margin * 2));

    questionPanel.classList.remove('is-left', 'is-below');
    questionPanel.style.left = '';
    questionPanel.style.right = '';
    questionPanel.style.top = '';
    questionPanel.style.maxWidth = `${panelWidth}px`;

    const measuredWidth = Math.min(panelWidth, questionPanel.getBoundingClientRect?.().width || panelWidth);
    const rightFits = rect.right + gap + measuredWidth <= viewportWidth - margin;
    const leftFits = rect.left - gap - measuredWidth >= margin;

    let mode: 'right' | 'left' | 'below' = rightFits ? 'right' : leftFits ? 'left' : 'below';
    if (mode === 'left') {
      questionPanel.classList.add('is-left');
    } else if (mode === 'below') {
      questionPanel.classList.add('is-below');
    }

    const panelHeight = Math.min(
      questionPanel.scrollHeight || questionPanel.getBoundingClientRect?.().height || 0,
      Math.max(1, viewportHeight - margin * 2)
    );
    const preferredTop = mode === 'below' ? rect.bottom + gap : rect.top;
    const topViewport = Math.min(
      Math.max(preferredTop, margin),
      Math.max(margin, viewportHeight - panelHeight - margin)
    );
    questionPanel.style.top = `${Math.round(topViewport - rect.top)}px`;

    if (mode === 'right') {
      questionPanel.style.left = `${Math.round(rect.width + gap)}px`;
    } else if (mode === 'left') {
      questionPanel.style.right = `calc(100% + ${gap}px)`;
    } else {
      const panelLeft = Math.min(
        Math.max(rect.left, margin),
        Math.max(margin, viewportWidth - measuredWidth - margin)
      );
      questionPanel.style.left = `${Math.round(panelLeft - rect.left)}px`;
    }
  };

  questionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    setQuestionPanelOpen(questionPanel.hidden, questionPanel.hidden);
  });

  questionPanelClose.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    setQuestionPanelOpen(false);
  });

  questionCancel.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    setQuestionPanelOpen(false);
  });

  questionPanel.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  questionComposer.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  questionComposer.addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const typedQuestion = questionInput.value.trim();
    if ((!typedQuestion && selectedImageFiles.length === 0) || !options.onQuestion) {
      questionInput.focus();
      return;
    }
    const question = typedQuestion || '请分析附图，并结合选中文本回答。';
    const images = selectedImageFiles.slice();
    selectedImageFiles.splice(0, selectedImageFiles.length);
    for (const url of previewUrls.values()) {
      const urlApi = doc.defaultView?.URL || (typeof URL !== 'undefined' ? URL : null);
      urlApi?.revokeObjectURL?.(url);
    }
    previewUrls.clear();
    renderQuestionAttachments();
    options.onQuestion(question, images);
  });

  rightBtns.appendChild(questionBtn);
  rightBtns.appendChild(copyBtn);
  rightBtns.appendChild(closeBtn);
  header.appendChild(headerLeft);
  header.appendChild(rightBtns);

  card.appendChild(header);
  card.appendChild(translationPane);
  shell.appendChild(card);
  shell.appendChild(questionPanel);

  const setStatus = (text: string, state: string): void => {
    status.textContent = text;
    status.dataset.state = state;
    if (state !== 'cached' && state !== 'error') {
      status.title = '';
    }
  };

  const showQuestion = (question: string, expandComposer = true): void => {
    questionResult.hidden = false;
    card.classList.add('has-question');
    setQuestionPanelOpen(true, expandComposer);
    questionResultPrompt.textContent = question;
  };

  const controller: CardController = {
    element: shell,

    setLoading() {
      translationStream.reset();
      setStatus('翻译中', 'loading');
      currentCompletedText = '';
      copyBtn.disabled = true;
      appendSkeleton(doc, contentBox);
    },

    setStreaming(accumulatedText: string) {
      setStatus('翻译中', 'streaming');
      currentCompletedText = accumulatedText;
      copyBtn.disabled = !accumulatedText;
      translationStream.schedule(accumulatedText);
    },

    setDone(fullText: string, fromCache: boolean, enableKaTeX: boolean) {
      translationStream.cancel();
      currentCompletedText = fullText;
      setStatus('已完成', fromCache ? 'cached' : 'complete');
      status.title = fromCache ? '来自本地缓存' : '';
      copyBtn.disabled = !fullText;
      renderTextContent(contentBox, fullText, enableKaTeX);
    },

    setError(errorMsg: string, onRetry?: () => void) {
      translationStream.cancel();
      setStatus('失败', 'error');
      status.title = errorMsg;
      copyBtn.disabled = !currentCompletedText;
      appendError(doc, contentBox, errorMsg, onRetry);
    },

    setQuestionLoading(question: string) {
      questionStream.reset();
      showQuestion(question);
      questionSubmit.disabled = true;
      appendSkeleton(doc, questionContent);
    },

    setQuestionStreaming(accumulatedText: string) {
      showQuestion(questionResultPrompt.textContent || '', false);
      questionSubmit.disabled = true;
      questionStream.schedule(accumulatedText);
    },

    setQuestionDone(fullText: string, _fromCache: boolean, enableKaTeX: boolean) {
      questionStream.cancel();
      questionSubmit.disabled = false;
      renderTextContent(questionContent, fullText, enableKaTeX);
    },

    setQuestionError(errorMsg: string, onRetry?: () => void) {
      questionStream.cancel();
      questionSubmit.disabled = false;
      appendError(doc, questionContent, errorMsg, onRetry);
    },
  };

  controller.setLoading();
  return controller;
}
