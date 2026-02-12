import { Command } from 'commander';
import mime from 'mime-types';
import { loadConfig } from '../lib/config';
import { loadIgnore } from '../lib/ignore';
import { encodeRelativePath, getRemotePrefix, validateRemoteKey } from '../lib/pathMapper';
import { createS3Client, uploadFile } from '../lib/s3Client';
import { walkFiles } from '../lib/walk';

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
  .description('上传当前目录文件到 S3（按 hostname + 绝对路径分层）')
  .option('--dry-run', '仅打印将要上传的文件，不实际上传', false)
  .action(async (options: { dryRun?: boolean }) => {
    const cwd = process.cwd();
    const config = await loadConfig();
    const client = createS3Client(config);

    const prefix = getRemotePrefix(cwd);
    if (!validateRemoteKey(prefix)) {
      throw new Error(`路径校验失败：${prefix}`);
    }

    const ig = await loadIgnore(cwd);
    const files = await walkFiles(cwd, ig);

    if (files.length === 0) {
      // eslint-disable-next-line no-console
      console.log('没有需要上传的文件（全部被忽略或目录为空）。');
      return;
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

