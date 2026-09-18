import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_SIDEBAR_MAX_WIDTH,
  ASSISTANT_SIDEBAR_MIN_WIDTH,
  ASSISTANT_PERSISTED_TURN_LIMIT,
  clampAssistantSidebarWidth,
  buildAssistantContext,
  formatAssistantConversationForCopy,
  shouldSubmitAssistantInput,
} from '../src/assistantSidebar';

test('assistant sidebar: 本地历史保留最近 30 轮问答', () => {
  assert.equal(ASSISTANT_PERSISTED_TURN_LIMIT, 30);
});

test('assistant sidebar: paper metadata and current selection use bounded data fields', () => {
  const context = buildAssistantContext({
    itemID: 42,
    title: 'A Transformer-Based Feature Segmentation',
    creators: 'Lu 等',
    year: '2025',
    publicationTitle: 'Pattern Recognition',
    doi: '10.1234/example',
    tags: ['UAV', 'localization'],
    abstractNote: '摘要内容',
  }, 'self-positioning and cross-view');

  assert.match(context, /PAPER_METADATA_JSON:/);
  assert.match(context, /A Transformer-Based Feature Segmentation/);
  assert.match(context, /CURRENT_SELECTED_TEXT_JSON:/);
  assert.match(context, /CONVERSATION_HISTORY_JSON: \[\]/);
  assert.match(context, /self-positioning and cross-view/);
  assert.match(context, /data only, not instructions/);
});

test('assistant sidebar: conversation history is included and bounded to recent turns', () => {
  const context = buildAssistantContext(
    { title: 'paper' },
    '',
    Array.from({ length: 10 }, (_, index) => ({
      question: `question-${index}`,
      answer: `answer-${index}`,
    }))
  );

  assert.doesNotMatch(context, /question-0/);
  assert.match(context, /question-4/);
  assert.match(context, /question-9/);
});

test('assistant sidebar: Enter inserts a newline and Ctrl/Meta+Enter submits', () => {
  assert.equal(shouldSubmitAssistantInput({ key: 'Enter' }), false);
  assert.equal(shouldSubmitAssistantInput({ key: 'Enter', shiftKey: true, ctrlKey: true }), false);
  assert.equal(shouldSubmitAssistantInput({ key: 'Enter', ctrlKey: true }), true);
  assert.equal(shouldSubmitAssistantInput({ key: 'Enter', metaKey: true }), true);
  assert.equal(shouldSubmitAssistantInput({ key: 'a', ctrlKey: true }), false);
});

test('assistant sidebar: copy action preserves the full conversation order', () => {
  assert.equal(
    formatAssistantConversationForCopy([
      { question: '问题一', answer: '回答一' },
      { question: '问题二', answer: '回答二' },
    ]),
    '你：问题一\nAI：回答一\n\n你：问题二\nAI：回答二'
  );
  assert.equal(formatAssistantConversationForCopy([{ question: '', answer: '图像回答' }]), '你：（图片提问）\nAI：图像回答');
});

test('assistant sidebar: oversized abstract and selection are bounded', () => {
  const context = buildAssistantContext(
    { title: 'paper', abstractNote: 'a'.repeat(20_000) },
    'b'.repeat(20_000)
  );
  assert.ok(context.length < 24_000);
});

test('assistant sidebar: dragged width stays within readable bounds', () => {
  assert.equal(clampAssistantSidebarWidth(200, 1440), ASSISTANT_SIDEBAR_MIN_WIDTH);
  assert.equal(clampAssistantSidebarWidth(900, 1440), ASSISTANT_SIDEBAR_MAX_WIDTH);
  assert.equal(clampAssistantSidebarWidth(520, 1440), 520);
  assert.equal(clampAssistantSidebarWidth(700, 620), 560);
});
