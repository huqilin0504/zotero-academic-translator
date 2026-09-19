import katex from 'katex';

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

export function renderMathToHtml(text: string): string {
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

export function findNextMath(text: string, start = 0): MathMatch | null {
  for (let index = Math.max(0, start); index < text.length; index += 1) {
    if (isEscaped(text, index)) continue;

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

    const environment = matchMathEnvironment(text, index);
    if (environment) return environment;

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

export function normalizeBareMathNotation(text: string): string {
  if (
    !text ||
    (!/[∈∉⊂⊆=≈≤≥]/u.test(text) &&
      !/[A-Za-z]\s+[A-Za-z0-9]/u.test(text) &&
      !/[A-Za-z]\s*[_^]/u.test(text) &&
      !/[A-Za-z](?=[ \t]*(?:表示|代表|个|设为|设定为|对应|数值|值为|represents|denotes|stands for|is set to))/u.test(text))
  ) {
    return text;
  }

  const atom = String.raw`(?:\{[^{}\r\n]{1,80}\}|\([^()\r\n]{1,80}\)|[A-Za-z0-9⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉ᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿˢᵀᵁⱽᵂ]+)`;
  const pattern = new RegExp(
    String.raw`(^|[^\\\p{L}\p{N}_$])` +
      String.raw`([A-Za-z](?:[_^](?:\{[^{}\r\n]{1,40}\}|[A-Za-z0-9]+))?)` +
      String.raw`[ \t]*(∈|∉|⊂|⊆|=|≈|≤|≥)[ \t]*R[ \t]*(?:\^|_)?[ \t]*` +
      String.raw`(${atom}(?:[ \t]*(?:×|x|·|\*)[ \t]*${atom}){1,4})`,
    'gu'
  );
  const flattenedScriptPattern = new RegExp(
    String.raw`(^|[^\\\p{L}\p{N}_$])` +
      String.raw`([A-Za-z])\s+([A-Za-z0-9](?:\s*[−–-]\s*[A-Za-z0-9])?)` +
      String.raw`(?=[ \t]*(?:表示|代表|为|的|对应|数值|值|个|区域|图像块|` +
      String.raw`represents|denotes|stands for|is|value|of)(?![A-Za-z]))`,
    'gu'
  );
  const markedScriptPattern = new RegExp(
    String.raw`(^|(?<![A-Za-z0-9_$\\]))` +
      String.raw`([A-Za-z])` +
      String.raw`((?:\s*[_^]\s*(?:\{[^{}\r\n]{1,40}\}|[A-Za-z0-9](?:[A-Za-z0-9+\-−–]{0,39}))){1,3})` +
      String.raw`(?=[ \t]*(?:表示|代表|为|的|对应|数值|值|个|区域|图像块|是|` +
      String.raw`represents|denotes|stands for|is|value|of|[,.;:，。；：！？!?）\])|$)(?![A-Za-z]))`,
    'gu'
  );
  const bareVariablePattern = new RegExp(
    String.raw`(^|(?<![A-Za-z0-9_$\\]))` +
      String.raw`([A-Za-z])` +
      String.raw`(?=[ \t]*(?:表示|代表|个|设为|设定为|对应|数值|值为|` +
      String.raw`represents|denotes|stands for|is set to)(?![A-Za-z]))`,
    'gu'
  );

  let result = '';
  let cursor = 0;
  while (cursor < text.length) {
    const explicit = findNextMath(text, cursor);
    pattern.lastIndex = cursor;
    flattenedScriptPattern.lastIndex = cursor;
    markedScriptPattern.lastIndex = cursor;
    bareVariablePattern.lastIndex = cursor;
    const tensor = pattern.exec(text);
    const flattenedScript = flattenedScriptPattern.exec(text);
    const markedScript = markedScriptPattern.exec(text);
    const bareVariable = bareVariablePattern.exec(text);
    let bare = tensor;
    let kind: 'tensor' | 'script' | 'marked-script' | 'variable' = 'tensor';
    if (flattenedScript && (!bare || flattenedScript.index < bare.index)) {
      bare = flattenedScript;
      kind = 'script';
    }
    if (markedScript && (!bare || markedScript.index < bare.index)) {
      bare = markedScript;
      kind = 'marked-script';
    }
    if (bareVariable && (!bare || bareVariable.index < bare.index)) {
      bare = bareVariable;
      kind = 'variable';
    }

    if (explicit && (!bare || explicit.start <= bare.index)) {
      result += text.slice(cursor, explicit.end);
      cursor = explicit.end;
      continue;
    }
    if (!bare) {
      result += text.slice(cursor);
      break;
    }

    const prefix = kind === 'marked-script' || kind === 'variable' ? '' : bare[1] || '';
    const start = bare.index + prefix.length;
    if (start > cursor) result += text.slice(cursor, start);

    if (kind === 'script') {
      const base = bare[2];
      const script = bare[3].replace(/[−–]/gu, '-').replace(/\s+/g, '');
      result += `$${base}^{${script}}$`;
    } else if (kind === 'marked-script') {
      const base = bare[2];
      const parts = Array.from(
        bare[3].matchAll(/([_^])\s*(\{[^{}\r\n]{1,40}\}|[A-Za-z0-9](?:[A-Za-z0-9+\-−–]{0,39}))/gu),
        ([, operator, rawScript]) => {
          const script = rawScript.replace(/[−–]/gu, '-').replace(/^\{([\s\S]*)\}$/, '$1');
          return `${operator}{${script}}`;
        }
      ).join('');
      result += `$${base}${parts}$`;
    } else if (kind === 'variable') {
      result += `$${bare[2]}$`;
    } else {
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
      result += `$${left} ${latexOperator[operator] || operator} \\mathbb{R}^{${dimensions}}$`;
    }
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

  if (/[\\^_={}()[\]|<>+=*/]/.test(trimmed)) return true;
  if (/^[A-Za-z](?:[A-Za-z0-9]*)$/.test(trimmed)) return true;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return true;
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
