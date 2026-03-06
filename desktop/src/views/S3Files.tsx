import React, { useEffect, useMemo, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ApiClient } from '../lib/api';
import { buildTree, type TreeNode } from '../lib/tree';
import type { FileResponse, HostsResponse } from '../types';

function languageFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.toml')) return 'toml';
  if (lower.endsWith('.ini')) return 'ini';
  if (lower.endsWith('.env') || lower.endsWith('.env.local')) return 'bash';
  if (lower.endsWith('.sh') || lower.endsWith('.zshrc') || lower.endsWith('.bashrc')) return 'bash';
  if (lower.endsWith('.nginx') || lower.includes('nginx')) return 'nginx';
  return 'text';
}

type FileTreeProps = {
  root: TreeNode | null;
  activeKey: string | null;
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (key: string) => void;
  query: string;
  onQuery: (q: string) => void;
};
function FileTree({ root, activeKey, expanded, onToggleDir, onSelectFile, query, onQuery }: FileTreeProps) {
  const matches = (node: TreeNode): boolean => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (node.name.toLowerCase().includes(q)) return true;
    if (node.isDir && node.children) return node.children.some(matches);
    return false;
  };
  const renderNode = (node: TreeNode, depth: number) => {
    if (!matches(node)) return null;
    const pad = 8 + depth * 14;
    if (node.isDir) {
      const isOpen = expanded.has(node.path);
      return (
        <React.Fragment key={node.path || '__root'}>
          {node.path !== '' && (
            <div className="tree-row" style={{ paddingLeft: pad }} onClick={() => onToggleDir(node.path)} title={node.path}>
              <span className="mono muted" style={{ width: 18, textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</span>
              <span>📁</span>
              <span className="mono" style={{ fontSize: 12 }}>{node.name}</span>
            </div>
          )}
          {(node.path === '' || isOpen) && node.children?.map((c) => renderNode(c, node.path === '' ? depth : depth + 1))}
        </React.Fragment>
      );
    }
    const isActive = activeKey === node.key;
    return (
      <div key={node.path} className={`tree-row ${isActive ? 'tree-row-active' : ''}`} style={{ paddingLeft: pad }} onClick={() => node.key && onSelectFile(node.key)} title={node.key}>
        <span className="mono muted" style={{ width: 18, textAlign: 'center' }}> </span>
        <span>📄</span>
        <span className="mono" style={{ fontSize: 12 }}>{node.name}</span>
      </div>
    );
  };
  return (
    <div className="panel">
      <div className="panel-header"><div className="panel-title">文件</div></div>
      <div className="panel-body">
        <input className="search" placeholder="搜索文件名…" value={query} onChange={(e) => onQuery(e.target.value)} />
        <div style={{ height: 10 }} />
        <div className="tree">{root ? renderNode(root, 0) : <div className="muted">请选择左侧主机</div>}</div>
      </div>
    </div>
  );
}

type ViewerProps = {
  host: string | null;
  keyName: string | null;
  file: FileResponse | null;
  loading: boolean;
  error: string | null;
  onDownload: () => void;
  onCopyCli: () => void;
};
function Viewer({ host, keyName, file, loading, error, onDownload, onCopyCli }: ViewerProps) {
  const lang = keyName ? languageFromKey(keyName) : 'text';
  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">预览</div>
        <div className="badge">
          {host ? <span className="mono">{host}</span> : '—'}
          {keyName ? <> · <span className="mono">{keyName.split('/').slice(-2).join('/')}</span></> : null}
        </div>
      </div>
      <div className="panel-body">
        {!keyName && <div className="muted">选择一个文件以预览</div>}
        {loading && <div className="muted">加载中…</div>}
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        {file && (
          <div className="codebox">
            <div className="codebox-head">
              <div className="mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.key}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {file.truncated && <span className="pill">已截断</span>}
                <button className="btn" onClick={onCopyCli} title="复制 CLI 命令">复制CLI命令</button>
                <button className="btn btn-primary" onClick={onDownload}>下载</button>
              </div>
            </div>
            <div className="codebox-body">
              <SyntaxHighlighter language={lang} style={oneDark as { [key: string]: React.CSSProperties }} customStyle={{ margin: 0, background: 'transparent', fontSize: 12 }} showLineNumbers>
                {file.text}
              </SyntaxHighlighter>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type Props = { onError: (msg: string | null) => void };
export function S3Files({ onError }: Props) {
  const api = useMemo(() => new ApiClient(), []);
  const [hosts, setHosts] = useState<string[]>([]);
  const [activeHost, setActiveHost] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [hostQuery, setHostQuery] = useState('');
  const [fileQuery, setFileQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const filteredHosts = useMemo(() => {
    const q = hostQuery.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter((h) => h.toLowerCase().includes(q));
  }, [hosts, hostQuery]);
  const [file, setFile] = useState<FileResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadingHosts, setLoadingHosts] = useState(false);

  const refreshHosts = async () => {
    onError(null);
    setLoadingHosts(true);
    try {
      const h: HostsResponse = await api.hosts();
      setHosts(h.hosts);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingHosts(false);
    }
  };

  useEffect(() => {
    refreshHosts();
  }, []);

  const selectHost = async (host: string) => {
    setActiveHost(host);
    setTree(null);
    setExpanded(new Set());
    setActiveKey(null);
    setFile(null);
    setFileError(null);
    setFileQuery('');
    onError(null);
    try {
      const resp = await api.filesNormalized(host);
      setTree(buildTree(host, resp.objects));
      setExpanded(new Set(['']));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleDir = (p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  const selectFile = async (key: string) => {
    setActiveKey(key);
    setFile(null);
    setFileError(null);
    setFileLoading(true);
    try {
      const resp = await api.file(key);
      setFile(resp);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      setFileLoading(false);
    }
  };

  const downloadActive = async () => {
    if (!activeKey) return;
    try {
      await api.download(activeKey);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyCliForActive = async () => {
    if (!activeKey) return;
    const cmd = `hostsync pull --key ${JSON.stringify(activeKey)}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(cmd);
        onError(null);
        return;
      }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = cmd;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="content content-three">
      <div className="panel">
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="panel-title">主机</div>
          <button className="btn btn-primary" onClick={refreshHosts} disabled={loadingHosts} style={{ flexShrink: 0 }}>
            {loadingHosts ? '刷新中…' : '刷新'}
          </button>
        </div>
        <div className="panel-body">
          <input className="search" placeholder="搜索主机名…" value={hostQuery} onChange={(e) => setHostQuery(e.target.value)} style={{ marginBottom: 10 }} />
          <div className="list">
            {filteredHosts.map((h) => (
              <div key={h} className={`item ${activeHost === h ? 'item-active' : ''}`} onClick={() => selectHost(h)} title={h}>
                <span className="mono" style={{ fontSize: 12 }}>{h}</span>
              </div>
            ))}
            {hosts.length === 0 && !loadingHosts && <div className="muted">暂无主机或请先配置 S3</div>}
          </div>
        </div>
      </div>
      <FileTree root={tree} activeKey={activeKey} expanded={expanded} onToggleDir={toggleDir} onSelectFile={selectFile} query={fileQuery} onQuery={setFileQuery} />
      <Viewer host={activeHost} keyName={activeKey} file={file} loading={fileLoading} error={fileError} onDownload={downloadActive} onCopyCli={copyCliForActive} />
    </div>
  );
}
