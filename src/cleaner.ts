
export function normalizeLigatures(text: string): string {
  return text
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\uFB05/g, 'ft')
    .replace(/\uFB06/g, 'st');
}

const SEMANTIC_HYPHEN_PREFIXES = new Set([
  'self',
  'cross',
  'multi',
  'non',
  'semi',
  'pre',
  'post',
  'geo',
  'vision',
  'image',
  'feature',
  'domain',
  'fine',
  'co',
  'real',
  'state',
  'model',
  'data',
  'view',
  'uav',
  'gps',
]);

export function repairHyphenation(text: string): string {
  return text.replace(/([a-zA-Z]{2,})-[ \t]*\r?\n[ \t]*([a-zA-Z]{2,})/g, (_match, left: string, right: string) => {
    const keepHyphen = SEMANTIC_HYPHEN_PREFIXES.has(left.toLowerCase());
    return `${left}${keepHyphen ? '-' : ''}${right}`;
  });
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '__PARAGRAPH_BREAK__')
    .replace(/\n/g, ' ')
    .replace(/__PARAGRAPH_BREAK__/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function cleanPdfText(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';

  let cleaned = rawText;
  cleaned = normalizeLigatures(cleaned);
  cleaned = repairHyphenation(cleaned);
  cleaned = normalizeWhitespace(cleaned);

  return cleaned;
}
