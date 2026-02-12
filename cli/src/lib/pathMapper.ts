import os from 'node:os';
import path from 'node:path';

export function normalizeHostnameForKey(hostname: string): string {
  return hostname
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeAbsolutePathToPosixNoLeadingSlash(absPath: string): string {
  const resolved = path.resolve(absPath);

  // Windows: C:\Users\me\proj -> c/Users/me/proj
  if (process.platform === 'win32') {
    const p = resolved.replace(/\\/g, '/');
    const m = /^([a-zA-Z]):\/(.*)$/.exec(p);
    if (m) return `${m[1].toLowerCase()}/${m[2]}`.replace(/\/+/g, '/');
    return p.replace(/^\/+/, '').replace(/\/+/g, '/');
  }

  // POSIX: /Users/me/proj -> Users/me/proj
  return resolved.replace(/\/+/g, '/').replace(/^\/+/, '');
}

function encodeKeyPath(p: string): string {
  // 保留 / 分隔符；对每个段做 encode，避免空格等字符带来的兼容性问题
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export function getRemotePrefix(cwd: string = process.cwd()): string {
  const hostname = normalizeHostnameForKey(os.hostname());
  const normalizedPath = normalizeAbsolutePathToPosixNoLeadingSlash(cwd);
  return `${hostname}/${encodeKeyPath(normalizedPath)}`;
}

export function validateRemoteKey(remoteKey: string): boolean {
  if (!remoteKey) return false;
  if (remoteKey.includes('\\')) return false;
  if (remoteKey.startsWith('/')) return false;
  if (remoteKey.includes('\0')) return false;

  const parts = remoteKey.split('/');
  if (parts.some((p) => p === '..')) return false;

  // 允许常见 key 字符 + percent-encoding
  return /^[A-Za-z0-9._~%\-\/]+$/.test(remoteKey);
}

export function encodeRelativePath(relPosix: string): string {
  return encodeKeyPath(relPosix);
}

export function decodeRelativePath(encodedRelPosix: string): string {
  return encodedRelPosix
    .split('/')
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join('/');
}

