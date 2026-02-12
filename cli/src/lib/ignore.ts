import fs from 'node:fs/promises';
import path from 'node:path';
import ignore, { Ignore } from 'ignore';

async function readIgnoreFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

export async function loadIgnore(cwd: string = process.cwd()): Promise<Ignore> {
  const ig = ignore();

  // 永久忽略（安全/性能）
  ig.add([
    '.git/',
    'node_modules/',
    'dist/',
    '.DS_Store',
  ]);

  const cfgIgnore = await readIgnoreFile(path.join(cwd, '.cfgignore'));
  if (cfgIgnore) ig.add(cfgIgnore);

  return ig;
}

