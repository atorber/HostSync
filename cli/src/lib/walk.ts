import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ignore } from 'ignore';

function toPosixRelative(fromDir: string, fullPath: string): string {
  const rel = path.relative(fromDir, fullPath);
  return rel.split(path.sep).join('/'); // ignore 库使用 posix 风格
}

export async function walkFiles(
  cwd: string,
  ig: Ignore,
): Promise<{ absPath: string; relPosix: string }[]> {
  const out: { absPath: string; relPosix: string }[] = [];

  async function visit(dirAbs: string): Promise<void> {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    for (const ent of entries) {
      const absPath = path.join(dirAbs, ent.name);
      const relPosix = toPosixRelative(cwd, absPath);

      // walk 根本身不返回空 rel
      if (!relPosix || relPosix === '.') continue;

      // 先判断忽略
      if (ig.ignores(relPosix)) continue;

      // 跳过符号链接（避免意外写入/读取任意位置）
      const lst = await fs.lstat(absPath);
      if (lst.isSymbolicLink()) continue;

      if (ent.isDirectory()) {
        await visit(absPath);
        continue;
      }

      if (ent.isFile()) out.push({ absPath, relPosix });
    }
  }

  await visit(cwd);
  return out;
}

