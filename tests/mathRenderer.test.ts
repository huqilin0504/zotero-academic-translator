import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMathToHtml } from '../src/mathRenderer';

test('mathRenderer: 渲染行内公式 $E=mc^2$', () => {
  const input = '根据公式 $E = mc^2$，质量与能量等价。';
  const html = renderMathToHtml(input);

  assert.ok(html.includes('katex'), '应包含 KaTeX 生成的 HTML 标签');
  assert.ok(html.includes('质量与能量等价'), '应保留周围的中文文本');
});

test('mathRenderer: 渲染行间块级公式 $$...$$', () => {
  const input = '损失函数定义为：\n$$\\mathcal{L} = \\frac{1}{N} \\sum_{i=1}^N (y_i - \\hat{y}_i)^2$$';
  const html = renderMathToHtml(input);

  assert.ok(html.includes('katex-display'), '块级公式应包含 katex-display 类');
  assert.ok(html.includes('损失函数定义为'));
});

test('mathRenderer: 容错处理（不合法的 LaTeX 公式不抛错崩溃）', () => {
  const malformedInput = '未闭合或错误的公式 $\\frac{1}{$} 这里测试。';
  let html = '';
  assert.doesNotThrow(() => {
    html = renderMathToHtml(malformedInput);
  });
  assert.ok(typeof html === 'string');
});

test('mathRenderer: 纯文本输入无需渲染 KaTeX', () => {
  const plain = '这是一段没有任何数学公式的纯学术文本。';
  const html = renderMathToHtml(plain);
  assert.equal(html, plain);
});

test('mathRenderer: 公式周围的模型文本必须转义', () => {
  const html = renderMathToHtml('<img src=x onerror=alert(1)> $x$');
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('&lt;img'), true);
  assert.equal(html.includes('katex'), true);
});

test('mathRenderer: 确保仅输出 html 结构，绝不输出 katex-mathml 重复标签', () => {
  const input = '模型参数 $\\theta$ 上的概率分布，模型 $f_\\theta$ 与输出 $y^*$。';
  const html = renderMathToHtml(input);

  assert.ok(html.includes('katex-html'), '应包含可视化 HTML 结构');
  assert.equal(html.includes('katex-mathml'), false, '绝不应包含 katex-mathml 避免在 Firefox 下双重渲染');
});

test('mathRenderer: 支持 LaTeX 原生行内和块级分隔符', () => {
  const html = renderMathToHtml('行内 \\(a^2+b^2=c^2\\)，块级如下：\\[\\int_0^1 x^2 dx = \\frac{1}{3}\\]');

  assert.match(html, /katex/);
  assert.match(html, /katex-display/);
  assert.equal(html.includes('\\\\('), false, '已识别的行内分隔符不应原样显示');
  assert.equal(html.includes('\\\\['), false, '已识别的块级分隔符不应原样显示');
});

test('mathRenderer: 支持 aligned 和 matrix 数学环境', () => {
  const html = renderMathToHtml(
    '\\begin{aligned}f(x)&=x^2+1\\\\g(x)&=2x\\end{aligned}\\n\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}'
  );

  assert.equal((html.match(/katex-display/g) || []).length, 2);
  assert.equal(html.includes('katex-mathml'), false);
});

test('mathRenderer: 公式内空格可保留，未配对货币符号不会误渲染', () => {
  const html = renderMathToHtml('公式是 $ E = mc^2 $，价格是 $100 USD。');

  assert.match(html, /katex/);
  assert.match(html, /\$100 USD/);
});

test('mathRenderer: 转义分隔符和未闭合公式保持为普通文本', () => {
  const html = renderMathToHtml('字面量 \\$x\\$，未闭合 $\\frac{1}{2}');

  assert.equal(html.includes('katex'), false);
  assert.match(html, /\\\$x\\\$/);
  assert.match(html, /\$\\frac\{1\}\{2\}/);
});
