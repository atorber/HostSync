import os from 'node:os';
import { Command } from 'commander';
import { loadConfig } from '../lib/config';
import {
  decodeRelativePath,
  getRemotePrefix,
  normalizeHostnameForKey,
  validateRemoteKey,
} from '../lib/pathMapper';
import { createS3Client, listAllObjects, type S3ObjectInfo } from '../lib/s3Client';

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function stripPrefix(key: string, prefix: string): string {
  if (key.startsWith(prefix)) return key.slice(prefix.length);
  return key;
}

export const listCommand = new Command('list')
  .alias('ls')
  .description('列出远端已同步的文件')
  .option('--host <hostname>', '查看指定主机（默认当前主机）')
  .option('--all', '列出所有主机的文件', false)
  .option('--hosts', '仅列出所有主机名', false)
  .option('-l, --long', '显示详细信息（大小、时间）', false)
  .action(
    async (options: {
      host?: string;
      all?: boolean;
      hosts?: boolean;
      long?: boolean;
    }) => {
      const config = await loadConfig();
      const client = createS3Client(config);

      // 模式 1：仅列主机名
      if (options.hosts) {
        const objs = await listAllObjects(client, config.bucket, '');
        const hostSet = new Set<string>();
        for (const o of objs) {
          const first = o.key.split('/')[0];
          if (first) hostSet.add(first);
        }
        const hosts = Array.from(hostSet).sort();
        if (hosts.length === 0) {
          // eslint-disable-next-line no-console
          console.log('远端没有任何主机数据。');
          return;
        }
        const current = normalizeHostnameForKey(os.hostname());
        for (const h of hosts) {
          // eslint-disable-next-line no-console
          console.log(h === current ? `* ${h}  (当前主机)` : `  ${h}`);
        }
        return;
      }

      // 模式 2：列出所有主机文件
      if (options.all) {
        const objs = await listAllObjects(client, config.bucket, '');
        printObjects(objs, '', options.long ?? false);
        return;
      }

      // 模式 3：列出指定/当前主机 + 当前目录前缀
      if (options.host) {
        const host = options.host.trim();
        const prefix = `${host}/`;
        const objs = await listAllObjects(client, config.bucket, prefix);
        printObjects(objs, prefix, options.long ?? false);
        return;
      }

      // 默认：当前主机 + 当前目录
      const prefix = getRemotePrefix(process.cwd());
      if (!validateRemoteKey(prefix)) {
        throw new Error(`路径校验失败：${prefix}`);
      }
      const fullPrefix = `${prefix}/`;
      const objs = await listAllObjects(client, config.bucket, fullPrefix);
      printObjects(objs, fullPrefix, options.long ?? false);
    },
  );

function printObjects(objs: S3ObjectInfo[], prefix: string, long: boolean): void {
  if (objs.length === 0) {
    // eslint-disable-next-line no-console
    console.log('远端没有找到任何文件。');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`共 ${objs.length} 个文件：\n`);

  for (const o of objs) {
    const display = prefix ? stripPrefix(o.key, prefix) : o.key;
    const decoded = decodeRelativePath(display);
    if (long) {
      const size = formatSize(o.size).padStart(10);
      const time = formatTime(o.lastModified).padEnd(20);
      // eslint-disable-next-line no-console
      console.log(`${size}  ${time}  ${decoded}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(decoded);
    }
  }
}
