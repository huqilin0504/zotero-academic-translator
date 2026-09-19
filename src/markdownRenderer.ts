import {
  findNextMath,
  normalizeBareMathNotation,
  normalizeModelMathEscaping,
  renderMathToHtml,
} from './mathRenderer';

const TOKEN_START = '\uE000';
const TOKEN_END = '\uE001';

interface TokenStore {
  put: (html: string) => string;
  restore: (html: string) => string;
}

function createTokenStore(): TokenStore {
  const values: string[] = [];
  const marker = `${TOKEN_START}gemini-${Math.random().toString(36).slice(2)}${TOKEN_END}`;
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escapedMarker}(\\d+)${escapedMarker}`, 'g');
  return {
    put(html: string): string {
      const index = values.push(html) - 1;
      return `${marker}${index}${marker}`;
    },
    restore(html: string): string {
      return html.replace(pattern, (_match, index: string) => values[Number(index)] || '');
    },
  };
}

export function renderMarkdownToHtml(text: string, enableKaTeX = true): string {
  if (!text) return '';

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/);
    if (fence) {
      const marker = fence[1][0];
      const markerLength = fence[1].length;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !isClosingFence(lines[index], marker, markerLength)) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;

      const language = fence[2].match(/^[A-Za-z0-9_+-]+$/)?.[0] || '';
      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : '';
      blocks.push(
        `<pre class="gemini-markdown-code"><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`
      );
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2], enableKaTeX)}</h${level}>`);
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push('<hr>');
      index += 1;
      continue;
    }

    if (
      index + 1 < lines.length &&
      line.includes('|') &&
      lines[index + 1].includes('|') &&
      isTableSeparator(lines[index + 1])
    ) {
      const headerCells = splitTableRow(line);
      const separatorCells = splitTableRow(lines[index + 1]);
      if (headerCells.length > 0 && headerCells.length === separatorCells.length) {
        const rows: string[][] = [];
        index += 2;
        while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
          const cells = splitTableRow(lines[index]);
          if (cells.length !== headerCells.length) break;
          rows.push(cells);
          index += 1;
        }
        blocks.push(renderTable(headerCells, separatorCells, rows, enableKaTeX));
        continue;
      }
    }

    const quote = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quote) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s{0,3}>\s?(.*)$/);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      blocks.push(`<blockquote>${renderMarkdownToHtml(quoteLines.join('\n'), enableKaTeX)}</blockquote>`);
      continue;
    }

    const list = matchListItem(line);
    if (list) {
      const ordered = list.ordered;
      const items: string[] = [];
      const firstNumber = list.number;
      let nextNumber = firstNumber || 1;
      while (index < lines.length) {
        const item = matchListItem(lines[index]);
        if (item && item.ordered === ordered) {
          if (ordered && items.length > 0) {
            const itemNumber = item.number || nextNumber;
            if (itemNumber !== nextNumber && itemNumber !== 1) break;
          }
          items.push(item.content);
          if (ordered) nextNumber = (item.number || nextNumber) + 1;
          index += 1;
          continue;
        }
        if (items.length > 0 && /^\s{2,}\S/.test(lines[index])) {
          items[items.length - 1] += `\n${lines[index].trim()}`;
          index += 1;
          continue;
        }
        if (items.length > 0 && !lines[index].trim()) {
          let lookahead = index;
          while (lookahead < lines.length && !lines[lookahead].trim()) lookahead += 1;
          const nextItem = lookahead < lines.length ? matchListItem(lines[lookahead]) : null;
          const isContinuation = Boolean(
            nextItem &&
            nextItem.ordered === ordered &&
            (!ordered || nextItem.number === nextNumber || nextItem.number === 1)
          );
          if (isContinuation) {
            index = lookahead;
            continue;
          }
        }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const startAttr = ordered && firstNumber && firstNumber !== 1 ? ` start="${firstNumber}"` : '';
      blocks.push(`<${tag}${startAttr}>${items.map((item) => `<li>${renderInline(item, enableKaTeX)}</li>`).join('')}</${tag}>`);
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      const current = lines[index];
      if (
        paragraphLines.length > 0 &&
        (isBlockStart(current) || (index + 1 < lines.length && isTableSeparator(lines[index + 1])))
      ) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraphLines.join('\n'), enableKaTeX)}</p>`);
  }

  return blocks.join('');
}

export function renderMarkdownInContainer(
  container: HTMLElement,
  text: string,
  enableKaTeX = true
): void {
  container.classList.add('gemini-markdown');
  container.innerHTML = renderMarkdownToHtml(text, enableKaTeX);
}

function renderInline(source: string, enableKaTeX: boolean): string {
  const tokens = createTokenStore();
  let text = source;

  text = text.replace(/(`{1,3})([\s\S]*?)\1/g, (_match, _ticks: string, content: string) => {
    return tokens.put(`<code class="gemini-markdown-inline-code">${escapeHtml(content.replace(/\s*\n\s*/g, ' '))}</code>`);
  });

  if (enableKaTeX) {
    text = extractMath(text, tokens);
  }

  text = text.replace(/\\([\\`*_{}\[\]()#+.!>|~-])/g, (_match, character: string) => {
    return tokens.put(escapeHtml(character));
  });

  text = text.replace(
    /\[([^\]\n]+)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g,
    (_match, label: string, href: string, title: string | undefined) => {
      const safeHref = sanitizeHref(href);
      const labelHtml = renderInline(label, enableKaTeX);
      if (!safeHref) return tokens.put(labelHtml);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return tokens.put(
        `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${labelHtml}</a>`
      );
    }
  );

  text = text.replace(/<((?:https?:\/\/)[^<>\s]+)>/g, (_match, href: string) => {
    const safeHref = sanitizeHref(href);
    if (!safeHref) return '';
    const label = escapeHtml(href);
    return tokens.put(`<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  });

  let html = escapeHtml(text);
  html = html.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  html = html.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+?\S)\*([^*]|$)/g, '$1<em>$2</em>$3');
  html = html.replace(/(^|[^\w])_([^_\n]+?\S)_([^\w]|$)/g, '$1<em>$2</em>$3');
  html = html.replace(/ {2,}\n/g, '<br>');
  html = html.replace(/\n/g, '<br>');
  return tokens.restore(html);
}

function extractMath(source: string, tokens: TokenStore): string {
  const normalizedSource = normalizeBareMathNotation(normalizeModelMathEscaping(source));
  let result = '';
  let cursor = 0;
  while (cursor < normalizedSource.length) {
    const match = findNextMath(normalizedSource, cursor);
    if (!match) {
      result += normalizedSource.slice(cursor);
      break;
    }
    result += normalizedSource.slice(cursor, match.start);
    result += tokens.put(renderMathToHtml(normalizedSource.slice(match.start, match.end)));
    cursor = match.end;
  }
  return result;
}

function matchListItem(line: string): { ordered: boolean; content: string; number?: number } | null {
  const ordered = line.match(/^\s{0,3}(\d+)[.)]\s+(.+)$/);
  if (ordered) return { ordered: true, content: ordered[2], number: Number(ordered[1]) || 1 };
  const unordered = line.match(/^\s{0,3}[-+*]\s+(.+)$/);
  if (unordered) return { ordered: false, content: unordered[1] };
  return null;
}

function isBlockStart(line: string): boolean {
  return Boolean(
    line.match(/^\s{0,3}(#{1,6})\s+/) ||
    line.match(/^\s{0,3}>\s?/) ||
    matchListItem(line) ||
    line.match(/^\s{0,3}(`{3,}|~{3,})\s*/) ||
    isHorizontalRule(line)
  );
}

function isClosingFence(line: string, marker: string, markerLength: number): boolean {
  const escapedMarker = marker === '`' ? '`' : '~';
  return new RegExp(`^\\s{0,3}${escapedMarker}{${markerLength},}\\s*$`).test(line);
}

function isHorizontalRule(line: string): boolean {
  return /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line);
}

function splitTableRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith('|')) source = source.slice(1);
  if (source.endsWith('|') && !source.endsWith('\\|')) source = source.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (const character of source) {
    if (character === '|' && !escaped) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    if (character === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    current += character;
    escaped = false;
  }
  cells.push(current.trim());
  return cells;
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderTable(
  headers: string[],
  separators: string[],
  rows: string[][],
  enableKaTeX: boolean
): string {
  const alignments = separators.map((separator) => {
    const left = separator.startsWith(':');
    const right = separator.endsWith(':');
    return left && right ? 'center' : left ? 'left' : right ? 'right' : '';
  });
  const alignAttr = (index: number): string => alignments[index] ? ` style="text-align:${alignments[index]}"` : '';
  const headerHtml = headers
    .map((cell, index) => `<th${alignAttr(index)}>${renderInline(cell, enableKaTeX)}</th>`)
    .join('');
  const rowHtml = rows
    .map((row) => `<tr>${row.map((cell, index) => `<td${alignAttr(index)}>${renderInline(cell, enableKaTeX)}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="gemini-markdown-table"><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table>`;
}

function sanitizeHref(href: string): string | null {
  const value = href.trim();
  if (/^(?:https?:|mailto:)/i.test(value)) return value;
  if (value.startsWith('#')) return value;
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
