import type { CSSProperties } from 'react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

export type ScannedConfigFile = {
  tool: string;
  scope: string;
  relPath: string;
  absPath: string;
  size: number;
  mtime: number;
};

type SyncResult = {
  absPath: string;
  s3Key: string;
  ok: boolean;
  error?: string;
};

function langFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.toml')) return 'toml';
  if (lower.endsWith('.md')) return 'markdown';
  return 'text';
}

type Props = {
  onError: (msg: string | null) => void;
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
      file: ScannedConfigFile;
    };

export function ConfigManage({ onError }: Props) {
  const [list, setList] = useState<ScannedConfigFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerFile, setDrawerFile] = useState<ScannedConfigFile | null>(null);
  const [content, setContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editable, setEditable] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [hostPrefix, setHostPrefix] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    invoke<string>('get_hostname').then(setHostPrefix).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<ScannedConfigFile[]>('config_scan_all', { projectRoot: null })
      .then((data) => {
        if (!cancelled) {
          setList(data);
          onError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          onError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scanProject = async () => {
    const selected = await open({ directory: true });
    if (!selected || Array.isArray(selected)) return;
    setLoading(true);
    setSyncMsg(null);
    try {
      const data = await invoke<ScannedConfigFile[]>('config_scan_all', { projectRoot: selected });
      setList(data);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const scanHome = async () => {
    setLoading(true);
    setSyncMsg(null);
    try {
      const data = await invoke<ScannedConfigFile[]>('config_scan_all', { projectRoot: null });
      setList(data);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const openDrawer = async (file: ScannedConfigFile) => {
    setDrawerFile(file);
    setContentLoading(true);
    setEditable(false);
    try {
      const text = await invoke<string>('config_read_file', { absPath: file.absPath });
      setContent(text);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setContent('');
    } finally {
      setContentLoading(false);
    }
  };

  const closeDrawer = () => setDrawerFile(null);

  const saveContent = async () => {
    if (!drawerFile) return;
    setSaving(true);
    try {
      await invoke('config_write_file', { absPath: drawerFile.absPath, content });
      onError(null);
      setEditable(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const pushAll = async () => {
    if (list.length === 0) return;
    setPushing(true);
    setSyncMsg(null);
    try {
      await invoke('init_s3');
      const results = await invoke<SyncResult[]>('config_push_files', {
        absPaths: list.map((f) => f.absPath),
      });
      const ok = results.filter((r) => r.ok).length;
      const fail = results.filter((r) => !r.ok).length;
      setSyncMsg(`推送完成：${ok} 成功${fail > 0 ? `，${fail} 失败` : ''}`);
      if (fail > 0) {
        onError(results.filter((r) => !r.ok).map((r) => `${r.absPath}: ${r.error}`).join('\n'));
      } else {
        onError(null);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
    }
  };

  const pushSingle = async (absPath: string) => {
    setPushing(true);
    setSyncMsg(null);
    try {
      await invoke('init_s3');
      const results = await invoke<SyncResult[]>('config_push_files', { absPaths: [absPath] });
      const r = results[0];
      if (r?.ok) {
        setSyncMsg(`已推送 → ${r.s3Key}`);
        onError(null);
      } else {
        onError(r?.error ?? '推送失败');
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
    }
  };

  const pullSingle = async (absPath: string) => {
    setPulling(true);
    setSyncMsg(null);
    try {
      await invoke('init_s3');
      const results = await invoke<SyncResult[]>('config_pull_files', { absPaths: [absPath] });
      const r = results[0];
      if (r?.ok) {
        setSyncMsg(`已拉取 ← ${r.s3Key}`);
        onError(null);
        if (drawerFile?.absPath === absPath) {
          const text = await invoke<string>('config_read_file', { absPath });
          setContent(text);
        }
      } else {
        onError(r?.error ?? '拉取失败');
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  };

  const tree = useMemo<TreeNode[]>(() => {
    const byTool = new Map<string, ScannedConfigFile[]>();
    for (const f of list) {
      const key = f.tool || 'Unknown';
      const arr = byTool.get(key) ?? [];
      arr.push(f);
      byTool.set(key, arr);
    }

    const roots: TreeNode[] = [];
    const tools = Array.from(byTool.keys()).sort((a, b) => a.localeCompare(b));
    for (const tool of tools) {
      const toolNode: Extract<TreeNode, { type: 'dir' }> = {
        type: 'dir',
        key: `tool:${tool}`,
        name: tool,
        path: tool,
        children: [],
      };

      const files = (byTool.get(tool) ?? []).slice().sort((a, b) => a.relPath.localeCompare(b.relPath));
      for (const f of files) {
        const rel = (f.relPath || f.absPath).replace(/\\/g, '/');
        const parts = rel.split('/').filter(Boolean);
        if (parts.length === 0) continue;

        let cursor = toolNode;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const isLast = i === parts.length - 1;
          const nextPath = cursor.path === tool ? part : `${cursor.path}/${part}`;
          if (isLast) {
            cursor.children.push({
              type: 'file',
              key: `file:${f.absPath}`,
              name: part,
              path: f.absPath,
              file: f,
            });
          } else {
            let child = cursor.children.find((c) => c.type === 'dir' && c.name === part) as
              | Extract<TreeNode, { type: 'dir' }>
              | undefined;
            if (!child) {
              child = { type: 'dir', key: `dir:${tool}:${nextPath}`, name: part, path: nextPath, children: [] };
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
      sortChildren(toolNode);
      roots.push(toolNode);
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
      const active = drawerFile?.absPath === node.file.absPath;
      return (
        <div
          key={node.key}
          className={`tree-row tree-file ${active ? 'tree-active' : ''}`}
          style={{ paddingLeft: 12 + level * 14, justifyContent: 'space-between' }}
          onClick={() => openDrawer(node.file)}
          title={node.file.absPath}
        >
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
            <span className="tree-icon mono muted">-</span>
            <span className="tree-name">{node.name}</span>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(ev) => ev.stopPropagation()}>
            <button className="btn" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => pullSingle(node.file.absPath)} disabled={pulling}>
              拉取
            </button>
            <button className="btn" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => pushSingle(node.file.absPath)} disabled={pushing}>
              推送
            </button>
          </div>
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
        {open && <div>{node.children.map((c) => renderNode(c, level + 1, false))}</div>}
      </div>
    );
  };

  return (
    <div className="content-single">
      <div className="panel flex-1">
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="panel-title">配置管理</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {hostPrefix && <span className="muted" style={{ fontSize: 11 }}>本机：{hostPrefix}</span>}
            {list.length > 0 && (
              <button className="btn" onClick={pushAll} disabled={pushing}>
                {pushing ? '推送中…' : '全部推送'}
              </button>
            )}
            <button className="btn" onClick={scanHome} disabled={loading}>
              {loading ? '扫描中…' : '扫描主目录'}
            </button>
            <button className="btn btn-primary" onClick={scanProject} disabled={loading}>
              {loading ? '扫描中…' : '选择项目目录扫描'}
            </button>
          </div>
        </div>
        <div className="panel-body">
          {syncMsg && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{syncMsg}</div>
          )}
          {list.length === 0 && !loading && (
            <div className="muted">点击「选择项目目录扫描」或「扫描主目录」发现 Claude Code、Cursor、Codex 等配置文件</div>
          )}
          {list.length > 0 && (
            <div className="tree">{tree.map((n) => renderNode(n, 0, true))}</div>
          )}
        </div>
      </div>

      {drawerFile && (
        <div className="drawer-backdrop" onClick={closeDrawer}>
          <div className="drawer drawer-wide" onClick={(ev) => ev.stopPropagation()}>
            <div className="panel-header" style={{ justifyContent: 'space-between' }}>
              <div className="panel-title mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {drawerFile.relPath}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => pullSingle(drawerFile.absPath)} disabled={pulling}>
                  {pulling ? '拉取中…' : '从云端拉取'}
                </button>
                <button className="btn" onClick={() => pushSingle(drawerFile.absPath)} disabled={pushing}>
                  {pushing ? '推送中…' : '推送到云端'}
                </button>
                {!editable ? (
                  <button className="btn" onClick={() => setEditable(true)}>编辑</button>
                ) : (
                  <>
                    <button className="btn btn-primary" onClick={saveContent} disabled={saving}>
                      {saving ? '保存中…' : '保存'}
                    </button>
                    <button className="btn" onClick={() => setEditable(false)}>取消编辑</button>
                  </>
                )}
                <button className="btn" onClick={closeDrawer}>关闭</button>
              </div>
            </div>
            <div className="panel-body" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {contentLoading && <div className="muted">加载中…</div>}
              {!contentLoading && editable && (
                <textarea
                  className="search mono"
                  style={{ width: '100%', minHeight: 400, resize: 'vertical' }}
                  value={content}
                  onChange={(ev) => setContent(ev.target.value)}
                  spellCheck={false}
                />
              )}
              {!contentLoading && !editable && (
                <SyntaxHighlighter
                  language={langFromPath(drawerFile.relPath)}
                  style={oneDark as { [key: string]: CSSProperties }}
                  customStyle={{ margin: 0, background: 'transparent', fontSize: 12 }}
                  showLineNumbers
                >
                  {content}
                </SyntaxHighlighter>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
