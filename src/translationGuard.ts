export interface TranslationGuardResult {
  ok: boolean;
  text?: string;
  errors: string[];
}

interface FormulaLock {
  token: string;
  source: string;
  kind: 'explicit' | 'display' | 'inline' | 'symbol';
}

const TOKEN_PATTERN = /FORMULA_TOKEN_[0-9]+/g;
const RELATION_PATTERN = /[=∈∉⊂⊆≤≥≈≠<>]/gu;
const RELATION_SOURCE_PATTERN = /\\(?:notin|in|subseteq?|leq?|geq?|approx|neq|ne)\b|[=＝∈∉⊂⊆≤≥≈≠<>]/gu;
const MATH_SYMBOL_PATTERN = /[∑Σ∏√∫∂∞×÷±]/gu;
const NUMBER_PATTERN = /(?<![A-Za-z])\d+(?:[.,]\d+)?/gu;
const SCRIPT_PATTERN = /(?<![A-Za-z0-9])([A-Za-z](?:(?:[_^]\s*(?:\{[^{}\r\n]{1,40}\}|[A-Za-z0-9]+))){1,3})(?![A-Za-z0-9])/gu;

function countOccurrences(text: string, token: string): number {
  return text.split(token).length - 1;
}

interface ExplicitMathMatch {
  start: number;
  end: number;
  raw: string;
  display: boolean;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function findUnescapedClosing(text: string, start: number, closing: string): number {
  let cursor = start;
  while (cursor < text.length) {
    const index = text.indexOf(closing, cursor);
    if (index === -1) return -1;
    if (!isEscaped(text, index)) return index;
    cursor = index + closing.length;
  }
  return -1;
}

function isLikelyInlineDollarMath(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed || /[\r\n]/u.test(content)) return false;
  if (/[\\^_={}()[\]|<>+=*/]/u.test(trimmed)) return true;
  if (/^[A-Za-z](?:[A-Za-z0-9]*)$/u.test(trimmed)) return true;
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) return true;
  return !/\s/u.test(content) && trimmed.length <= 80;
}

function findNextExplicitMath(text: string, start = 0): ExplicitMathMatch | null {
  for (let index = Math.max(0, start); index < text.length; index += 1) {
    if (isEscaped(text, index)) continue;

    if (text.startsWith('$$', index)) {
      const close = findUnescapedClosing(text, index + 2, '$$');
      if (close !== -1) {
        return { start: index, end: close + 2, raw: text.slice(index, close + 2), display: true };
      }
    }

    if (text.startsWith('\\[', index)) {
      const close = findUnescapedClosing(text, index + 2, '\\]');
      if (close !== -1) {
        return { start: index, end: close + 2, raw: text.slice(index, close + 2), display: true };
      }
    }

    if (text.startsWith('\\(', index)) {
      const close = findUnescapedClosing(text, index + 2, '\\)');
      if (close !== -1) {
        return { start: index, end: close + 2, raw: text.slice(index, close + 2), display: false };
      }
    }

    const environment = /^\\begin\{([A-Za-z][A-Za-z*]*)\}/u.exec(text.slice(index));
    if (environment) {
      const closing = '\\end{' + environment[1] + '}';
      const close = findUnescapedClosing(text, index + environment[0].length, closing);
      if (close !== -1) {
        return { start: index, end: close + closing.length, raw: text.slice(index, close + closing.length), display: true };
      }
    }

    if (text[index] === '$' && text[index + 1] !== '$') {
      const close = findUnescapedClosing(text, index + 1, '$');
      const content = close === -1 ? '' : text.slice(index + 1, close);
      if (close !== -1 && isLikelyInlineDollarMath(content)) {
        return { start: index, end: close + 1, raw: text.slice(index, close + 1), display: false };
      }
    }
  }
  return null;
}

function normalizeTokenWrappers(text: string): string {
  return text
    .replace(/\x60(FORMULA_TOKEN_[0-9]+)\x60/g, '$1')
    .replace(/\$+\s*(FORMULA_TOKEN_[0-9]+)\s*\$+/g, '$1')
    .replace(/\\\(\s*(FORMULA_TOKEN_[0-9]+)\s*\\\)/g, '$1');
}

function stripTokens(text: string): string {
  return text.replace(TOKEN_PATTERN, '');
}

function relationSignature(text: string): string {
  const normalized = text
    .replace(/＝/gu, '=')
    .replace(/\\(?:notin|in|subseteq?|le|ge|approx|neq)\b/gu, (value) => {
      const map: Record<string, string> = {
        '\\in': '∈',
        '\\notin': '∉',
        '\\subset': '⊂',
        '\\subseteq': '⊆',
        '\\le': '≤',
        '\\ge': '≥',
        '\\approx': '≈',
        '\\neq': '≠',
      };
      return map[value] || value;
    });
  return normalized.match(RELATION_PATTERN)?.join('') || '';
}

function scriptSignature(text: string): string {
  return Array.from(text.matchAll(SCRIPT_PATTERN), ([, value]) => value.replace(/\s+/g, '')).join('|');
}

function numberSignature(text: string): string {
  return Array.from(text.matchAll(NUMBER_PATTERN), ([value]) => value).join('|');
}

function looksLikeBareFormulaLine(value: string): boolean {
  if (!value || value.length > 800 || value.includes('FORMULA_TOKEN_')) return false;
  if (!/[=∈∉⊂⊆≤≥≈≠]/u.test(value)) return false;

  const signals = value.match(/[=∈∉⊂⊆≤≥≈≠_^\{\}\\∑Σ∏√∫∂∞×÷±]/gu)?.length || 0;
  const words = value.match(/[A-Za-z]{2,}/gu)?.length || 0;
  return signals >= 2 && (
    signals >= words ||
    /\\(?:frac|sum|prod|sqrt|int|begin|mathcal|mathbf|mathrm)\b/u.test(value) ||
    /[∑Σ∏√∫]/u.test(value)
  );
}

function restoreLock(lock: FormulaLock): string {
  if (lock.kind === 'display') return '$$' + lock.source + '$$';
  if (lock.kind === 'inline') return '$' + lock.source + '$';
  return lock.source;
}

export function createTranslationFidelityGuard(source: string): {
  enabled: boolean;
  sourceForModel: string;
  instruction: string;
  validate: (output: string) => TranslationGuardResult;
} {
  const locks: FormulaLock[] = [];
  let protectedText = String(source || '');

  const explicitMatches: Array<{ start: number; end: number; raw: string; display: boolean }> = [];
  let cursor = 0;
  while (cursor < protectedText.length) {
    const match = findNextExplicitMath(protectedText, cursor);
    if (!match) break;
    explicitMatches.push({
      start: match.start,
      end: match.end,
      raw: protectedText.slice(match.start, match.end),
      display: match.display,
    });
    cursor = match.end;
  }

  for (let index = explicitMatches.length - 1; index >= 0; index -= 1) {
    const match = explicitMatches[index];
    const token = 'FORMULA_TOKEN_' + index;
    locks.unshift({
      token,
      source: match.raw,
      kind: 'explicit',
    });
    protectedText = protectedText.slice(0, match.start) + token + protectedText.slice(match.end);
  }

  protectedText = protectedText.replace(/^([ \t]*)([^\r\n]*?)([ \t]*)$/gmu, (line, prefix: string, body: string, suffix: string) => {
    const trimmed = body.trim();
    if (!looksLikeBareFormulaLine(trimmed)) return line;
    const token = 'FORMULA_TOKEN_' + locks.length;
    locks.push({ token, source: trimmed, kind: 'display' });
    return prefix + token + suffix;
  });

  protectedText = protectedText.replace(SCRIPT_PATTERN, (value: string) => {
    const token = 'FORMULA_TOKEN_' + locks.length;
    locks.push({ token, source: value, kind: 'inline' });
    return token;
  });

  protectedText = protectedText.replace(
    /(?<![A-Za-z0-9])([A-Za-z])(?=[ \t]*(?:stands for|represents|denotes|is|表示|代表|设为|设定为|是)(?![A-Za-z]))/gu,
    (value: string) => {
      const token = 'FORMULA_TOKEN_' + locks.length;
      locks.push({ token, source: value, kind: 'inline' });
      return token;
    }
  );

  protectedText = protectedText.replace(RELATION_SOURCE_PATTERN, (value: string) => {
    const token = 'FORMULA_TOKEN_' + locks.length;
    locks.push({ token, source: value, kind: 'symbol' });
    return token;
  });
  protectedText = protectedText.replace(MATH_SYMBOL_PATTERN, (value: string) => {
    const token = 'FORMULA_TOKEN_' + locks.length;
    locks.push({ token, source: value, kind: 'symbol' });
    return token;
  });

  const lockByToken = new Map(locks.map((lock) => [lock.token, lock]));
  const orderedLocks = Array.from(protectedText.matchAll(TOKEN_PATTERN), ([token]) => lockByToken.get(token))
    .filter((lock): lock is FormulaLock => Boolean(lock));

  const sourceWithoutTokens = stripTokens(protectedText);
  const sourceRelations = relationSignature(sourceWithoutTokens);
  const sourceScripts = scriptSignature(sourceWithoutTokens);
  const sourceNumbers = numberSignature(sourceWithoutTokens);
  const enabled = orderedLocks.length > 0 || Boolean(sourceRelations) || Boolean(sourceScripts);
  const tokenList = orderedLocks.map((lock) => lock.token).join(', ');
  const instruction = enabled
    ? [
      'Formula fidelity lock: formula tokens are opaque source data, not prose.',
      'Copy each listed token exactly once, in the same order: ' + (tokenList || 'none') + '.',
      'Never translate, reorder, omit, split, or mathematically correct a formula token.',
      'In particular, an equals sign must remain an equals sign; never replace = with ∈ or \\in.',
      'Keep all numeric values in the same order and unchanged.',
      'Return only the translated prose and the unchanged formula tokens.',
    ].join(' ')
    : '';

  return {
    enabled,
    sourceForModel: protectedText,
    instruction,
    validate(output: string): TranslationGuardResult {
      const normalizedOutput = normalizeTokenWrappers(String(output || ''));
      if (!enabled) {
        return { ok: true, text: normalizedOutput, errors: [] };
      }
      const errors: string[] = [];

      for (const lock of orderedLocks) {
        const count = countOccurrences(normalizedOutput, lock.token);
        if (count !== 1) {
          errors.push(lock.token + ' 出现 ' + count + ' 次，期望恰好 1 次');
        }
      }

      const outputWithoutTokens = stripTokens(normalizedOutput);
      const outputRelations = relationSignature(outputWithoutTokens);
      if (sourceRelations !== outputRelations) {
        errors.push('关系符号不一致：原文 ' + (sourceRelations || '无') + '，译文 ' + (outputRelations || '无'));
      }

      const outputScripts = scriptSignature(outputWithoutTokens);
      if (sourceScripts !== outputScripts) {
        errors.push('上下标变量不一致：原文 ' + (sourceScripts || '无') + '，译文 ' + (outputScripts || '无'));
      }

      const outputNumbers = numberSignature(outputWithoutTokens);
      if (sourceNumbers !== outputNumbers) {
        errors.push('数值顺序或内容不一致：原文 ' + (sourceNumbers || '无') + '，译文 ' + (outputNumbers || '无'));
      }

      const expectedOrder = orderedLocks.map((lock) => lock.token).join('|');
      const actualOrder = Array.from(normalizedOutput.matchAll(TOKEN_PATTERN), ([token]) => token).join('|');
      if (expectedOrder !== actualOrder) {
        errors.push('公式 token 顺序不一致');
      }

      if (errors.length > 0) return { ok: false, errors };

      let restored = normalizedOutput;
      for (const lock of orderedLocks) {
        restored = restored.split(lock.token).join(restoreLock(lock));
      }
      return { ok: true, text: restored, errors: [] };
    },
  };
}

export function validateTranslationFidelity(source: string, output: string): TranslationGuardResult {
  return createTranslationFidelityGuard(source).validate(output);
}
