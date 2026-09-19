import { DocTranslateOptions, DocTranslateProgress, DocumentTranslationService, PluginConfig } from './types';
import { getSubprocess } from './env';
import { buildPdfLinkRepairArgs, resolvePdfPythonCandidates } from './pdfLinkRepair';
import { DEEPSEEK_API_BASE_URL, getApiKeyForEndpoint, normalizeModelForEndpoint } from './config';

function isOfficialDeepSeekBaseUrl(value: string): boolean {
  const normalized = String(value || DEEPSEEK_API_BASE_URL)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
  return /^https:\/\/api\.deepseek\.com$/i.test(normalized);
}

function openAICompatibleBaseUrl(value: string): string {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) return normalized;
  return /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`;
}

function resolveDocumentService(options: DocTranslateOptions, config: PluginConfig): DocumentTranslationService {
  if (options.service) return options.service;
  if (config.endpointType === 'deepseek') {
    return isOfficialDeepSeekBaseUrl(config.apiBaseUrl) ? 'deepseek' : 'openai';
  }
  if (config.endpointType === 'gemini') return 'gemini';
  if (config.endpointType === 'openai') return 'openai';
  return 'agy';
}

export function buildPdf2zhEnvironment(
  options: DocTranslateOptions,
  config: PluginConfig
): Record<string, string> {
  const service = resolveDocumentService(options, config);
  const environment: Record<string, string> = {};

  if (service === 'agy') {
    environment.AGY_BIN = config.agyPath || 'agy';
    environment.AGY_MODEL = config.model || 'gemini-3.8-flash-low';
    environment.AGY_TRANSLATION_ONLY = '1';
    environment.AGY_WORKERS = String(resolveDocumentThreads(config));
  } else if (service === 'deepseek') {
    const apiKey = getApiKeyForEndpoint(config);
    if (apiKey) environment.DEEPSEEK_API_KEY = apiKey;
    const model = normalizeModelForEndpoint('deepseek', config.model);
    if (model) environment.DEEPSEEK_MODEL = model;
  } else if (service === 'gemini') {
    const apiKey = getApiKeyForEndpoint(config);
    if (apiKey) environment.GEMINI_API_KEY = apiKey;
    if (config.model) environment.GEMINI_MODEL = config.model;
  } else if (service === 'openai') {
    if (config.apiBaseUrl) {
      environment.OPENAI_BASE_URL = config.endpointType === 'deepseek'
        ? openAICompatibleBaseUrl(config.apiBaseUrl)
        : config.apiBaseUrl;
    }
    if (config.endpointType === 'deepseek') {
      const apiKey = getApiKeyForEndpoint(config);
      if (apiKey) environment.OPENAI_API_KEY = apiKey;
    }
    const model = normalizeModelForEndpoint(config.endpointType, config.model);
    if (model) environment.OPENAI_MODEL = model;
  } else if (service === 'ollama') {
    if (config.apiBaseUrl) environment.OLLAMA_HOST = config.apiBaseUrl.replace(/\/v1\/?$/, '');
    if (config.model) environment.OLLAMA_MODEL = config.model;
  } else if (service === 'modelscope') {
    if (config.apiKey) environment.MODELSCOPE_API_KEY = config.apiKey;
    if (config.model) environment.MODELSCOPE_MODEL = config.model;
  }

  return environment;
}

export function resolveDocumentOutputDir(inputPdfPath: string, outputDir?: string): string {
  if (outputDir && outputDir.trim()) return outputDir;
  const lastSeparator = Math.max(inputPdfPath.lastIndexOf('/'), inputPdfPath.lastIndexOf('\\'));
  const inputDir = lastSeparator >= 0 ? inputPdfPath.substring(0, lastSeparator) : '';
  return inputDir || '/tmp';
}

export function resolveDocumentThreads(config: PluginConfig): number {
  const requested = Number(config.docTranslateThreads);
  if (!Number.isFinite(requested)) return 6;
  return Math.min(8, Math.max(1, Math.floor(requested)));
}

export function splitProcessOutput(buffer: string, chunk: string): { lines: string[]; remainder: string } {
  const combined = `${buffer}${chunk}`;
  const parts = combined.split(/\r\n|\r|\n/);
  const hasTerminator = /(?:\r\n|\r|\n)$/.test(combined);
  const remainder = hasTerminator ? '' : (parts.pop() || '');
  const lines = hasTerminator ? parts.slice(0, -1) : parts;
  return { lines, remainder };
}

async function outputFileExists(filePath: string): Promise<boolean> {
  const globals = globalThis as any;
  if (globals.IOUtils?.exists) {
    return Boolean(await globals.IOUtils.exists(filePath));
  }
  if (globals.OS?.File?.exists) {
    return Boolean(await globals.OS.File.exists(filePath));
  }
  if (typeof process !== 'undefined' && (process as any).versions?.node) {
    const fsModule = 'node:fs/promises';
    const fs = await import(fsModule);
    try {
      await fs.access(filePath);
      return true;
    } catch (_) {
      return false;
    }
  }
  return true;
}

async function resolvePdfPython(pdf2zhBin: string): Promise<string> {
  for (const candidate of resolvePdfPythonCandidates(pdf2zhBin)) {
    if (candidate === 'python3' || await outputFileExists(candidate)) return candidate;
  }
  return 'python3';
}

async function readSubprocessPipe(pipe: any): Promise<string> {
  if (!pipe?.readString) return '';
  let output = '';
  try {
    while (true) {
      const chunk = await pipe.readString();
      if (!chunk) break;
      output += chunk;
      if (output.length > 8000) output = output.slice(-8000);
    }
  } catch (_) {}
  return output;
}

function validatePdfLinkRepairSummary(output: string): void {
  const line = output.trim().split(/\r?\n/).reverse().find(Boolean);
  if (!line) throw new Error('修复进程没有返回校验结果');
  let summary: any;
  try {
    summary = JSON.parse(line);
  } catch (_) {
    throw new Error(`修复进程返回了无效校验结果: ${line.slice(0, 400)}`);
  }
  if (Number(summary.skipped) > 0) {
    throw new Error(`仍有 ${summary.skipped} 个链接未能写回`);
  }
  if (Number(summary.inserted) !== Number(summary.verified)) {
    throw new Error(`链接写入数 ${summary.inserted} 与校验数 ${summary.verified} 不一致`);
  }
}

async function repairTranslatedPdfLinks(
  options: DocTranslateOptions,
  targetPdfPath: string,
  mode: 'mono' | 'dual',
  pdf2zhBin: string
): Promise<void> {
  if (!(await outputFileExists(options.inputPdfPath)) || !(await outputFileExists(targetPdfPath))) return;

  options.onProgress?.({
    stage: 'typesetting',
    percent: 96,
    message: '正在修复并校验文内引用与外部链接...',
  });

  const pythonBin = await resolvePdfPython(pdf2zhBin);
  const args = buildPdfLinkRepairArgs(options.inputPdfPath, targetPdfPath, mode);
  const Subprocess = getSubprocess();

  if (Subprocess?.call) {
    let proc: any;
    try {
      proc = await Subprocess.call({
        command: pythonBin,
        arguments: args,
        environmentAppend: true,
        workdir: '/tmp',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stdoutReader = readSubprocessPipe(proc.stdout);
      const stderrReader = readSubprocessPipe(proc.stderr);
      const { exitCode } = await proc.wait();
      const [stdout, stderr] = await Promise.all([stdoutReader, stderrReader]);
      if (exitCode !== 0) {
        throw new Error((stderr || stdout || `修复进程退出码 ${exitCode}`).trim());
      }
      validatePdfLinkRepairSummary(stdout);
    } catch (err: any) {
      throw new Error(`交叉引用修复进程失败 (${pythonBin}): ${err?.message || String(err)}`);
    }
  } else if (typeof process !== 'undefined' && (process as any).versions?.node) {
    const nodeCp = 'node:child_process';
    const childProcess: any = await import(nodeCp);
    await new Promise<void>((resolve, reject) => {
      const cp = childProcess.spawn(pythonBin, args, {
        cwd: '/tmp',
        env: process.env,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      cp.stdout?.on('data', (data: Buffer) => {
        stdout = `${stdout}${data.toString('utf8')}`.slice(-8000);
      });
      cp.stderr?.on('data', (data: Buffer) => {
        stderr = `${stderr}${data.toString('utf8')}`.slice(-8000);
      });
      cp.on('error', (err: Error) => reject(err));
      cp.on('close', (code: number | null) => {
        if (code === 0) {
          try {
            validatePdfLinkRepairSummary(stdout);
            resolve();
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error((stderr || stdout || `修复进程退出码 ${code}`).trim()));
        }
      });
    });
  } else {
    throw new Error('当前环境未提供可执行子进程，无法修复 PDF 链接');
  }

  options.onProgress?.({
    stage: 'typesetting',
    percent: 99,
    message: '文内引用与外部链接校验通过',
  });
}

function documentError(options: DocTranslateOptions, message: string): Error {
  options.onProgress?.({ stage: 'error', percent: 0, message });
  return new Error(message);
}

function appendProcessDiagnostic(lines: string[], chunk: string): void {
  const ansi = /\u001b\[[0-?]*[ -/]*[@-~]/g;
  for (const rawLine of chunk.split(/\r?\n/)) {
    const line = rawLine.replace(ansi, '').trim();
    if (!line) continue;
    lines.push(line);
    if (lines.length > 80) lines.shift();
  }
}

function sanitizeProcessDiagnostic(line: string): string {
  return line
    .replace(/(Bearer\s+)[^\s,]+/gi, '$1***')
    .replace(/((?:api[-_ ]?key|DEEPSEEK_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY)\s*[:=]\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi, '$1***');
}

function diagnosticScore(line: string): number {
  let score = 0;
  if (/(?:Error code:|HTTP\/\d(?:\.\d)?\s+[45]\d\d|\b[45]\d\d\b)/i.test(line)) score += 100;
  if (/(?:authentication|api[-_ ]?key|invalid|model|rate.?limit|quota|context length|insufficient)/i.test(line)) score += 60;
  if (/\bERROR\b/i.test(line)) score += 20;
  if (/\b(?:error|exception|failed)\b/i.test(line)) score += 10;
  return score;
}

export function formatProcessExit(prefix: string, code: number | null, diagnostics: string[]): string {
  const normalized = diagnostics.map(sanitizeProcessDiagnostic).filter(Boolean);
  let best = '';
  let bestScore = 0;
  for (const line of normalized) {
    const score = diagnosticScore(line);
    if (score >= bestScore) {
      best = line;
      bestScore = score;
    }
  }
  const detail = (best || normalized.slice(-8).join(' ')).slice(-1600);
  return `${prefix} (代码 ${code})${detail ? `：${detail}` : ''}`;
}

export function buildPdf2zhArgs(options: DocTranslateOptions, config: PluginConfig): string[] {
  const args: string[] = [options.inputPdfPath];

  args.push('--lang-in', 'en');
  args.push('--lang-out', 'zh');

  args.push('--output', resolveDocumentOutputDir(options.inputPdfPath, options.outputDir));

  if (options.pages && options.pages.trim()) {
    args.push('--pages', options.pages.trim());
  }

  const service = resolveDocumentService(options, config);
  args.push('--service', service);

  args.push('--thread', String(resolveDocumentThreads(config)));

  args.push('--skip-subset-fonts');

  return args;
}

export function parsePdf2zhProgress(rawLine: string): DocTranslateProgress | null {
  const line = rawLine.trim();
  if (!line) return null;

  if (/loading|parsing|doclayout|extract|model not found/i.test(line)) {
    return {
      stage: 'extract',
      percent: 15,
      message: '正在解析论文双栏版面与数学公式...',
    };
  }

  const tqdmMatch = line.match(/(\d+)%\s*\|.*?\|\s*(\d+)\s*\/\s*(\d+)/);
  if (tqdmMatch) {
    const pct = parseInt(tqdmMatch[1], 10);
    const cur = parseInt(tqdmMatch[2], 10);
    const total = parseInt(tqdmMatch[3], 10);
    return {
      stage: 'translating',
      currentPage: cur,
      totalPages: total,
      percent: Math.min(95, Math.max(20, pct)),
      message: `正在翻译第 ${cur} / ${total} 页`,
    };
  }

  const pageMatch = line.match(/(?:page|\[)\s*(\d+)\s*(?:\/|\s*of\s*)\s*(\d+)/i)
    || line.match(/(?:translating|translated)\s+(\d+)\s*\/\s*(\d+)\s*pages?/i);
  if (pageMatch) {
    const cur = parseInt(pageMatch[1], 10);
    const total = parseInt(pageMatch[2], 10);
    const pct = Math.min(85, Math.round(20 + (cur / Math.max(1, total)) * 60));
    return {
      stage: 'translating',
      currentPage: cur,
      totalPages: total,
      percent: pct,
      message: `正在翻译第 ${cur} / ${total} 页`,
    };
  }

  if (/typesetting|render|format|insert|rebuilding/i.test(line)) {
    return {
      stage: 'typesetting',
      percent: 90,
      message: '正在生成高保真排印文件...',
    };
  }

  if (/(?:translation\s+(?:complete|completed|finished)|successfully\s+saved\s+translated\s+(?:output\s+)?(?:file|pdf)|translated\s+(?:output\s+)?(?:file|pdf)\s+(?:saved|written))/i.test(line)) {
    return {
      stage: 'done',
      percent: 100,
      message: '全文翻译完成！',
    };
  }

  return null;
}

function emitPdf2zhProgress(options: DocTranslateOptions, progress: DocTranslateProgress | null): void {
  if (progress && progress.stage !== 'done') options.onProgress?.(progress);
}

export function getExpectedOutputPdfPath(inputPdfPath: string, mode: 'mono' | 'dual', outputDir?: string): string {
  const dir = resolveDocumentOutputDir(inputPdfPath, outputDir);
  const filename = inputPdfPath.substring(Math.max(inputPdfPath.lastIndexOf('/'), inputPdfPath.lastIndexOf('\\')) + 1);
  const baseName = filename.replace(/\.pdf$/i, '');
  const suffix = mode === 'dual' ? '-dual.pdf' : '-mono.pdf';
  return dir ? `${dir}/${baseName}${suffix}` : `${baseName}${suffix}`;
}

export async function translateDocument(
  options: DocTranslateOptions,
  config: PluginConfig
): Promise<{ monoPdfPath: string; dualPdfPath: string; targetPdfPath: string }> {
  const pdf2zhBin = config.pdf2zhPath || 'pdf2zh';
  const args = buildPdf2zhArgs(options, config);
  const mode = options.mode || config.docTranslateMode || 'mono';

  options.onProgress?.({
    stage: 'prepare',
    percent: 5,
    message: '正在准备翻译环境与检查排印模型...',
  });

  const Subprocess = getSubprocess();

  if (Subprocess?.call) {
    let proc: any;
    const processDiagnostics: string[] = [];
    try {
      proc = await Subprocess.call({
        command: pdf2zhBin,
        arguments: args,
        environment: buildPdf2zhEnvironment(options, config),
        environmentAppend: true,
        workdir: '/tmp',
        stderr: 'pipe',
        stdout: 'pipe',
      });
    } catch (err: any) {
      const error = new Error(`无法启动排版翻译引擎 (${pdf2zhBin})。请检查路径或执行权限: ${err.message}`);
      options.onProgress?.({
        stage: 'error',
        percent: 0,
        message: error.message,
      });
      throw error;
    }

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        try {
          proc.kill();
        } catch (_) {}
      });
    }

    const readStream = async (pipe: any, captureDiagnostics = false) => {
      try {
        let buffer = '';
        while (true) {
          if (options.signal?.aborted) break;
          const chunk = await pipe.readString();
          if (!chunk) break;
          const split = splitProcessOutput(buffer, chunk);
          buffer = split.remainder;
          for (const line of split.lines) {
            if (captureDiagnostics) appendProcessDiagnostic(processDiagnostics, line);
            const progress = parsePdf2zhProgress(line);
            emitPdf2zhProgress(options, progress);
          }
        }
        if (buffer) {
          if (captureDiagnostics) appendProcessDiagnostic(processDiagnostics, buffer);
          const progress = parsePdf2zhProgress(buffer);
          emitPdf2zhProgress(options, progress);
        }
      } catch (_) {}
    };

    const stdoutReader = readStream(proc.stdout, true);
    const stderrReader = readStream(proc.stderr, true);

    const { exitCode } = await proc.wait();
    await Promise.allSettled([stdoutReader, stderrReader]);
    if (options.signal?.aborted) {
      throw documentError(options, '用户已取消全文翻译任务');
    }

    if (exitCode !== 0) {
      throw documentError(options, formatProcessExit('排版翻译引擎退出', exitCode, processDiagnostics));
    }

    const monoPdfPath = getExpectedOutputPdfPath(options.inputPdfPath, 'mono', options.outputDir);
    const dualPdfPath = getExpectedOutputPdfPath(options.inputPdfPath, 'dual', options.outputDir);
    const targetPdfPath = mode === 'dual' ? dualPdfPath : monoPdfPath;

    if (!(await outputFileExists(targetPdfPath))) {
      throw documentError(options, `翻译进程已结束，但未找到译文文件: ${targetPdfPath}`);
    }

    try {
      await repairTranslatedPdfLinks(options, targetPdfPath, mode, pdf2zhBin);
    } catch (err: any) {
      throw documentError(options, `译文已生成，但交叉引用修复失败: ${err?.message || String(err)}`);
    }

    options.onProgress?.({
      stage: 'done',
      percent: 100,
      message: '全文高保真翻译完成！',
    });

    return { monoPdfPath, dualPdfPath, targetPdfPath };
  }

  if (typeof process !== 'undefined' && (process as any).versions?.node) {
    const nodeCp = 'node:child_process';
    const childProcess: any = await import(nodeCp);
    return new Promise((resolve, reject) => {
      const processDiagnostics: string[] = [];
      let stdoutBuffer = '';
      let stderrBuffer = '';
      const cp = childProcess.spawn(pdf2zhBin, args, {
        cwd: '/tmp',
        env: {
          ...process.env,
          ...buildPdf2zhEnvironment(options, config),
        },
        windowsHide: true,
      });

      if (options.signal) {
        options.signal.addEventListener('abort', () => cp.kill());
      }

      const handleData = (data: Buffer, buffer: string, captureDiagnostics = false): string => {
        const text = data.toString('utf-8');
        const split = splitProcessOutput(buffer, text);
        for (const line of split.lines) {
          if (captureDiagnostics) appendProcessDiagnostic(processDiagnostics, line);
          const progress = parsePdf2zhProgress(line);
          emitPdf2zhProgress(options, progress);
        }
        return split.remainder;
      };

      cp.stdout.on('data', (data: Buffer) => {
        stdoutBuffer = handleData(data, stdoutBuffer, true);
      });
      cp.stderr.on('data', (data: Buffer) => {
        stderrBuffer = handleData(data, stderrBuffer, true);
      });

      cp.on('close', (code: number | null) => {
        if (stdoutBuffer) {
          const progress = parsePdf2zhProgress(stdoutBuffer);
          emitPdf2zhProgress(options, progress);
        }
        if (stderrBuffer) {
          appendProcessDiagnostic(processDiagnostics, stderrBuffer);
          const progress = parsePdf2zhProgress(stderrBuffer);
          emitPdf2zhProgress(options, progress);
        }
        if (options.signal?.aborted) {
          reject(documentError(options, '用户已取消全文翻译任务'));
          return;
        }
        if (code !== 0) {
          reject(documentError(options, formatProcessExit('排版翻译引擎进程退出', code, processDiagnostics)));
          return;
        }

        const monoPdfPath = getExpectedOutputPdfPath(options.inputPdfPath, 'mono', options.outputDir);
        const dualPdfPath = getExpectedOutputPdfPath(options.inputPdfPath, 'dual', options.outputDir);
        const targetPdfPath = mode === 'dual' ? dualPdfPath : monoPdfPath;

        void outputFileExists(targetPdfPath).then((exists) => {
          if (!exists) {
            reject(documentError(options, `翻译进程已结束，但未找到译文文件: ${targetPdfPath}`));
            return;
          }
          void repairTranslatedPdfLinks(options, targetPdfPath, mode, pdf2zhBin).then(() => {
            options.onProgress?.({
              stage: 'done',
              percent: 100,
              message: '全文高保真翻译完成！',
            });
            resolve({ monoPdfPath, dualPdfPath, targetPdfPath });
          }, (err: unknown) => {
            reject(documentError(options, `译文已生成，但交叉引用修复失败: ${err instanceof Error ? err.message : String(err)}`));
          });
        }, (err: unknown) => {
          reject(documentError(options, `检查译文文件失败: ${err instanceof Error ? err.message : String(err)}`));
        });
      });

      cp.on('error', (err: Error) => {
        reject(documentError(options, `无法启动排版翻译引擎: ${err.message}`));
      });
    });
  }

  throw new Error('当前环境未提供 Subprocess 模块，无法执行全文翻译');
}

export async function attachTranslatedPdfToItem(
  parentItem: any,
  translatedPdfPath: string,
  mode: 'mono' | 'dual'
): Promise<any> {
  if (typeof Zotero === 'undefined' || !Zotero.Attachments?.importFromFile) {
    return null;
  }

  const parentID = parentItem.isRegularItem?.() ? parentItem.id : (parentItem.parentItemID || parentItem.id);
  const baseTitle = parentItem.getField?.('title') || '论文';
  const prefix = mode === 'dual' ? '[双语对照]' : '[中文译本]';
  const title = `${prefix} ${baseTitle}`;

  try {
    const attachment = await Zotero.Attachments.importFromFile({
      file: translatedPdfPath,
      parentItemID: parentID,
      title,
    });
    Zotero.debug?.(`[Gemini Translator] 成功添加译文附件: ${title} (id: ${attachment?.id})`);
    return attachment;
  } catch (err: any) {
    Zotero.debug?.(`[Gemini Translator] 导入译文附件失败: ${err.message}`);
    return null;
  }
}

export async function openAttachmentInReader(attachmentItem: any): Promise<void> {
  if (typeof Zotero === 'undefined' || !Zotero.Reader?.open) return;
  try {
    await Zotero.Reader.open(attachmentItem.id);
  } catch (err: any) {
    Zotero.debug?.(`[Gemini Translator] 打开阅读器失败: ${err.message}`);
  }
}
