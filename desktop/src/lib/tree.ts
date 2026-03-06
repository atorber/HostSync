import type { S3ObjectInfo } from '../types';

export type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  key?: string;
  children?: TreeNode[];
};

export function buildTree(host: string, objects: S3ObjectInfo[]): TreeNode {
  const root: TreeNode = { name: host, path: '', isDir: true, children: [] };
  const byPath = new Map<string, TreeNode>();
  byPath.set('', root);

  for (const o of objects) {
    const key = o.key;
    const prefix = `${host}/`;
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    if (!rest) continue;

    const parts = rest.split('/').filter(Boolean);
    let curPath = '';
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const nextPath = curPath ? `${curPath}/${name}` : name;
      const isLast = i === parts.length - 1;
      const isDir = !isLast;

      if (!byPath.has(nextPath)) {
        const node: TreeNode = {
          name,
          path: nextPath,
          isDir,
          children: isDir ? [] : undefined,
          key: isDir ? undefined : key,
        };
        byPath.set(nextPath, node);

        const parent = byPath.get(curPath);
        if (parent?.children) parent.children.push(node);
      } else if (isLast) {
        const node = byPath.get(nextPath)!;
        node.isDir = false;
        node.key = key;
        node.children = undefined;
      }

      curPath = nextPath;
    }
  }

  sortTree(root);
  return root;
}

function sortTree(node: TreeNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) sortTree(c);
}
