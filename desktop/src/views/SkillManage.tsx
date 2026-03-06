import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { homeDir } from '@tauri-apps/api/path';

export type SkillEntry = {
  id: string;
  rootDir: string;
  dirPath: string;
  name: string;
  skillMdPath: string;
  updatedAt: number;
};

type TreeNode =
  | {
      type: 'dir';
      key: string;
      name: string;
      path: string;
      children: TreeNode[];
    }
  | {
      type: 'file';
      key: string;
      name: string;
      path: string;
      entry: SkillEntry;
    };

type ScanProgress = {
  dirsScanned: number;
  foundCount: number;
  currentPath: string;
};

type ScanComplete = {
  success: boolean;
  error?: string;
};

type Props = {
  onError: (msg: string | null) => void;
};

export function SkillManage({ onError }: Props) {
  const [list, setList] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const unlistenProgressRef = useRef<UnlistenFn | null>(null);
  const unlistenCompleteRef = useRef<UnlistenFn | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await invoke<SkillEntry[]>('skill_list');
      setList(data);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    return () => {
      unlistenProgressRef.current?.();
      unlistenCompleteRef.current?.();
    };
  }, []);

  const scanHome = async () => {
    setScanning(true);
    setProgress({ dirsScanned: 0, foundCount: 0, currentPath: '准备中…' });
    onError(null);

    unlistenProgressRef.current?.();
    unlistenCompleteRef.current?.();

    unlistenProgressRef.current = await listen<ScanProgress>('skill-scan-progress', (event) => {
      setProgress(event.payload);
    });

    unlistenCompleteRef.current = await listen<ScanComplete>('skill-scan-complete', (event) => {
      const { success, error } = event.payload;
      setScanning(false);
      setProgress(null);
      unlistenProgressRef.current?.();
      unlistenProgressRef.current = null;
      unlistenCompleteRef.current?.();
      unlistenCompleteRef.current = null;
      if (success) {
        load();
        onError(null);
      } else {
        onError(error ?? '扫描失败');
      }
    });

    try {
      const home = await homeDir();
      await invoke('skill_scan_roots', { roots: [home] });
    } catch (e) {
      setScanning(false);
      setProgress(null);
      unlistenProgressRef.current?.();
      unlistenCompleteRef.current?.();
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const openDrawer = async (path: string) => {
    setDrawerPath(path);
    setContentLoading(true);
    try {
      const text = await invoke<string>('skill_read_content', { path });
      setContent(text);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setContent('');
    } finally {
      setContentLoading(false);
    }
  };

  const closeDrawer = () => setDrawerPath(null);

  const saveContent = async () => {
    if (!drawerPath) return;
    setSaving(true);
    try {
      await invoke('skill_write_content', { path: drawerPath, content });
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const truncatePath = (p: string, maxLen = 60) => {
    if (p.length <= maxLen) return p;
    return '…' + p.slice(p.length - maxLen);
  };

  const tree = useMemo<TreeNode[]>(() => {
    const byRoot = new Map<string, SkillEntry[]>();
    for (const e of list) {
      const root = e.rootDir || '';
      const arr = byRoot.get(root) ?? [];
      arr.push(e);
      byRoot.set(root, arr);
    }

    const roots: TreeNode[] = [];
    const sortedRoots = Array.from(byRoot.keys()).sort((a, b) => a.localeCompare(b));
    for (const rootDir of sortedRoots) {
      const entries = (byRoot.get(rootDir) ?? []).slice().sort((a, b) => a.skillMdPath.localeCompare(b.skillMdPath));

      const rootNode: TreeNode = {
        type: 'dir',
        key: `root:${rootDir}`,
        name: rootDir || '(unknown root)',
        path: rootDir,
        children: [],
      };

      for (const e of entries) {
        const abs = e.skillMdPath.replace(/\\/g, '/');
        const rootPrefix = rootDir ? rootDir.replace(/\\/g, '/').replace(/\/+$/, '') + '/' : '';
        const rel = rootPrefix && abs.startsWith(rootPrefix) ? abs.slice(rootPrefix.length) : abs;
        const parts = rel.split('/').filter(Boolean);
        if (parts.length === 0) continue;

        let cursor = rootNode;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const isLast = i === parts.length - 1;
          const nextPath = (cursor.path ? cursor.path.replace(/\/+$/, '') + '/' : '') + part;
          if (isLast) {
            cursor.children.push({
              type: 'file',
              key: `file:${abs}`,
              name: part,
              path: abs,
              entry: e,
            });
          } else {
            let child = cursor.children.find((c) => c.type === 'dir' && c.name === part) as
              | Extract<TreeNode, { type: 'dir' }>
              | undefined;
            if (!child) {
              child = { type: 'dir', key: `dir:${nextPath}`, name: part, path: nextPath, children: [] };
              cursor.children.push(child);
            }
            cursor = child;
          }
        }
      }

      const sortChildren = (node: Extract<TreeNode, { type: 'dir' }>) => {
        node.children.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        for (const c of node.children) if (c.type === 'dir') sortChildren(c);
      };
      sortChildren(rootNode);
      roots.push(rootNode);
    }

    return roots;
  }, [list]);

  const isExpanded = (key: string, defaultOpen = false) => {
    const v = expanded[key];
    return v === undefined ? defaultOpen : v;
  };

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !isExpanded(key) }));
  };

  const renderNode = (node: TreeNode, level: number, defaultOpen: boolean): ReactNode => {
    if (node.type === 'file') {
      const active = drawerPath === node.path;
      return (
        <div
          key={node.key}
          className={`tree-row tree-file ${active ? 'tree-active' : ''}`}
          style={{ paddingLeft: 12 + level * 14 }}
          onClick={() => openDrawer(node.path)}
          title={node.path}
        >
          <span className="tree-icon mono muted">-</span>
          <span className="tree-name">{node.name}</span>
        </div>
      );
    }

    const open = isExpanded(node.key, defaultOpen);
    return (
      <div key={node.key}>
        <div
          className="tree-row tree-dir"
          style={{ paddingLeft: 12 + level * 14 }}
          onClick={() => toggleExpanded(node.key)}
          title={node.path}
        >
          <span className={`tree-icon mono muted ${open ? 'tree-caret-open' : ''}`}>{'>'}</span>
          <span className="tree-name" style={{ fontWeight: 600 }}>
            {node.name}
          </span>
          <span className="mono muted" style={{ marginLeft: 8, fontSize: 11 }}>
            {node.children.length}
          </span>
        </div>
        {open && (
          <div>
            {node.children.map((c) => renderNode(c, level + 1, false))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="content-single">
      <div className="panel flex-1">
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="panel-title">Skill 管理</div>
          <button className="btn btn-primary" onClick={scanHome} disabled={scanning}>
            {scanning ? '扫描中…' : '扫描用户目录'}
          </button>
        </div>

        {scanning && progress && (
          <div
            className="scan-progress-bar"
            style={{
              padding: '8px 16px',
              fontSize: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <span className="scanning-dot" />
              <span>
                已扫描 <strong>{progress.dirsScanned}</strong> 个目录，发现{' '}
                <strong>{progress.foundCount}</strong> 个 Skill 文件
              </span>
            </div>
            {progress.currentPath && (
              <div className="mono muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {truncatePath(progress.currentPath)}
              </div>
            )}
          </div>
        )}

        <div className="panel-body">
          {loading && !scanning && <div className="muted">加载中…</div>}
          {!loading && !scanning && list.length === 0 && (
            <div className="muted">暂无 Skill，点击「扫描用户目录」自动发现包含 skill 关键字的目录及文件</div>
          )}
          {!loading && list.length > 0 && <div className="tree">{tree.map((n) => renderNode(n, 0, true))}</div>}
        </div>
      </div>

      {drawerPath && (
        <div className="drawer-backdrop" onClick={closeDrawer}>
          <div className="drawer drawer-wide" onClick={(ev) => ev.stopPropagation()}>
            <div className="panel-header" style={{ justifyContent: 'space-between' }}>
              <div className="panel-title mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {drawerPath?.split('/').pop() ?? 'skill.md'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={saveContent} disabled={saving}>
                  {saving ? '保存中…' : '保存'}
                </button>
                <button className="btn" onClick={closeDrawer}>
                  关闭
                </button>
              </div>
            </div>
            <div className="panel-body" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {contentLoading && <div className="muted">加载中…</div>}
              {!contentLoading && (
                <textarea
                  className="search mono"
                  style={{ flex: 1, minHeight: 300, resize: 'none' }}
                  value={content}
                  onChange={(ev) => setContent(ev.target.value)}
                  spellCheck={false}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
