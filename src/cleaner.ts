/**
 * PDF 文本清洗与学术符号规范化模块
 */

/**
 * 还原 PDF 常见的排版连字 (Ligatures)
 */
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

/**
 * 学术 PDF 中常见的语义连字符。PDF 文本层无法区分“行尾断词连字符”和
 * 原文自身的连字符，因此对这些高频技术复合词保留连字符，避免
 * "self-\n positioning" 变成错误的 "selfpositioning"。
 */
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

/**
 * 修复 PDF 跨行断词与行尾连字符。
 *
 * 普通断词例如 "connec-\n tion" 会合并为 "connection"；技术复合词例如
 * "self-\n positioning" 保留为 "self-positioning"。减号、列表符号和不跨
 * 行的普通连字符不会进入这个规则。
 */
export function repairHyphenation(text: string): string {
  return text.replace(/([a-zA-Z]{2,})-[ \t]*\r?\n[ \t]*([a-zA-Z]{2,})/g, (_match, left: string, right: string) => {
    const keepHyphen = SEMANTIC_HYPHEN_PREFIXES.has(left.toLowerCase());
    return `${left}${keepHyphen ? '-' : ''}${right}`;
  });
}

/**
 * 规范化换行符与多余空格
 * 单个软换行替换为空格，双换行（段落分隔）保留
 */
export function normalizeWhitespace(text: string): string {
  return text
    // 保护连续双换行（分段）
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '__PARAGRAPH_BREAK__')
    // 将单个换行替换为空格
    .replace(/\n/g, ' ')
    // 还原段落
    .replace(/__PARAGRAPH_BREAK__/g, '\n\n')
    // 压缩水平多余空格
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * 综合学术 PDF 划选文本清洗函数
 */
export function cleanPdfText(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';

  let cleaned = rawText;
  cleaned = normalizeLigatures(cleaned);
  cleaned = repairHyphenation(cleaned);
  cleaned = normalizeWhitespace(cleaned);

  return cleaned;
}
