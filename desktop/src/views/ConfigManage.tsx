import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
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
            <div className="list">
              {list.map((f, i) => (
                <div
                  key={`${f.absPath}-${i}`}
                  className={`item ${drawerFile?.absPath === f.absPath ? 'item-active' : ''}`}
                  onClick={() => openDrawer(f)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div style={{ minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ fontWeight: 600 }}>{f.tool}</span>
                    <span className="mono muted" style={{ fontSize: 11, marginLeft: 8 }}>{f.relPath}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(ev) => ev.stopPropagation()}>
                    <button className="btn" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => pullSingle(f.absPath)} disabled={pulling}>拉取</button>
                    <button className="btn" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => pushSingle(f.absPath)} disabled={pushing}>推送</button>
                  </div>
                </div>
              ))}
            </div>
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
