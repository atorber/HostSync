import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { loadConfig } from '../lib/config';
import { loadIgnore } from '../lib/ignore';
import { decodeRelativePath, encodeRelativePath, getRemotePrefix, validateRemoteKey } from '../lib/pathMapper';
import { createS3Client, downloadFile, listAllObjects } from '../lib/s3Client';

function ensureInsideCwd(cwd: string, targetAbsPath: string): void {
  const resolvedCwd = path.resolve(cwd);
  const resolvedTarget = path.resolve(targetAbsPath);
  const prefix = resolvedCwd.endsWith(path.sep) ? resolvedCwd : resolvedCwd + path.sep;
  if (!resolvedTarget.startsWith(prefix) && resolvedTarget !== resolvedCwd) {
    throw new Error(`拒绝写入工作目录之外：${resolvedTarget}`);
  }
}

function toRelWithinCwd(cwd: string, inputPath: string): { relOs: string; relPosix: string; absPath: string } {
  const absPath = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(cwd, inputPath);
  const relOs = path.relative(cwd, absPath);
  if (!relOs || relOs === '.') throw new Error('请指定一个文件路径（不能是目录本身）。');
  if (relOs.startsWith('..' + path.sep) || relOs === '..') throw new Error(`仅允许拉取到当前目录内：${inputPath}`);
  const relPosix = relOs.split(path.sep).join('/');
  return { relOs, relPosix, absPath };
}

export const pullCommand = new Command('pull')
  .description('从 S3 拉取文件（按 hostname + 绝对路径分层）')
  .argument('[file]', '仅同步单个文件（相对当前目录或绝对路径；会写回到当前目录内对应位置）')
  .option('-f, --file <file>', '仅同步单个文件（同 [file]）')
  .option('--dry-run', '仅打印将要下载的文件，不实际写入', false)
  .action(async (fileArg: string | undefined, options: { dryRun?: boolean; file?: string }) => {
    const cwd = process.cwd();
    const config = await loadConfig();
    const client = createS3Client(config);

    const prefix = getRemotePrefix(cwd);
    if (!validateRemoteKey(prefix)) throw new Error(`路径校验失败：${prefix}`);

    const ig = await loadIgnore(cwd);
    const single = (options.file ?? fileArg)?.trim();

    if (single) {
      const { relOs, relPosix, absPath } = toRelWithinCwd(cwd, single);
      if (ig.ignores(relPosix)) {
        // eslint-disable-next-line no-console
        console.log(`该文件被 .cfgignore 忽略：${relPosix}`);
        return;
      }

      const relEnc = encodeRelativePath(relPosix);
      const key = `${prefix}/${relEnc}`;
      if (!validateRemoteKey(key)) throw new Error(`非法 key：${key}`);

      if (options.dryRun) {
        // eslint-disable-next-line no-console
        console.log(`将下载：s3://${config.bucket}/${key} → ${relOs}`);
        return;
      }

      ensureInsideCwd(cwd, absPath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await downloadFile(client, config.bucket, key, absPath);

      // eslint-disable-next-line no-console
      console.log(`拉取完成：1 个文件 ← s3://${config.bucket}/${prefix}/`);
      return;
    }

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

