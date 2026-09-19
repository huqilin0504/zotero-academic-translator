import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationFidelityGuard, validateTranslationFidelity } from '../src/translationGuard';

test('translationGuard: 原始公式整行会被锁定并在译文中恢复', () => {
  const source = String.raw`V_i = \frac{1}{N_i} \sum_{j=1}^{N_i} f_i^j, i = \{1,2,\ldots,n\} where n stands for number of regions.`;
  const guard = createTranslationFidelityGuard(source);

  assert.equal(guard.enabled, true);
  assert.match(guard.sourceForModel, /^FORMULA_TOKEN_0$/);

  const checked = guard.validate('公式定义如下：FORMULA_TOKEN_0');
  assert.equal(checked.ok, true);
  assert.match(checked.text || '', /\$\$V_i = \\frac\{1\}\{N_i\}/);
  assert.match(checked.text || '', /i = \\{1,2,\\ldots,n\\\}/);
});

test('translationGuard: 不允许把等号改成集合关系符号', () => {
  const source = '在定义中，x = y，且该关系用于后续计算。';
  const guard = createTranslationFidelityGuard(source);
  const token = guard.sourceForModel.match(/FORMULA_TOKEN_[0-9]+/)?.[0];

  assert.ok(token, '关系符号应该被锁定');
  assert.equal(guard.validate(`在定义中，x ∈ y，且该关系用于后续计算。`).ok, false);
  assert.equal(guard.validate(`在定义中，x ${token} y，且该关系用于后续计算。`).ok, true);
});

test('translationGuard: 显式 LaTeX 公式只允许原样 token，支持模型加外层分隔符', () => {
  const source = String.raw`参数为 $x_i = y^2$。`;
  const guard = createTranslationFidelityGuard(source);
  const token = guard.sourceForModel.match(/FORMULA_TOKEN_[0-9]+/)?.[0];

  assert.ok(token);
  const checked = guard.validate(`参数为 $${token}$。`);
  assert.equal(checked.ok, true);
  assert.equal(checked.text, source);
});

test('translationGuard: 显式块级公式和数学环境不会重复套分隔符', () => {
  for (const source of [
    String.raw`$$E = mc^2$$`,
    String.raw`\[E = mc^2\]`,
    String.raw`\begin{aligned}x&=y\end{aligned}`,
  ]) {
    const guard = createTranslationFidelityGuard(source);
    const token = guard.sourceForModel.match(/FORMULA_TOKEN_[0-9]+/)?.[0];
    assert.ok(token);
    const checked = guard.validate(token!);
    assert.equal(checked.ok, true);
    assert.equal(checked.text, source);
  }
});

test('translationGuard: 数值被改动时拒绝结果', () => {
  const source = '图 5 中定义 x = y。';
  const guard = createTranslationFidelityGuard(source);
  const token = guard.sourceForModel.match(/FORMULA_TOKEN_[0-9]+/)?.[0];

  assert.ok(token);
  assert.equal(guard.validate(`图 6 中定义 x ${token} y。`).ok, false);
  assert.equal(guard.validate(`图 5 中定义 x ${token} y。`).ok, true);
});

test('translationGuard: 公式 token 乱序或缺失时拒绝结果', () => {
  const source = String.raw`先看 $a=b$，再看 $c=d$。`;
  const guard = createTranslationFidelityGuard(source);
  const tokens = guard.sourceForModel.match(/FORMULA_TOKEN_[0-9]+/g) || [];

  assert.equal(tokens.length, 2);
  assert.equal(guard.validate(`${tokens[1]}，${tokens[0]}`).ok, false);
  assert.equal(guard.validate(`${tokens[0]}，${tokens[1]}`).ok, true);
  assert.equal(guard.validate(tokens[0]).ok, false);
});

test('translationGuard: 没有公式的普通文本不阻断正常翻译', () => {
  const source = '这是一段普通的学术说明，没有数学表达式。';
  const guard = createTranslationFidelityGuard(source);

  assert.equal(guard.enabled, false);
  assert.deepEqual(validateTranslationFidelity(source, 'This is a normal translation.'), {
    ok: true,
    text: 'This is a normal translation.',
    errors: [],
  });
});

test('translationGuard: 价格文本的美元符号不被误判为公式', () => {
  const source = 'The price is $5 USD, not a formula.';
  const guard = createTranslationFidelityGuard(source);

  assert.equal(guard.enabled, false);
  assert.equal(guard.sourceForModel, source);
});
