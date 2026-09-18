import katex from 'katex';

/**
 * 可识别的数学片段。扫描器只负责定位公式，最终 HTML 仍由 KaTeX 生成。
 * 这样划词翻译、提问回答和 Markdown 混排会共享完全相同的分隔符规则。
 */
export interface MathMatch {
  start: number;
  end: number;
  content: string;
  displayMode: boolean;
  opening: string;
  closing: string;
}

const MATH_ENVIRONMENTS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'aligned',
  'alignedat',
  'gather',
  'gather*',
  'gathered',
  'multline',
  'multline*',
  'split',
  'cases',
  'dcases',
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
  'array',
]);

/**
 * 将包含 LaTeX 语法的纯文本转换为安全 HTML。
 *
 * 支持 Markdown 常见的美元分隔符，也支持 LaTeX 原生的 \(...\)、\[...\]
 * 和常见数学环境。普通模型文本会先转义，只有 KaTeX 生成的标记进入 innerHTML。
 */
export function renderMathToHtml(text: string): string {
  if (!text || !containsMathSyntax(text)) {
    return escapePlainText(text);
  }

  let html = '';
  let plainStart = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const match = findNextMath(text, cursor);
    if (!match) break;

    html += escapePlainText(text.slice(plainStart, match.start));
    html += renderMathMatch(match);
    cursor = match.end;
    plainStart = cursor;
  }

  html += escapePlainText(text.slice(plainStart));
  return html;
}

/**
 * 查找从 start 开始的下一个公式。Markdown 渲染器也使用这个扫描器，
 * 以免出现“纯翻译能渲染、Markdown 回答不能渲染”的分叉行为。
 */
export function findNextMath(text: string, start = 0): MathMatch | null {
  for (let index = Math.max(0, start); index < text.length; index += 1) {
    if (isEscaped(text, index)) continue;

    // 块级美元公式：$$...$$
    if (text.startsWith('$$', index)) {
      const close = findClosingToken(text, index + 2, '$$', true);
      if (close !== -1) {
        return {
          start: index,
          end: close + 2,
          content: text.slice(index + 2, close),
          displayMode: true,
          opening: '$$',
          closing: '$$',
        };
      }
    }

    // LaTeX 原生块级公式：\[...\]
    if (text.startsWith('\\[', index)) {
      const close = findClosingToken(text, index + 2, '\\]', true);
      if (close !== -1) {
        return {
          start: index,
          end: close + 2,
          content: text.slice(index + 2, close),
          displayMode: true,
          opening: '\\[',
          closing: '\\]',
        };
      }
    }

    // 常见的数学环境可以直接交给 KaTeX，例如 aligned、equation、matrix。
    const environment = matchMathEnvironment(text, index);
    if (environment) return environment;

    // LaTeX 原生行内公式：\(...\)
    if (text.startsWith('\\(', index)) {
      const close = findClosingToken(text, index + 2, '\\)', false);
      if (close !== -1) {
        return {
          start: index,
          end: close + 2,
          content: text.slice(index + 2, close),
          displayMode: false,
          opening: '\\(',
          closing: '\\)',
        };
      }
    }

    // 行内美元公式：允许公式内部有空格，但不把单独的货币金额当成公式。
    if (text[index] === '$' && text[index + 1] !== '$') {
      const close = findClosingToken(text, index + 1, '$', false);
      if (close !== -1) {
        const content = text.slice(index + 1, close);
        if (isLikelyInlineDollarMath(content)) {
          return {
            start: index,
            end: close + 1,
            content,
            displayMode: false,
            opening: '$',
            closing: '$',
          };
        }
      }
    }
  }

  return null;
}

/** 直接在给定 DOM 容器中完成 KaTeX 排版与富文本挂载。 */
export function renderMathInContainer(container: HTMLElement, text: string): void {
  container.innerHTML = renderMathToHtml(text);
}

function containsMathSyntax(text: string): boolean {
  return text.includes('$') || text.includes('\\(') || text.includes('\\[') || text.includes('\\begin{');
}

function renderMathMatch(match: MathMatch): string {
  return renderFormula(match.content, match.displayMode, match.opening, match.closing);
}

function renderFormula(
  mathContent: string,
  displayMode: boolean,
  opening: string,
  closing: string
): string {
  try {
    return katex.renderToString(mathContent.trim(), {
      displayMode,
      throwOnError: false,
      output: 'html',
      trust: false,
    });
  } catch (_) {
    const tag = displayMode ? 'div' : 'span';
    return `<${tag} class="katex-error">${escapeHtml(opening + mathContent + closing)}</${tag}>`;
  }
}

function matchMathEnvironment(text: string, index: number): MathMatch | null {
  if (!text.startsWith('\\begin{', index)) return null;

  const openingMatch = text.slice(index).match(/^\\begin\{([A-Za-z][A-Za-z0-9*]*)\}/);
  if (!openingMatch || !isMathEnvironment(openingMatch[1])) return null;

  const opening = openingMatch[0];
  const environmentName = openingMatch[1];
  const closing = `\\end{${environmentName}}`;
  const close = findClosingToken(text, index + opening.length, closing, true);
  if (close === -1) return null;

  return {
    start: index,
    end: close + closing.length,
    // 环境本身（而不是只保留内部文本）交给 KaTeX，才能正确处理 aligned/matrix 的列结构。
    content: text.slice(index, close + closing.length),
    displayMode: true,
    opening,
    closing,
  };
}

function isMathEnvironment(name: string): boolean {
  return MATH_ENVIRONMENTS.has(name);
}

function isLikelyInlineDollarMath(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed || /[\r\n]/.test(content)) return false;

  // 运算符、控制序列和结构符号是最可靠的公式信号。
  if (/[\\^_={}()[\]|<>+=*/]/.test(trimmed)) return true;
  // 单个变量或纯数值仍是合法的短公式。
  if (/^[A-Za-z](?:[A-Za-z0-9]*)$/.test(trimmed)) return true;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return true;
  // 没有空格的短 token（例如数学标签）保持兼容。
  return !/\s/.test(content) && trimmed.length <= 80;
}

function findClosingToken(text: string, start: number, delimiter: string, allowNewlines: boolean): number {
  for (let index = start; index <= text.length - delimiter.length; index += 1) {
    if (!allowNewlines && /[\r\n]/.test(text[index])) return -1;
    if (text.startsWith(delimiter, index) && !isEscaped(text, index)) return index;
  }
  return -1;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapePlainText(str: string): string {
  return escapeHtml(str).replace(/\r?\n/g, '<br>');
}
