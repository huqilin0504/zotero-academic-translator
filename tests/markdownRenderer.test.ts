import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownToHtml } from '../src/markdownRenderer';

test('markdownRenderer: 标题、粗体、列表和行内代码保留结构', () => {
  const html = renderMarkdownToHtml('# 结论\n\n这是 **重点**，调用 `streamAsk()`。\n\n1. 第一项\n2. 第二项');

  assert.match(html, /<h1>结论<\/h1>/);
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<code class="gemini-markdown-inline-code">streamAsk\(\)<\/code>/);
  assert.match(html, /<ol><li>第一项<\/li><li>第二项<\/li><\/ol>/);
});

test('markdownRenderer: 空行分隔的连续有序列表不会重复从 1 开始', () => {
  const html = renderMarkdownToHtml('1. 第一项\n\n1. 第二项\n\n1. 第三项');

  assert.equal((html.match(/<ol/g) || []).length, 1);
  assert.match(html, /<ol><li>第一项<\/li><li>第二项<\/li><li>第三项<\/li><\/ol>/);
});

test('markdownRenderer: 明确的有序列表起始编号会保留', () => {
  const html = renderMarkdownToHtml('3. 第三项\n4. 第四项');

  assert.match(html, /<ol start="3"><li>第三项<\/li><li>第四项<\/li><\/ol>/);
});

test('markdownRenderer: 代码块、表格和公式可以同时渲染', () => {
  const html = renderMarkdownToHtml(
    '```python\nprint("ok")\n```\n\n| 项目 | 结果 |\n| --- | :---: |\n| $x$ | **通过** |'
  );

  assert.match(html, /<pre class="gemini-markdown-code"><code class="language-python">/);
  assert.match(html, /print\(&quot;ok&quot;\)/);
  assert.match(html, /<table class="gemini-markdown-table">/);
  assert.match(html, /katex/);
  assert.match(html, /<strong>通过<\/strong>/);
});

test('markdownRenderer: 模型 HTML 被转义，危险链接不会生成可点击地址', () => {
  const html = renderMarkdownToHtml(
    '<script>alert(1)</script> [危险](javascript:alert(1)) [安全](https://example.com)'
  );

  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(html.includes('javascript:'), false);
  assert.match(html, /href="https:\/\/example\.com"/);
});

test('markdownRenderer: 关闭 KaTeX 时公式保持文本且 Markdown 仍生效', () => {
  const html = renderMarkdownToHtml('**公式** $x$', false);

  assert.match(html, /<strong>公式<\/strong>/);
  assert.equal(html.includes('katex'), false);
  assert.match(html, /\$x\$/);
});

test('markdownRenderer: 划词翻译常见 LaTeX 分隔符与 Markdown 混排', () => {
  const html = renderMarkdownToHtml(
    '结论是 \\(p \\leq 0.05\\)。\n\n\\[\\hat{y}=\\sigma(Wx+b)\\]\n\n```text\n$not-a-formula$\n```'
  );

  assert.match(html, /katex/);
  assert.match(html, /katex-display/);
  assert.match(html, /\$not-a-formula\$/);
  assert.equal(html.includes('<code class="gemini-markdown-inline-code">'), false);
});

test('markdownRenderer: API 重复转义的 LaTeX 也能在翻译卡片中渲染', () => {
  const html = renderMarkdownToHtml(String.raw`API 结果：\\(\\frac{a}{b}\\)，以及 \\[\\hat{y}=Wx\\]`);

  assert.equal((html.match(/katex/g) || []).length > 1, true);
  assert.equal(html.includes('\\\\('), false);
  assert.equal(html.includes('\\\\['), false);
  assert.equal(html.includes('katex-error'), false);
});

test('markdownRenderer: 划词翻译返回裸张量公式时仍按公式显示', () => {
  const html = renderMarkdownToHtml('所有输出 L ∈ RB×N×S（其中 B 代表批大小）。');

  assert.match(html, /katex/);
  assert.equal(html.includes('RB×N×S'), false);
  assert.equal(html.includes('katex-error'), false);
});

test('markdownRenderer: 划词翻译截图中的摊平上下标在段落中正确显示', () => {
  const html = renderMarkdownToHtml(
    '其中，P c 表示第 c 个图像块的热值。M i 表示第 c 个图像块对应特征向量的第 i 个值。然后，我们将 P 1−N 的值按降序排列。'
  );

  assert.equal((html.match(/katex/g) || []).length >= 3, true);
  assert.equal(html.includes('katex-error'), false);
  assert.equal(html.includes('P 1−N'), false);
});

test('markdownRenderer: 划词翻译截图中的裸变量和连续上下标正确显示', () => {
  const html = renderMarkdownToHtml(
    '其中n代表区域数量（图5中n设为3）。 f_i^j 表示第j个实例区域第i个补丁的特征向量。简而言之，V_i 是通过取出每个区域中的所有补丁并进行平均池化操作得到的。'
  );

  assert.equal(html.includes('katex-error'), false);
  assert.equal(html.includes('f_i^j'), false);
  assert.equal(html.includes('V_i'), false);
  assert.equal((html.match(/katex/g) || []).length >= 6, true);
});

test('markdownRenderer: 划词翻译返回裸 ^/_ 公式时不依赖美元分隔符', () => {
  const html = renderMarkdownToHtml('P^c 表示热值，M_{i+1} 代表下一个索引，x_i 的值如下。');

  assert.equal((html.match(/katex/g) || []).length >= 3, true);
  assert.equal(html.includes('katex-error'), false);
  assert.equal(html.includes('P^c'), false);
  assert.equal(html.includes('M_{i+1}'), false);
});

test('markdownRenderer: 列表、引用和链接中的公式渲染，代码块中的公式保持文本', () => {
  const html = renderMarkdownToHtml(
    '> 结论是 $x_i$。\n\n- P c 表示热值。\n\n[查看 $y^2$](https://example.com)\n\n```tex\nP c 表示代码文本\n```'
  );

  assert.match(html, /<blockquote>/);
  assert.match(html, /<ul><li>/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.equal((html.match(/katex/g) || []).length >= 2, true);
  assert.equal(html.includes('<pre class="gemini-markdown-code"><code class="language-tex">P c 表示代码文本</code></pre>'), true);
  assert.equal(html.includes('katex-error'), false);
});
