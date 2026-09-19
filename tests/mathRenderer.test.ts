import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBareMathNotation, renderMathToHtml } from '../src/mathRenderer';

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

test('mathRenderer: 兼容 API 返回的重复转义 LaTeX 分隔符和命令', () => {
  const html = renderMathToHtml('API 结果：\\\\(\\\\frac{a}{b}\\\\)，以及 \\\\[\\\\hat{y}=Wx\\\\]');

  assert.equal((html.match(/katex/g) || []).length > 1, true);
  assert.equal(html.includes('\\\\('), false, '重复转义的行内分隔符不应原样显示');
  assert.equal(html.includes('\\\\['), false, '重复转义的块级分隔符不应原样显示');
  assert.equal(html.includes('katex-error'), false);
});

test('mathRenderer: 支持 aligned 和 matrix 数学环境', () => {
  const html = renderMathToHtml(
    '\\begin{aligned}f(x)&=x^2+1\\\\g(x)&=2x\\end{aligned}\\n\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}'
  );

  assert.equal((html.match(/katex-display/g) || []).length, 2);
  assert.equal(html.includes('katex-mathml'), false);
});

test('mathRenderer: 常见环境、关系符号和维度表达式全部可渲染', () => {
  const input = [
    '\\begin{equation}E=mc^2\\tag{1}\\end{equation}',
    '\\begin{gathered}a=b\\\\c=d\\end{gathered}',
    '\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}',
    '\\begin{array}{cc}x&y\\\\z&w\\end{array}',
    '关系：A ∉ R2×D，B ⊆ R{N+1}×D。',
  ].join('\n');
  const html = renderMathToHtml(input);

  assert.equal(html.includes('katex-error'), false);
  assert.equal((html.match(/katex-display/g) || []).length >= 4, true);
  assert.equal(html.includes('R2×D'), false);
  assert.equal(html.includes('R{N+1}×D'), false);
});

test('mathRenderer: 不会把矩阵行距语法 \\[4pt] 当成块级分隔符', () => {
  const html = renderMathToHtml(String.raw`\begin{matrix}a&b\\[4pt]c&d\end{matrix}`);

  assert.equal((html.match(/katex-display/g) || []).length, 1);
  assert.equal(html.includes('katex-error'), false);
});

test('mathRenderer: 公式内空格可保留，未配对货币符号不会误渲染', () => {
  const html = renderMathToHtml('公式是 $ E = mc^2 $，价格是 $100 USD。');

  assert.match(html, /katex/);
  assert.match(html, /\$100 USD/);
});

test('mathRenderer: 多公式、嵌套命令和安全扩展组合可渲染', () => {
  const html = renderMathToHtml(
    [
      '多个 $a$、\\(b\\) 和 $$c+d$$。',
      '嵌套 $\\left(\\frac{a}{b}\\right)$，以及 $\\alpha_1+\\beta^2$。',
      '文本公式 $\\text{loss}=0.5$。',
      '不可信扩展 $\\href{javascript:alert(1)}{x}$ 不得注入链接。',
    ].join('\\n')
  );

  assert.equal(html.includes('katex-error'), false);
  assert.equal(html.includes('javascript:'), false);
  assert.equal(html.includes('<script'), false);
  assert.equal((html.match(/katex/g) || []).length >= 8, true);
});

test('mathRenderer: 各种集合关系的裸维度表达式都能恢复', () => {
  const operators: Array<[string, string]> = [
    ['∈', '\\in'],
    ['∉', '\\notin'],
    ['⊂', '\\subset'],
    ['⊆', '\\subseteq'],
    ['=', '='],
    ['≈', '\\approx'],
    ['≤', '\\le'],
    ['≥', '\\ge'],
  ];

  for (const [operator, latexOperator] of operators) {
    const normalized = normalizeBareMathNotation(`A ${operator} R2×D。`);
    assert.equal(
      normalized.includes(`$A ${latexOperator} \\mathbb{R}^{2\\times D}$`),
      true,
      `关系符号 ${operator} 应规范化为 KaTeX`
    );
    const html = renderMathToHtml(`A ${operator} R2×D。`);
    assert.equal(html.includes('katex-error'), false, `关系符号 ${operator} 不应报错`);
    assert.match(html, /katex/);
    assert.equal(html.includes('R2×D'), false, `关系符号 ${operator} 的裸维度不应残留`);
  }
});

test('mathRenderer: 未闭合、错配和货币文本安全回退', () => {
  const inputs = [
    '价格是 $5 USD，不是公式。',
    '未闭合 $\\frac{1}{2}',
    '未闭合 \\[x^2',
    '错配 \\begin{aligned}x&=1\\end{matrix}',
  ];

  for (const input of inputs) {
    const html = renderMathToHtml(input);
    assert.equal(html.includes('katex-error'), false, `回退文本不应制造渲染错误：${input}`);
    assert.equal(html.includes('<script'), false);
  }
});

test('mathRenderer: 划词翻译返回无分隔符的张量公式时恢复上下标', () => {
  const input = '所有输出 L ∈ RB×N×S（其中 B 代表批大小，N 代表 patch 大小）。';
  const normalized = normalizeBareMathNotation(input);
  assert.match(normalized, /\$L \\in \\mathbb\{R\}\^\{B\\times N\\times S\}\$/);
  const html = renderMathToHtml(input);
  assert.match(html, /katex/);
  assert.equal(html.includes('RB×N×S'), false, '裸维度表达式不应继续作为普通正文输出');
});

test('mathRenderer: PDF 文本层摊平上下标时恢复截图中的 P、M 和范围公式', () => {
  const input = '其中，P c 表示第 c 个图像块的热值。M i 表示第 c 个图像块对应特征向量的第 i 个值。然后，我们将 P 1−N 的值按降序排列。';
  const normalized = normalizeBareMathNotation(input);

  assert.match(normalized, /\$P\^\{c\}\$/);
  assert.match(normalized, /\$M\^\{i\}\$/);
  assert.match(normalized, /\$P\^\{1-N\}\$/);

  const html = renderMathToHtml(input);
  assert.equal((html.match(/katex/g) || []).length >= 3, true);
  assert.equal(html.includes('katex-error'), false);
  assert.equal(html.includes('P 1−N'), false);
});

test('mathRenderer: 截图中的中文译文裸变量和连续上下标全部恢复', () => {
  const input =
    '其中n代表区域数量（图5中n设为3）。 f_i^j 表示第j个实例区域第i个补丁的特征向量。简而言之，V_i 是通过取出每个区域中的所有补丁并进行平均池化操作得到的。';
  const normalized = normalizeBareMathNotation(input);

  assert.equal(normalized.includes('$n$'), true);
  assert.equal(normalized.includes('$f_{i}^{j}$'), true);
  assert.equal(normalized.includes('$j$'), true);
  assert.equal(normalized.includes('$i$'), true);
  assert.equal(normalized.includes('$V_{i}$'), true);

  const html = renderMathToHtml(input);
  assert.equal(html.includes('katex-error'), false);
  assert.equal(html.includes('f_i^j'), false);
  assert.equal(html.includes('V_i'), false);
  assert.equal((html.match(/katex/g) || []).length >= 6, true);
});

test('mathRenderer: 常见数学表达式组合回归', () => {
  const input = [
    '行内 $x_i$ 与 \\(y^2\\)。',
    '摊平公式 P c 表示热值，M i 代表索引，P 1−N 的值按降序排列。',
    '张量 L ∈ RB×N×S，矩阵 A ∈ R2×2。',
    '\\[\\begin{aligned}f(x)&=x^2\\\\g(x)&=\\frac{1}{2}x\\end{aligned}\\]',
    '分段 \\[f(x)=\\begin{cases}0,&x<0\\\\x^2,&x\\ge 0\\end{cases}\\]',
    '矩阵 \\[X=\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}\\]',
  ].join('\\n');
  const html = renderMathToHtml(input);

  assert.equal(html.includes('katex-error'), false);
  assert.equal((html.match(/katex/g) || []).length >= 8, true);
  assert.equal(html.includes('P c'), false);
  assert.equal(html.includes('M i'), false);
  assert.equal(html.includes('P 1−N'), false);
});

test('mathRenderer: 保留带上下标但缺少分隔符的 API 公式', () => {
  const normalized = normalizeBareMathNotation('P^c 表示热值，M_{i+1} 代表下一个索引，x_i 的值如下。');

  assert.match(normalized, /\$P\^\{c\}\$/);
  assert.match(normalized, /\$M_\{i\+1\}\$/);
  assert.match(normalized, /\$x_\{i\}\$/);

  const html = renderMathToHtml(normalized);
  assert.equal((html.match(/katex/g) || []).length >= 3, true);
  assert.equal(html.includes('katex-error'), false);
});

test('mathRenderer: 无公式上下文的相似文本不应被强行改写', () => {
  const input = '普通文本中的 P c、M i、P 1−N 只是变量名说明。';
  const html = renderMathToHtml(input);

  assert.equal(html.includes('katex'), false);
  assert.match(html, /P c/);
  assert.match(html, /M i/);
  assert.match(html, /P 1−N/);
});

test('mathRenderer: 已有分隔符的公式不被裸公式规则重复包裹', () => {
  const input = '输出为 $L \\in \\mathbb{R}^{B\\times N\\times S}$。';
  const normalized = normalizeBareMathNotation(input);
  assert.equal((normalized.match(/\$/g) || []).length, 2);
  assert.equal(normalized.includes('$$L'), false);
});

test('mathRenderer: 转义分隔符和未闭合公式保持为普通文本', () => {
  const html = renderMathToHtml('字面量 \\$x\\$，未闭合 $\\frac{1}{2}');

  assert.equal(html.includes('katex'), false);
  assert.match(html, /\\\$x\\\$/);
  assert.match(html, /\$\\frac\{1\}\{2\}/);
});
