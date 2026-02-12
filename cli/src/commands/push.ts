import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import mime from 'mime-types';
import { loadConfig } from '../lib/config';
import { loadIgnore } from '../lib/ignore';
import { encodeRelativePath, getRemotePrefix, validateRemoteKey } from '../lib/pathMapper';
import { createS3Client, uploadFile } from '../lib/s3Client';
import { walkFiles } from '../lib/walk';

function toRelPosixWithinCwd(cwd: string, inputPath: string): { absPath: string; relPosix: string } {
  const absPath = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(cwd, inputPath);
  const rel = path.relative(cwd, absPath);
  if (!rel || rel === '.') throw new Error('请指定一个文件路径（不能是目录本身）。');
  if (rel.startsWith('..' + path.sep) || rel === '..') throw new Error(`仅允许同步当前目录内文件：${inputPath}`);
  const relPosix = rel.split(path.sep).join('/');
  return { absPath, relPosix };
}

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

export const pushCommand = new Command('push')
  .description('上传文件到 S3（按 hostname + 绝对路径分层）')
  .argument('[file]', '仅同步单个文件（相对当前目录或绝对路径）')
  .option('-f, --file <file>', '仅同步单个文件（同 [file]）')
  .option('--dry-run', '仅打印将要上传的文件，不实际上传', false)
  .action(async (fileArg: string | undefined, options: { dryRun?: boolean; file?: string }) => {
    const cwd = process.cwd();
    const config = await loadConfig();
    const client = createS3Client(config);

    const prefix = getRemotePrefix(cwd);
    if (!validateRemoteKey(prefix)) {
      throw new Error(`路径校验失败：${prefix}`);
    }

    const ig = await loadIgnore(cwd);
    const single = (options.file ?? fileArg)?.trim();
    const files = single
      ? (() => {
          const { absPath, relPosix } = toRelPosixWithinCwd(cwd, single);
          return [{ absPath, relPosix }];
        })()
      : await walkFiles(cwd, ig);

    if (files.length === 0) {
      // eslint-disable-next-line no-console
      console.log('没有需要上传的文件（全部被忽略或目录为空）。');
      return;
    }

    if (single) {
      const { absPath, relPosix } = files[0]!;
      if (ig.ignores(relPosix)) {
        // eslint-disable-next-line no-console
        console.log(`该文件被 .cfgignore 忽略：${relPosix}`);
        return;
      }

      const st = await fs.lstat(absPath);
      if (st.isSymbolicLink()) throw new Error('出于安全原因，拒绝同步符号链接文件。');
      if (!st.isFile()) throw new Error(`不是普通文件：${single}`);
    }

    if (options.dryRun) {
      // eslint-disable-next-line no-console
      console.log(`Remote Prefix: s3://${config.bucket}/${prefix}/`);
      for (const f of files) {
        // eslint-disable-next-line no-console
        console.log(`- ${f.relPosix}`);
      }
      // eslint-disable-next-line no-console
      console.log(`共 ${files.length} 个文件（dry-run）。`);
      return;
    }

    await mapLimit(files, 8, async (f) => {
      const relEncoded = encodeRelativePath(f.relPosix);
      const key = `${prefix}/${relEncoded}`;
      if (!validateRemoteKey(key)) throw new Error(`非法 key：${key}`);

      const ct = mime.lookup(f.relPosix) || 'application/octet-stream';
      await uploadFile(client, config.bucket, key, f.absPath, String(ct));
    });

    // eslint-disable-next-line no-console
    console.log(`同步成功：${files.length} 个文件 → s3://${config.bucket}/${prefix}/`);
  });

