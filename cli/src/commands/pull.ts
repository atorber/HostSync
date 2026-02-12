import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { loadConfig } from '../lib/config';
import { loadIgnore } from '../lib/ignore';
import { decodeRelativePath, getRemotePrefix, validateRemoteKey } from '../lib/pathMapper';
import { createS3Client, downloadFile, listAllObjects } from '../lib/s3Client';

function ensureInsideCwd(cwd: string, targetAbsPath: string): void {
  const resolvedCwd = path.resolve(cwd);
  const resolvedTarget = path.resolve(targetAbsPath);
  const prefix = resolvedCwd.endsWith(path.sep) ? resolvedCwd : resolvedCwd + path.sep;
  if (!resolvedTarget.startsWith(prefix) && resolvedTarget !== resolvedCwd) {
    throw new Error(`拒绝写入工作目录之外：${resolvedTarget}`);
  }
}

export const pullCommand = new Command('pull')
  .description('从 S3 拉取当前目录对应前缀的文件')
  .option('--dry-run', '仅打印将要下载的文件，不实际写入', false)
  .action(async (options: { dryRun?: boolean }) => {
    const cwd = process.cwd();
    const config = await loadConfig();
    const client = createS3Client(config);

    const prefix = getRemotePrefix(cwd);
    if (!validateRemoteKey(prefix)) throw new Error(`路径校验失败：${prefix}`);

    const ig = await loadIgnore(cwd);
    const objects = await listAllObjects(client, config.bucket, `${prefix}/`);

    if (objects.length === 0) {
      // eslint-disable-next-line no-console
      console.log('远端没有找到任何对象。');
      return;
    }

    const toDownload = objects
      .map((o) => o.key)
      .filter((k) => k.startsWith(`${prefix}/`))
      .map((k) => k.slice(`${prefix}/`.length))
      .filter((rel) => rel.length > 0);

    if (toDownload.length === 0) {
      // eslint-disable-next-line no-console
      console.log('远端没有可下载的文件。');
      return;
    }

    if (options.dryRun) {
      // eslint-disable-next-line no-console
      console.log(`Remote Prefix: s3://${config.bucket}/${prefix}/`);
      for (const relEnc of toDownload) {
        // eslint-disable-next-line no-console
        console.log(`- ${decodeRelativePath(relEnc)}`);
      }
      // eslint-disable-next-line no-console
      console.log(`共 ${toDownload.length} 个文件（dry-run）。`);
      return;
    }

    for (const relEnc of toDownload) {
      const rel = decodeRelativePath(relEnc);
      const relPosix = rel.split(path.sep).join('/'); // 保险：ignore 用 posix
      if (ig.ignores(relPosix)) continue;

      const localAbs = path.join(cwd, rel);
      ensureInsideCwd(cwd, localAbs);

      await fs.mkdir(path.dirname(localAbs), { recursive: true });
      const key = `${prefix}/${relEnc}`;
      if (!validateRemoteKey(key)) throw new Error(`非法 key：${key}`);
      await downloadFile(client, config.bucket, key, localAbs);
    }

    // eslint-disable-next-line no-console
    console.log(`拉取完成：${toDownload.length} 个文件 ← s3://${config.bucket}/${prefix}/`);
  });

