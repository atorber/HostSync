import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

type RemoteObject = {
  key: string;
  size?: number;
  lastModified?: string;
};

type SyncResult = {
  absPath: string;
  s3Key: string;
  ok: boolean;
  error?: string;
};

function langFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.toml')) return 'toml';
  if (lower.endsWith('.md')) return 'markdown';
  return 'text';
}

function extractDirs(objects: RemoteObject[], hostPrefix: string): string[] {
  const prefix = `configs/${hostPrefix}/`;
  const dirSet = new Set<string>();
  for (const o of objects) {
    if (!o.key.startsWith(prefix)) continue;
    const rel = o.key.slice(prefix.length);
    const parts = rel.split('/');
    let cur = '';
    for (let i = 0; i < parts.length - 1; i++) {
      cur = cur ? `${cur}/${parts[i]}` : parts[i];
      dirSet.add(cur);
    }
  }
  const dirs = Array.from(dirSet);
  dirs.sort();
  return dirs;
}

type Props = { onError: (msg: string | null) => void };

export function HostManage({ onError }: Props) {
  const [localHost, setLocalHost] = useState('');
  const [hosts, setHosts] = useState<string[]>([]);
  const [hostsLoading, setHostsLoading] = useState(false);

  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const [objects, setObjects] = useState<RemoteObject[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);

  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [pullBusy, setPullBusy] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>('get_hostname').then(setLocalHost).catch(() => {});
  }, []);

  const loadHosts = async () => {
    setHostsLoading(true);
    try {
      await invoke('init_s3');
      const h = await invoke<string[]>('config_remote_hosts');
      setHosts(h);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setHostsLoading(false);
    }
  };

  useEffect(() => { loadHosts(); }, []);

  const selectHost = async (host: string) => {
    setSelectedHost(host);
    setSelectedDir(null);
    setSelectedFile(null);
    setPreview(null);
    setPullMsg(null);
    setObjectsLoading(true);
    try {
      const objs = await invoke<RemoteObject[]>('config_remote_objects', { host });
      setObjects(objs);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setObjectsLoading(false);
    }
  };

  const dirs = useMemo(
    () => (selectedHost ? extractDirs(objects, selectedHost) : []),
    [objects, selectedHost],
  );

  const files = useMemo(() => {
    if (!selectedHost) return [];
    const prefix = `configs/${selectedHost}/`;
    return objects
      .filter((o) => o.key.startsWith(prefix))
      .map((o) => ({ ...o, rel: o.key.slice(prefix.length) }));
  }, [objects, selectedHost]);

  const filteredFiles = useMemo(() => {
    if (!selectedDir) return files;
    return files.filter((f) => f.rel.startsWith(selectedDir + '/'));
  }, [files, selectedDir]);

  const selectFile = async (key: string) => {
    setSelectedFile(key);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const resp = await invoke<{ key: string; text: string; truncated: boolean }>('file_content', { key });
      setPreview(resp.text);
    } catch (e) {
      setPreview(`[无法预览] ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  // 按目录拉取
  const pullDir = async () => {
    if (!selectedHost || !selectedDir) return;
    const localDir = await open({ directory: true, title: '选择本地目标文件夹' });
    if (!localDir || Array.isArray(localDir)) return;
    setPullBusy(true);
    setPullMsg(null);
    try {
      const prefix = `configs/${selectedHost}/${selectedDir}/`;
      const keys = objects.filter((o) => o.key.startsWith(prefix)).map((o) => o.key);
      if (keys.length === 0) { setPullMsg('该目录下没有文件'); return; }
      const results = await invoke<SyncResult[]>('config_pull_remote_dir', {
        keys,
        stripPrefix: prefix,
        localDir,
      });
      const ok = results.filter((r) => r.ok).length;
      const fail = results.filter((r) => !r.ok).length;
      setPullMsg(`拉取完成：${ok} 成功${fail > 0 ? `，${fail} 失败` : ''}`);
      if (fail > 0) {
        onError(results.filter((r) => !r.ok).map((r) => `${r.absPath}: ${r.error}`).join('\n'));
      } else {
        onError(null);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPullBusy(false);
    }
  };

  // 按文件拉取
  const pullFile = async () => {
    if (!selectedFile) return;
    const fileName = selectedFile.split('/').pop() ?? 'download';
    const localPath = await save({ title: '保存到本地', defaultPath: fileName });
    if (!localPath) return;
    setPullBusy(true);
    setPullMsg(null);
    try {
      const result = await invoke<SyncResult>('config_pull_remote_file', { key: selectedFile, localPath });
      if (result.ok) {
        setPullMsg(`已保存 → ${result.absPath}`);
        onError(null);
      } else {
        onError(result.error ?? '拉取失败');
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPullBusy(false);
    }
  };

  return (
    <div className="content content-three">
      {/* 左栏: 主机列表 */}
      <div className="panel">
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="panel-title">主机</div>
          <button className="btn btn-primary" onClick={loadHosts} disabled={hostsLoading} style={{ flexShrink: 0 }}>
            {hostsLoading ? '刷新中…' : '刷新'}
          </button>
        </div>
        <div className="panel-body">
          {hostsLoading && <div className="muted">加载中…</div>}
          {!hostsLoading && hosts.length === 0 && <div className="muted">暂无主机，先在「配置管理」中推送配置</div>}
          <div className="list">
            {hosts.map((h) => (
              <div
                key={h}
                className={`item ${selectedHost === h ? 'item-active' : ''}`}
                onClick={() => selectHost(h)}
              >
                <span className="mono" style={{ fontSize: 12 }}>{h}</span>
                {h === localHost && <span className="pill" style={{ marginLeft: 6 }}>本机</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 中栏: 目录 + 文件 */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            {selectedHost ? `configs/${selectedHost}/` : '请选择主机'}
          </div>
        </div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }}>
          {objectsLoading && <div className="muted">加载中…</div>}
          {!objectsLoading && selectedHost && (
            <>
              {/* 目录 */}
              {dirs.length > 0 && (
                <div>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>目录</div>
                  <div className="list" style={{ maxHeight: 160, overflow: 'auto' }}>
                    {dirs.map((d) => (
                      <div
                        key={d}
                        className={`item ${selectedDir === d ? 'item-active' : ''}`}
                        onClick={() => { setSelectedDir(d); setSelectedFile(null); setPreview(null); }}
                        style={{ cursor: 'pointer' }}
                      >
                        <span style={{ marginRight: 6 }}>📁</span>
                        <span className="mono" style={{ fontSize: 11 }}>{d}</span>
                      </div>
                    ))}
                  </div>
                  {selectedDir && (
                    <button
                      className="btn btn-primary"
                      style={{ marginTop: 6, width: '100%' }}
                      onClick={pullDir}
                      disabled={pullBusy}
                    >
                      {pullBusy ? '拉取中…' : `拉取目录到本地文件夹`}
                    </button>
                  )}
                </div>
              )}
              {/* 文件 */}
              <div style={{ flex: 1, minHeight: 0 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                  文件{selectedDir ? ` (${selectedDir}/)` : ''}
                </div>
                <div className="list" style={{ maxHeight: 280, overflow: 'auto' }}>
                  {filteredFiles.map((f) => (
                    <div
                      key={f.key}
                      className={`item ${selectedFile === f.key ? 'item-active' : ''}`}
                      onClick={() => selectFile(f.key)}
                      style={{ cursor: 'pointer' }}
                    >
                      <span style={{ marginRight: 6 }}>📄</span>
                      <span className="mono" style={{ fontSize: 11 }}>{f.rel}</span>
                      {f.size != null && (
                        <span className="muted" style={{ fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>
                          {f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(1)}KB`}
                        </span>
                      )}
                    </div>
                  ))}
                  {filteredFiles.length === 0 && <div className="muted">无文件</div>}
                </div>
                {selectedFile && (
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 6, width: '100%' }}
                    onClick={pullFile}
                    disabled={pullBusy}
                  >
                    {pullBusy ? '拉取中…' : '拉取文件到本地'}
                  </button>
                )}
              </div>
              {pullMsg && <div className="muted" style={{ fontSize: 12 }}>{pullMsg}</div>}
            </>
          )}
          {!selectedHost && !objectsLoading && <div className="muted">选择左侧主机以浏览云端配置</div>}
        </div>
      </div>

      {/* 右栏: 预览 */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">预览</div>
          {selectedFile && (
            <div className="badge">
              <span className="mono" style={{ fontSize: 11 }}>{selectedFile.split('/').slice(-2).join('/')}</span>
            </div>
          )}
        </div>
        <div className="panel-body">
          {!selectedFile && <div className="muted">选择一个文件以预览</div>}
          {previewLoading && <div className="muted">加载中…</div>}
          {preview !== null && !previewLoading && (
            <div className="codebox">
              <div className="codebox-body">
                <SyntaxHighlighter
                  language={selectedFile ? langFromKey(selectedFile) : 'text'}
                  style={oneDark as { [key: string]: CSSProperties }}
                  customStyle={{ margin: 0, background: 'transparent', fontSize: 12 }}
                  showLineNumbers
                >
                  {preview}
                </SyntaxHighlighter>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
