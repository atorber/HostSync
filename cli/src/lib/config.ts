import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type HostSyncConfig = {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
  /**
   * 是否使用 path-style 访问方式（bucket 在路径中）：
   * - true:  https://endpoint/bucket/key
   * - false: https://bucket.endpoint/key
   *
   * 多数 S3 兼容对象存储更推荐/更兼容 path-style（默认 true）。
   */
  forcePathStyle?: boolean;
};

export function getConfigDir(): string {
  const home = os.homedir();

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    return path.join(appData ?? home, 'hostsync');
  }

  return path.join(home, '.config', 'hostsync');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export async function loadConfig(): Promise<HostSyncConfig> {
  const configPath = getConfigPath();
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw) as HostSyncConfig;

  if (!parsed?.endpoint || !parsed?.accessKey || !parsed?.secretKey || !parsed?.bucket) {
    throw new Error(`配置不完整：${configPath}`);
  }

  return parsed;
}

export async function saveConfig(config: HostSyncConfig): Promise<void> {
  const dir = getConfigDir();
  const configPath = getConfigPath();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8' });

  // 尽量保证权限为 600（Windows 上不支持则忽略）
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(configPath, 0o600);
    } catch {
      // ignore
    }
  }
}

