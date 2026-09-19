import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPdfText, normalizeLigatures, repairHyphenation, normalizeWhitespace } from '../src/cleaner';

test('cleaner: 连字还原 normalizeLigatures', () => {
  const input = 'eﬃcient ﬁeld ﬂow';
  const expected = 'efficient field flow';
  assert.equal(normalizeLigatures(input), expected);
});

test('cleaner: 修复跨行断词 repairHyphenation', () => {
  const input = 'This is an excep-\n tional multi-\r\n layer neural network.';
  const expected = 'This is an exceptional multi-layer neural network.';
  assert.equal(repairHyphenation(input), expected);
});

test('cleaner: 保留技术复合词的语义连字符', () => {
  const input = 'accurate self-\n positioning for cross-\n view localization';
  const expected = 'accurate self-positioning for cross-view localization';
  assert.equal(repairHyphenation(input), expected);
});

test('cleaner: 不跨越段落边界拼接连字符', () => {
  const input = 'self-\n\npositioning';
  assert.equal(repairHyphenation(input), input);
});

test('cleaner: 保留公式中的减号与列表符', () => {
  const input = 'where x - \n y denotes difference';
  assert.match(repairHyphenation(input), /x\s*-\s*y/);
});

test('cleaner: 换行与段落规范化 normalizeWhitespace', () => {
  const input = 'Line 1\nLine 2\n\nParagraph 2 line 1\nParagraph 2 line 2';
  const expected = 'Line 1 Line 2\n\nParagraph 2 line 1 Paragraph 2 line 2';
  assert.equal(normalizeWhitespace(input), expected);
});

test('cleaner: 综合论文段落清洗 cleanPdfText', () => {
  const rawPdfSnippet = `In this paper, we propose an eﬃcient frame-\nwork for deep learn-\ning with loss L_reg = \\sum |w_i|. \n\nExperimental results conﬁrm\nits superiority.`;
  const cleaned = cleanPdfText(rawPdfSnippet);

  assert.ok(cleaned.includes('efficient framework'));
  assert.ok(cleaned.includes('deep learning'));
  assert.ok(cleaned.includes('confirm'));
  assert.ok(cleaned.includes('\n\n')); // 保留段落
});
