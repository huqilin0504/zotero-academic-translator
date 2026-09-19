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
  // 划词翻译的 PDF 文本层有时会把公式分隔符和上/下标排版信息丢掉，
  // 例如模型返回“L ∈ RB×N×S”而不是带 $...$ 的 LaTeX。先恢复这类
  // 明确的张量维度表达式，再交给同一套 KaTeX 扫描器，避免它退化成普通正文。
  const normalizedText = normalizeBareMathNotation(normalizeModelMathEscaping(text));
  if (!normalizedText || !containsMathSyntax(normalizedText)) {
    return escapePlainText(normalizedText);
  }

  let html = '';
  let plainStart = 0;
  let cursor = 0;
  while (cursor < normalizedText.length) {
    const match = findNextMath(normalizedText, cursor);
    if (!match) break;

    html += escapePlainText(normalizedText.slice(plainStart, match.start));
    html += renderMathMatch(match);
    cursor = match.end;
    plainStart = cursor;
  }

  html += escapePlainText(normalizedText.slice(plainStart));
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

/**
 * 一些 OpenAI 兼容 API 会把模型原本输出的 LaTeX 反斜杠再次转义，导致
 * `\\(`、`\\[` 或 `\\frac` 到达渲染器时变成两个反斜杠。JSON.parse
 * 只会去掉传输层转义，不能修复这种模型文本本身的重复转义；这里仅处理
 * 数学分隔符，避免普通正文中的反斜杠被意外改写。
 */
export function normalizeModelMathEscaping(text: string): string {
  if (!text) return text;

  let result = '';
  let cursor = 0;
  let mode: { kind: 'inline' | 'display' | 'environment'; environment?: string } | null = null;

  while (cursor < text.length) {
    if (!mode) {
      if (text.startsWith('\\\\(', cursor)) {
        result += '\\(';
        cursor += 2;
        mode = { kind: 'inline' };
        continue;
      }
      if (text.startsWith('\\\\[', cursor)) {
        result += '\\[';
        cursor += 2;
        mode = { kind: 'display' };
        continue;
      }

      const duplicateEnvironment = readMathEnvironmentAt(text, cursor, true, 'begin');
      if (duplicateEnvironment) {
        result += '\\begin{' + duplicateEnvironment.name + '}';
        cursor = duplicateEnvironment.end;
        mode = { kind: 'environment', environment: duplicateEnvironment.name };
        continue;
      }

      if (text.startsWith('\\(', cursor)) {
        result += '\\(';
        cursor += 2;
        mode = { kind: 'inline' };
        continue;
      }
      if (text.startsWith('\\[', cursor)) {
        result += '\\[';
        cursor += 2;
        mode = { kind: 'display' };
        continue;
      }

      const environment = readMathEnvironmentAt(text, cursor, false, 'begin');
      if (environment) {
        result += text.slice(cursor, environment.end);
        cursor = environment.end;
        mode = { kind: 'environment', environment: environment.name };
        continue;
      }

      if (text.startsWith('$$', cursor) && !isEscaped(text, cursor)) {
        result += '$$';
        cursor += 2;
        mode = { kind: 'display' };
        continue;
      }
      if (text[cursor] === '$' && !isEscaped(text, cursor) && text[cursor + 1] !== '$') {
        result += '$';
        cursor += 1;
        mode = { kind: 'inline' };
        continue;
      }

      result += text[cursor];
      cursor += 1;
      continue;
    }

    if (mode.kind === 'environment') {
      const duplicateEnd = readMathEnvironmentAt(text, cursor, true, 'end');
      if (duplicateEnd && duplicateEnd.name === mode.environment) {
        result += '\\end{' + duplicateEnd.name + '}';
        cursor = duplicateEnd.end;
        mode = null;
        continue;
      }
      const end = readMathEnvironmentAt(text, cursor, false, 'end');
      if (end && end.name === mode.environment) {
        result += text.slice(cursor, end.end);
        cursor = end.end;
        mode = null;
        continue;
      }
    } else if (mode.kind === 'inline') {
      if (text.startsWith('\\\\)', cursor)) {
        result += '\\)';
        cursor += 2;
        mode = null;
        continue;
      }
      if (text.startsWith('\\)', cursor)) {
        result += '\\)';
        cursor += 2;
        mode = null;
        continue;
      }
      if (text[cursor] === '$' && !isEscaped(text, cursor)) {
        result += '$';
        cursor += 1;
        mode = null;
        continue;
      }
    } else if (mode.kind === 'display') {
      if (text.startsWith('\\\\]', cursor)) {
        result += '\\]';
        cursor += 2;
        mode = null;
        continue;
      }
      if (text.startsWith('\\]', cursor)) {
        result += '\\]';
        cursor += 2;
        mode = null;
        continue;
      }
      if (text.startsWith('$$', cursor) && !isEscaped(text, cursor)) {
        result += '$$';
        cursor += 2;
        mode = null;
        continue;
      }
    }

    // 公式内部的双反斜杠通常是 API 对 LaTeX 命令的重复转义。
    // 三反斜杠序列和后接方括号的行距写法必须保留，避免破坏矩阵换行。
    if (
      text.startsWith('\\\\', cursor) &&
      text[cursor - 1] !== '\\' &&
      /^[A-Za-z]{2,}/.test(text.slice(cursor + 2))
    ) {
      result += '\\';
      cursor += 2;
      continue;
    }

    result += text[cursor];
    cursor += 1;
  }

  return result;
}

/**
 * 恢复 API/PDF 文本中丢失分隔符的常见张量维度公式。
 *
 * 这里只处理带集合关系且包含至少两个维度的明确形态，例如
 * “L ∈ RB×N×S”或“P ∈ R(N+1)×D”。普通单词和已经被 $...$、\(...\)
 * 或 \[...\] 包住的公式不会进入该规则，避免把正文误判成数学表达式。
 */
export function normalizeBareMathNotation(text: string): string {
  if (!text || !/[∈∉⊂⊆=≈≤≥]/u.test(text)) return text;

  const atom = String.raw`(?:\{[^{}\r\n]{1,80}\}|\([^()\r\n]{1,80}\)|[A-Za-z0-9⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉ᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿˢᵀᵁⱽᵂ]+)`;
  const pattern = new RegExp(
    String.raw`(^|[^\\\p{L}\p{N}_$])` +
      String.raw`([A-Za-z](?:[_^](?:\{[^{}\r\n]{1,40}\}|[A-Za-z0-9]+))?)` +
      String.raw`[ \t]*(∈|∉|⊂|⊆|=|≈|≤|≥)[ \t]*R[ \t]*(?:\^|_)?[ \t]*` +
      String.raw`(${atom}(?:[ \t]*(?:×|x|·|\*)[ \t]*${atom}){1,4})`,
    'gu'
  );

  let result = '';
  let cursor = 0;
  while (cursor < text.length) {
    const explicit = findNextMath(text, cursor);
    pattern.lastIndex = cursor;
    const bare = pattern.exec(text);

    // 已有的数学分隔符优先；裸公式匹配只在普通文本区间内生效。
    if (explicit && (!bare || explicit.start <= bare.index)) {
      result += text.slice(cursor, explicit.end);
      cursor = explicit.end;
      continue;
    }
    if (!bare) {
      result += text.slice(cursor);
      break;
    }

    const prefix = bare[1] || '';
    const start = bare.index + prefix.length;
    if (start > cursor) result += text.slice(cursor, start);

    const left = bare[2];
    const operator = bare[3];
    const rawDimensions = bare[4].replace(/[{}]/g, '');
    const dimensions = rawDimensions
      .replace(/[×·]/gu, String.raw`\times `)
      .replace(/\bx\b/gu, String.raw`\times `)
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/gu, (value) => value);
    const latexOperator: Record<string, string> = {
      '∈': String.raw`\in`,
      '∉': String.raw`\notin`,
      '⊂': String.raw`\subset`,
      '⊆': String.raw`\subseteq`,
      '=': '=',
      '≈': String.raw`\approx`,
      '≤': String.raw`\le`,
      '≥': String.raw`\ge`,
    };
    const replacement = `$${left} ${latexOperator[operator] || operator} \\mathbb{R}^{${dimensions}}$`;
    result += replacement;
    cursor = bare.index + bare[0].length;
  }
  return result;
}

function readMathEnvironmentAt(
  text: string,
  index: number,
  duplicatedSlash: boolean,
  keyword: 'begin' | 'end'
): { name: string; end: number } | null {
  const prefix = duplicatedSlash ? '\\\\' + keyword + '{' : '\\' + keyword + '{';
  if (!text.startsWith(prefix, index)) return null;
  const nameStart = index + prefix.length;
  const close = text.indexOf('}', nameStart);
  if (close === -1) return null;
  const name = text.slice(nameStart, close);
  if (!/^[A-Za-z][A-Za-z0-9*]*$/.test(name) || !isMathEnvironment(name)) return null;
  return { name, end: close + 1 };
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
