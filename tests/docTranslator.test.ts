import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildPdf2zhArgs,
  buildPdf2zhEnvironment,
  parsePdf2zhProgress,
  getExpectedOutputPdfPath,
  resolveDocumentOutputDir,
  resolveDocumentThreads,
  splitProcessOutput,
  formatProcessExit,
  translateDocument,
} from '../src/docTranslator';
import { buildPdfLinkRepairArgs, resolvePdfPythonCandidates } from '../src/pdfLinkRepair';
import { PluginConfig } from '../src/types';

const mockConfig: PluginConfig = {
  endpointType: 'gemini',
  apiBaseUrl: 'https://generativelanguage.googleapis.com',
  apiKey: '',
  model: 'gemini-2.5-flash',
  targetLanguage: '简体中文',
  systemPrompt: '',
  agyPath: '/home/huqilin/.local/bin/agy',
  enableKaTeX: true,
  cacheSize: 500,
  autoTranslate: true,
  docTranslateMode: 'mono',
  pdf2zhPath: '/home/huqilin/.local/bin/pdf2zh',
  docAutoOpen: true,
};

test('docTranslator: buildPdf2zhArgs 参数构造', () => {
  // 基础参数
  const args1 = buildPdf2zhArgs(
    {
      inputPdfPath: '/path/to/paper.pdf',
    },
    mockConfig
  );

  assert.ok(args1.includes('/path/to/paper.pdf'));
  assert.ok(args1.includes('--lang-in'));
  assert.ok(args1.includes('en'));
  assert.ok(args1.includes('--lang-out'));
  assert.ok(args1.includes('zh'));
  assert.ok(args1.includes('--output'));
  assert.ok(args1.includes('/path/to'));
  assert.ok(args1.includes('--service'));
  assert.ok(args1.includes('gemini'));
  // 保留图表 Form XObject 的原始字形，避免翻译后图内文字消失。
  assert.ok(args1.includes('--skip-subset-fonts'));
  // 未填写页码时不注入任何固定页数，默认翻译 PDF 全部页面。
  assert.equal(args1.includes('--pages'), false);

  // 指定页码范围与自定义输出路径
  const args2 = buildPdf2zhArgs(
    {
      inputPdfPath: '/path/to/paper.pdf',
      pages: '1-5',
      outputDir: '/custom/output',
      service: 'bing',
    },
    mockConfig
  );

  assert.ok(args2.includes('--pages'));
  assert.ok(args2.includes('1-5'));
  assert.ok(args2.includes('--output'));
  assert.ok(args2.includes('/custom/output'));
  assert.ok(args2.includes('--service'));
  assert.ok(args2.includes('bing'));

  // agy 端点路由
  const agyConfig: PluginConfig = {
    ...mockConfig,
    endpointType: 'agy',
  };
  const args3 = buildPdf2zhArgs(
    {
      inputPdfPath: '/path/to/paper.pdf',
    },
    agyConfig
  );
  assert.ok(args3.includes('--service'));
  assert.ok(args3.includes('agy'));
  assert.equal(args3[args3.indexOf('--thread') + 1], '6');
});

test('docTranslator: 并发度限制与回车进度拆分', () => {
  assert.equal(resolveDocumentThreads({ ...mockConfig, docTranslateThreads: 2 }), 2);
  assert.equal(resolveDocumentThreads({ ...mockConfig, docTranslateThreads: 99 }), 8);
  assert.equal(resolveDocumentThreads({ ...mockConfig, docTranslateThreads: 0 }), 1);

  const first = splitProcessOutput('', ' 6%|██| 1/16\r 12%|██| 2/16\r');
  assert.deepEqual(first.lines, [' 6%|██| 1/16', ' 12%|██| 2/16']);
  assert.equal(first.remainder, '');
  const second = splitProcessOutput('partial', ' line\n');
  assert.deepEqual(second.lines, ['partial line']);
  assert.equal(second.remainder, '');
});

test('docTranslator: parsePdf2zhProgress 进度日志解析', () => {
  // 空行
  assert.equal(parsePdf2zhProgress('   '), null);

  // 版面分析阶段
  const pLayout = parsePdf2zhProgress('Loading DocLayout YOLO model for layout detection...');
  assert.ok(pLayout);
  assert.equal(pLayout?.stage, 'extract');
  assert.equal(pLayout?.percent, 15);

  // tqdm 进度条解析
  const pTqdm = parsePdf2zhProgress(' 50%|██████████          | 2/4 [00:03<00:03,  1.67s/it]');
  assert.ok(pTqdm);
  assert.equal(pTqdm?.stage, 'translating');
  assert.equal(pTqdm?.currentPage, 2);
  assert.equal(pTqdm?.totalPages, 4);
  assert.equal(pTqdm?.percent, 50);

  // 文本页码解析
  const pPage = parsePdf2zhProgress('Translating page 3/10 (formulas protected)');
  assert.ok(pPage);
  assert.equal(pPage?.stage, 'translating');
  assert.equal(pPage?.currentPage, 3);
  assert.equal(pPage?.totalPages, 10);

  const pBackendPage = parsePdf2zhProgress('Translating 4 / 16 pages');
  assert.ok(pBackendPage);
  assert.equal(pBackendPage?.currentPage, 4);
  assert.equal(pBackendPage?.totalPages, 16);

  // 排版回填阶段
  const pType = parsePdf2zhProgress('Typesetting Chinese fonts and reconstructing vector streams...');
  assert.ok(pType);
  assert.equal(pType?.stage, 'typesetting');
  assert.equal(pType?.percent, 90);

  // 完成阶段
  const pDone = parsePdf2zhProgress('Successfully saved translated output file to sample-mono.pdf');
  assert.ok(pDone);
  assert.equal(pDone?.stage, 'done');
  assert.equal(pDone?.percent, 100);

  // 启动参数里的 output= 不是完成信号，避免出现“第 9/17 页但 100%”。
  assert.equal(parsePdf2zhProgress("Namespace(files=['paper.pdf'], output='/tmp/out', thread=6)"), null);
});

test('docTranslator: API 失败优先显示 HTTP/模型诊断而不是 tenacity 尾部', () => {
  const message = formatProcessExit('排版翻译引擎退出', 1, [
    'ERROR:pdf2zh.converter:Error code: converter.py:611',
    "401 - {'error': {'message': 'Authentication Fails, Your api key: ****-key is invalid'}}",
    'do = self.iter(retry_state=retry_state)',
  ]);
  assert.match(message, /401/);
  assert.match(message, /Authentication Fails/);
  assert.doesNotMatch(message, /do = self\.iter/);
  assert.doesNotMatch(message, /secret-value/);
});

test('docTranslator: getExpectedOutputPdfPath 输出文件名推导', () => {
  // mono 模式（单语）
  const monoPath = getExpectedOutputPdfPath('/home/user/deep_learning.pdf', 'mono');
  assert.equal(monoPath, '/home/user/deep_learning-mono.pdf');

  // dual 模式（双语）
  const dualPath = getExpectedOutputPdfPath('/home/user/deep_learning.pdf', 'dual');
  assert.equal(dualPath, '/home/user/deep_learning-dual.pdf');

  // 自定义输出目录
  const customOutPath = getExpectedOutputPdfPath('/home/user/paper.pdf', 'mono', '/tmp/translated');
  assert.equal(customOutPath, '/tmp/translated/paper-mono.pdf');

  // 无目录的相对路径也必须落到可写的临时目录，避免 pdf2zh 对空目录名调用 makedirs。
  assert.equal(resolveDocumentOutputDir('paper.pdf'), '/tmp');
  assert.equal(getExpectedOutputPdfPath('paper.pdf', 'mono'), '/tmp/paper-mono.pdf');
});

test('docTranslator: 全文 Agy 配置传给 pdf2zh 子进程', () => {
  const env = buildPdf2zhEnvironment(
    { inputPdfPath: '/tmp/paper.pdf', service: 'agy' },
    {
      ...mockConfig,
      endpointType: 'agy',
      model: 'gemini-test',
      agyPath: '/custom/bin/agy',
    }
  );
  assert.deepEqual(env, {
    AGY_BIN: '/custom/bin/agy',
    AGY_MODEL: 'gemini-test',
    AGY_TRANSLATION_ONLY: '1',
    AGY_WORKERS: '6',
  });
});

test('docTranslator: DeepSeek 配置路由到 pdf2zh 的 deepseek 服务', () => {
  const config: PluginConfig = {
    ...mockConfig,
    endpointType: 'deepseek',
    apiBaseUrl: 'https://api.deepseek.com',
    apiKey: 'deepseek-test-key',
    model: 'deepseek-flash',
  };
  const env = buildPdf2zhEnvironment({ inputPdfPath: '/tmp/paper.pdf' }, config);
  assert.deepEqual(env, {
    DEEPSEEK_API_KEY: 'deepseek-test-key',
    DEEPSEEK_MODEL: 'deepseek-flash',
  });

  const args = buildPdf2zhArgs({ inputPdfPath: '/tmp/paper.pdf' }, config);
  assert.equal(args[args.indexOf('--service') + 1], 'deepseek');
});

test('docTranslator: DeepSeek 自定义兼容地址改走 OpenAI 服务并传入 Key', () => {
  const config: PluginConfig = {
    ...mockConfig,
    endpointType: 'deepseek',
    apiBaseUrl: 'https://proxy.example.test',
    deepseekApiKey: 'deepseek-test-key',
    model: 'deepseek-flash',
  };
  const env = buildPdf2zhEnvironment({ inputPdfPath: '/tmp/paper.pdf' }, config);
  assert.deepEqual(env, {
    OPENAI_BASE_URL: 'https://proxy.example.test/v1',
    OPENAI_API_KEY: 'deepseek-test-key',
    OPENAI_MODEL: 'deepseek-flash',
  });
  const args = buildPdf2zhArgs({ inputPdfPath: '/tmp/paper.pdf' }, config);
  assert.equal(args[args.indexOf('--service') + 1], 'openai');
});

test('docTranslator: Ollama/兼容端点不继承云端 API Key', () => {
  const env = buildPdf2zhEnvironment({ inputPdfPath: '/tmp/paper.pdf' }, {
    ...mockConfig,
    endpointType: 'openai',
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: 'stale-cloud-key',
    model: 'qwen3:8b',
  });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.OPENAI_BASE_URL, 'http://127.0.0.1:11434/v1');
});

test('pdfLinkRepair: 使用 pdf2zh 同一 Python 环境并携带模式参数', () => {
  const candidates = resolvePdfPythonCandidates('/home/huqilin/.local/bin/pdf2zh');
  assert.equal(candidates[0], '/home/huqilin/.local/bin/python');
  assert.ok(candidates.includes('python3'));
  assert.equal(candidates.at(-1), 'python3');

  const args = buildPdfLinkRepairArgs('/tmp/source.pdf', '/tmp/translated-dual.pdf', 'dual');
  assert.equal(args[0], '-c');
  assert.match(args[1], /fitz\.open/);
  assert.deepEqual(args.slice(-3), ['/tmp/source.pdf', '/tmp/translated-dual.pdf', 'dual']);
});

test('docTranslator: 插件可自行启动 pdf2zh 并检查输出文件', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2zh-mock-'));
  const mockBin = path.join(tmpDir, 'mock-pdf2zh.cjs');
  const envFile = path.join(tmpDir, 'env.json');
  fs.writeFileSync(
    mockBin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const input = process.argv[2];
const outputDir = process.argv[process.argv.indexOf('--output') + 1];
const base = path.basename(input).replace(/\\.pdf$/i, '');
fs.writeFileSync(process.env.TEST_ENV_FILE, JSON.stringify({ agy: process.env.AGY_BIN, model: process.env.AGY_MODEL }));
fs.writeFileSync(path.join(outputDir, base + '-mono.pdf'), 'mock pdf');
console.log('Successfully saved translated output file');
`,
    { mode: 0o755 }
  );
  const previousEnvFile = process.env.TEST_ENV_FILE;
  process.env.TEST_ENV_FILE = envFile;

  try {
    const result = await translateDocument(
      {
        inputPdfPath: '/tmp/source.pdf',
        outputDir: tmpDir,
        service: 'agy',
      },
      {
        ...mockConfig,
        endpointType: 'agy',
        pdf2zhPath: mockBin,
        agyPath: '/custom/bin/agy',
        model: 'gemini-test',
      }
    );

    assert.equal(result.targetPdfPath, path.join(tmpDir, 'source-mono.pdf'));
    assert.deepEqual(JSON.parse(fs.readFileSync(envFile, 'utf8')), {
      agy: '/custom/bin/agy',
      model: 'gemini-test',
    });

    // 未传 outputDir 时，插件必须把源 PDF 所在目录显式传给 pdf2zh，
    // 复现并防止 pdf2zh 1.9.x 的空目录名 FileNotFoundError。
    const nestedDir = path.join(tmpDir, 'nested');
    fs.mkdirSync(nestedDir);
    const resultWithoutOutput = await translateDocument(
      {
        inputPdfPath: path.join(nestedDir, 'relative.pdf'),
        service: 'agy',
      },
      {
        ...mockConfig,
        endpointType: 'agy',
        pdf2zhPath: mockBin,
        agyPath: '/custom/bin/agy',
        model: 'gemini-test',
      }
    );
    assert.equal(resultWithoutOutput.targetPdfPath, path.join(nestedDir, 'relative-mono.pdf'));
  } finally {
    if (previousEnvFile === undefined) {
      delete process.env.TEST_ENV_FILE;
    } else {
      process.env.TEST_ENV_FILE = previousEnvFile;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('docTranslator: 全文 API 失败会保留可操作的 HTTP 诊断并隐藏密钥', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2zh-api-error-'));
  const mockBin = path.join(tmpDir, 'mock-pdf2zh-error.cjs');
  fs.writeFileSync(
    mockBin,
    `#!/usr/bin/env node
process.stdout.write("ERROR:pdf2zh.converter:Error code: converter.py:611\\n");
process.stdout.write("401 - Authentication Fails, Your api key: Bearer secret-value is invalid\\n");
process.stderr.write("do = self.iter(retry_state=retry_state)\\n");
process.exit(1);
`,
    { mode: 0o755 }
  );

  try {
    await assert.rejects(
      translateDocument(
        { inputPdfPath: '/tmp/source.pdf', outputDir: tmpDir, service: 'deepseek' },
        {
          ...mockConfig,
          endpointType: 'deepseek',
          apiKey: 'secret-value',
          deepseekApiKey: 'secret-value',
          model: 'deepseek-flash',
          pdf2zhPath: mockBin,
        }
      ),
      (error: any) => {
        assert.match(error?.message || '', /401/);
        assert.match(error?.message || '', /Authentication Fails/);
        assert.doesNotMatch(error?.message || '', /do = self\.iter/);
        assert.doesNotMatch(error?.message || '', /secret-value/);
        return true;
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
