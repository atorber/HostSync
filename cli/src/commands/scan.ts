import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import mime from 'mime-types';
import { loadConfig } from '../lib/config';
import { encodeRelativePath, getRemotePrefix, normalizeHostnameForKey, validateRemoteKey } from '../lib/pathMapper';
import { createS3Client, uploadFile } from '../lib/s3Client';
import {
  getRegisteredToolNames,
  scanAll,
  scanHome,
  scanProject,
  type ScanResult,
  type ScannedFile,
} from '../lib/scanner';

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

/** 简单的固定宽度表格输出 */
function printTable(
  title: string,
  rows: Array<{ tool: string; file: string; size: string; mtime: string }>,
): void {
  if (rows.length === 0) return;

  // 计算列宽
  const headers = { tool: '工具', file: '文件', size: '大小', mtime: '修改时间' };
  const widths = {
    tool: Math.max(headers.tool.length, ...rows.map((r) => strWidth(r.tool))),
    file: Math.max(headers.file.length, ...rows.map((r) => strWidth(r.file))),
    size: Math.max(headers.size.length, ...rows.map((r) => strWidth(r.size))),
    mtime: Math.max(headers.mtime.length, ...rows.map((r) => strWidth(r.mtime))),
  };

  const sep = `+-${'-'.repeat(widths.tool)}-+-${'-'.repeat(widths.file)}-+-${'-'.repeat(widths.size)}-+-${'-'.repeat(widths.mtime)}-+`;

  // eslint-disable-next-line no-console
  console.log(`\n${title}`);
  // eslint-disable-next-line no-console
  console.log(sep);
  // eslint-disable-next-line no-console
  console.log(
    `| ${padEnd(headers.tool, widths.tool)} | ${padEnd(headers.file, widths.file)} | ${padEnd(headers.size, widths.size)} | ${padEnd(headers.mtime, widths.mtime)} |`,
  );
  // eslint-disable-next-line no-console
  console.log(sep);

  for (const row of rows) {
    // eslint-disable-next-line no-console
    console.log(
      `| ${padEnd(row.tool, widths.tool)} | ${padEnd(row.file, widths.file)} | ${padEnd(row.size, widths.size)} | ${padEnd(row.mtime, widths.mtime)} |`,
    );
  }

  // eslint-disable-next-line no-console
  console.log(sep);
}

/** 简单的字符宽度估算（中文字符占 2 列） */
function strWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    // CJK Unified Ideographs and some common fullwidth ranges
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** padEnd 兼容中文宽度 */
function padEnd(s: string, targetWidth: number): string {
  const diff = targetWidth - strWidth(s);
  if (diff <= 0) return s;
  return s + ' '.repeat(diff);
}

/* ------------------------------------------------------------------ */
/*  Push helpers                                                       */
/* ------------------------------------------------------------------ */

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/* ------------------------------------------------------------------ */
/*  Command definition                                                 */
/* ------------------------------------------------------------------ */

export const scanCommand = new Command('scan')
  .description('自动扫描 AI 编码工具的配置文件（Claude Code、Cursor、Codex 等）')
  .option('--project-only', '仅扫描项目目录', false)
  .option('--home-only', '仅扫描用户主目录', false)
  .option('--tool <name>', '仅扫描指定工具（如 cursor, claude code）')
  .option('--json', '以 JSON 格式输出', false)
  .option('--push', '发现后直接推送到 S3', false)
  .option('--yes', '与 --push 配合，跳过确认提示', false)
  .action(
    async (options: {
      projectOnly?: boolean;
      homeOnly?: boolean;
      tool?: string;
      json?: boolean;
      push?: boolean;
      yes?: boolean;
    }) => {
      const cwd = process.cwd();
      const toolFilter = options.tool?.trim();

      // 校验 tool 过滤器
      if (toolFilter) {
        const registered = getRegisteredToolNames();
        const match = registered.find((n) => n.toLowerCase() === toolFilter.toLowerCase());
        if (!match) {
          // eslint-disable-next-line no-console
          console.error(`未知工具：${toolFilter}`);
          // eslint-disable-next-line no-console
          console.error(`支持的工具：${registered.join(', ')}`);
          process.exitCode = 1;
          return;
        }
      }

      // 执行扫描
      let results: ScanResult[];
      if (options.homeOnly) {
        results = await scanHome(toolFilter);
      } else if (options.projectOnly) {
        results = await scanProject(cwd, toolFilter);
      } else {
        results = await scanAll(cwd, toolFilter);
      }

      // 总文件数
      const totalFiles = results.reduce((n, r) => n + r.files.length, 0);
      const toolNames = new Set(results.map((r) => r.tool));

      if (totalFiles === 0) {
        if (options.json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ results: [], totalFiles: 0, totalTools: 0 }));
        } else {
          // eslint-disable-next-line no-console
          console.log('未发现任何 AI 工具配置文件。');
        }
        return;
      }

      // JSON 输出模式
      if (options.json) {
        const output = {
          results: results.map((r) => ({
            tool: r.tool,
            scope: r.scope,
            files: r.files.map((f) => ({
              path: f.relPath,
              absPath: f.absPath,
              size: f.size,
              mtime: f.mtime.toISOString(),
            })),
          })),
          totalFiles,
          totalTools: toolNames.size,
        };
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // 表格输出
      const projectResults = results.filter((r) => r.scope === 'project');
      const homeResults = results.filter((r) => r.scope === 'home');

      if (projectResults.length > 0) {
        const rows = projectResults.flatMap((r) =>
          r.files.map((f) => ({
            tool: r.tool,
            file: f.relPath,
            size: formatSize(f.size),
            mtime: formatDate(f.mtime),
          })),
        );
        printTable(`📂 项目配置 (${cwd})`, rows);
      }

      if (homeResults.length > 0) {
        const rows = homeResults.flatMap((r) =>
          r.files.map((f) => ({
            tool: r.tool,
            file: f.relPath,
            size: formatSize(f.size),
            mtime: formatDate(f.mtime),
          })),
        );
        printTable(`🏠 全局配置 (~)`, rows);
      }

      // eslint-disable-next-line no-console
      console.log(`\n发现 ${totalFiles} 个文件，来自 ${toolNames.size} 个工具`);

      // --push 模式
      if (options.push) {
        await handlePush(results, options.yes ?? false);
      }
    },
  );

/* ------------------------------------------------------------------ */
/*  Push logic                                                         */
/* ------------------------------------------------------------------ */

async function handlePush(results: ScanResult[], skipConfirm: boolean): Promise<void> {
  const totalFiles = results.reduce((n, r) => n + r.files.length, 0);

  // 确认提示
  if (!skipConfirm) {
    // eslint-disable-next-line no-console
    console.log(`\n即将推送 ${totalFiles} 个文件到 S3...`);
    const prompts = await import('prompts');
    const { confirm } = await prompts.default({
      type: 'confirm',
      name: 'confirm',
      message: '确认推送？',
      initial: true,
    });
    if (!confirm) {
      // eslint-disable-next-line no-console
      console.log('已取消。');
      return;
    }
  }

  const config = await loadConfig();
  const client = createS3Client(config);
  const hostname = normalizeHostnameForKey(os.hostname());

  const uploadTasks: Array<{ absPath: string; key: string }> = [];

  for (const r of results) {
    if (r.scope === 'project') {
      // 项目文件：使用标准前缀 {hostname}/{cwd}/
      const prefix = getRemotePrefix(process.cwd());
      if (!validateRemoteKey(prefix)) {
        throw new Error(`路径校验失败：${prefix}`);
      }
      for (const f of r.files) {
        const relEncoded = encodeRelativePath(f.relPath);
        const key = `${prefix}/${relEncoded}`;
        if (!validateRemoteKey(key)) throw new Error(`非法 key：${key}`);
        uploadTasks.push({ absPath: f.absPath, key });
      }
    } else {
      // 全局文件：按文件在本机的实际绝对路径分层（与 push 一致）
      for (const f of r.files) {
        const dirPrefix = getRemotePrefix(path.dirname(f.absPath));
        if (!validateRemoteKey(dirPrefix)) {
          throw new Error(`路径校验失败：${dirPrefix}`);
        }
        const baseEncoded = encodeRelativePath(path.basename(f.absPath));
        const key = `${dirPrefix}/${baseEncoded}`;
        if (!validateRemoteKey(key)) throw new Error(`非法 key：${key}`);
        uploadTasks.push({ absPath: f.absPath, key });
      }
    }
  }

  await mapLimit(uploadTasks, 8, async (task) => {
    const ct = mime.lookup(path.basename(task.absPath)) || 'application/octet-stream';
    await uploadFile(client, config.bucket, task.key, task.absPath, String(ct));
  });

  // eslint-disable-next-line no-console
  console.log(`推送成功：${uploadTasks.length} 个 AI 配置文件 → s3://${config.bucket}/`);
}
