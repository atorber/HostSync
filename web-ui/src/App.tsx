import React, { useEffect, useMemo, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ApiClient } from './lib/api';
import { buildTree, type TreeNode } from './lib/tree';
import type { FileResponse, FilesResponse, HostsResponse } from './types';

const TOKEN_KEY = 'hostsync.token';

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

function formatTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

type TokenModalProps = {
  open: boolean;
  onSubmit: (token: string) => void;
};

function TokenModal({ open, onSubmit }: TokenModalProps) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div className="panel-title">输入临时 Token</div>
        </div>
        <div className="modal-body">
          <div className="help">
            在终端执行 <span className="mono">hostsync web</span> 后，会输出一个 5 分钟有效的 Token。
            该 Token 仅用于访问本机绑定的 Web UI API。
          </div>
          <input
            className="search mono"
            placeholder="Token"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit(value.trim());
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={() => onSubmit(value.trim())} disabled={!value.trim()}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type HostListProps = {
  hosts: string[];
  active: string | null;
  onSelect: (host: string) => void;
};

function HostList({ hosts, active, onSelect }: HostListProps) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return hosts;
    return hosts.filter((h) => h.toLowerCase().includes(qq));
  }, [hosts, q]);

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">主机</div>
      </div>
      <div className="panel-body">
        <input className="search" placeholder="搜索主机名…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ height: 10 }} />
        <div className="list">
          {filtered.map((h) => (
            <div
              key={h}
              className={`item ${active === h ? 'item-active' : ''}`}
              onClick={() => onSelect(h)}
              title={h}
            >
              <span className="mono" style={{ fontSize: 12 }}>
                {h}
              </span>
            </div>
          ))}
          {filtered.length === 0 && <div className="muted">无匹配主机</div>}
        </div>
      </div>
    </div>
  );
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
            <div
              className="tree-row"
              style={{ paddingLeft: pad }}
              onClick={() => onToggleDir(node.path)}
              title={node.path}
            >
              <span className="mono muted" style={{ width: 18, textAlign: 'center' }}>
                {isOpen ? '▾' : '▸'}
              </span>
              <span>📁</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {node.name}
              </span>
            </div>
          )}
          {(node.path === '' || isOpen) && node.children?.map((c) => renderNode(c, node.path === '' ? depth : depth + 1))}
        </React.Fragment>
      );
    }

    const isActive = activeKey === node.key;
    return (
      <div
        key={node.path}
        className={`tree-row ${isActive ? 'tree-row-active' : ''}`}
        style={{ paddingLeft: pad }}
        onClick={() => node.key && onSelectFile(node.key)}
        title={node.key}
      >
        <span className="mono muted" style={{ width: 18, textAlign: 'center' }}>
          {' '}
        </span>
        <span>📄</span>
        <span className="mono" style={{ fontSize: 12 }}>
          {node.name}
        </span>
      </div>
    );
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">文件</div>
      </div>
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
};

function Viewer({ host, keyName, file, loading, error, onDownload }: ViewerProps) {
  const lang = keyName ? languageFromKey(keyName) : 'text';

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">预览</div>
        <div className="badge">
          {host ? <span className="mono">{host}</span> : '—'}
          {keyName ? (
            <>
              {' '}
              · <span className="mono">{keyName.split('/').slice(-2).join('/')}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="panel-body">
        {!keyName && <div className="muted">选择一个文件以预览</div>}
        {loading && <div className="muted">加载中…</div>}
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        {file && (
          <div className="codebox">
            <div className="codebox-head">
              <div className="mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {file.key}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {file.truncated && <span className="pill">已截断</span>}
                <button className="btn btn-primary" onClick={onDownload}>
                  下载
                </button>
              </div>
            </div>
            <div className="codebox-body">
              <SyntaxHighlighter
                language={lang}
                style={oneDark as any}
                customStyle={{ margin: 0, background: 'transparent', fontSize: 12 }}
                showLineNumbers
              >
                {file.text}
              </SyntaxHighlighter>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const api = useMemo(() => new ApiClient(token), [token]);

  const [tokenModalOpen, setTokenModalOpen] = useState(!token);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  const [hosts, setHosts] = useState<string[]>([]);
  const [activeHost, setActiveHost] = useState<string | null>(null);
  const [filesResp, setFilesResp] = useState<FilesResponse | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [fileQuery, setFileQuery] = useState('');

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [file, setFile] = useState<FileResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [globalError, setGlobalError] = useState<string | null>(null);
  const [loadingHosts, setLoadingHosts] = useState(false);

  const refreshHosts = async () => {
    setGlobalError(null);
    setLoadingHosts(true);
    try {
      const info = await api.authInfo();
      setExpiresAt(info.expiresAt);

      const h: HostsResponse = await api.hosts();
      setHosts(h.hosts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'unauthorized') {
        setToken(null);
        localStorage.removeItem(TOKEN_KEY);
        setTokenModalOpen(true);
        setGlobalError('Token 无效或已过期，请重新输入。');
      } else {
        setGlobalError(`加载主机列表失败：${msg}`);
      }
    } finally {
      setLoadingHosts(false);
    }
  };

  useEffect(() => {
    if (token) {
      setTokenModalOpen(false);
      refreshHosts();
    } else {
      setTokenModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const selectHost = async (host: string) => {
    setActiveHost(host);
    setFilesResp(null);
    setTree(null);
    setExpanded(new Set());
    setActiveKey(null);
    setFile(null);
    setFileError(null);
    setFileQuery('');

    try {
      const resp = await api.files(host);
      setFilesResp(resp);
      const t = buildTree(host, resp.objects);
      setTree(t);
      setExpanded(new Set([''])); // root
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'unauthorized') {
        setToken(null);
        localStorage.removeItem(TOKEN_KEY);
        setTokenModalOpen(true);
        setGlobalError('Token 无效或已过期，请重新输入。');
      } else {
        setGlobalError(`加载文件列表失败：${msg}`);
      }
    }
  };

  const toggleDir = (p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
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
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'unauthorized') {
        setToken(null);
        localStorage.removeItem(TOKEN_KEY);
        setTokenModalOpen(true);
        setFileError('Token 无效或已过期，请重新输入。');
      } else {
        setFileError(`加载失败：${msg}`);
      }
    } finally {
      setFileLoading(false);
    }
  };

  const downloadActive = async () => {
    if (!activeKey) return;
    try {
      const blob = await api.download(activeKey);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = activeKey.split('/').pop() || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'unauthorized') {
        setToken(null);
        localStorage.removeItem(TOKEN_KEY);
        setTokenModalOpen(true);
        setGlobalError('Token 无效或已过期，请重新输入。');
      } else {
        setGlobalError(`下载失败：${msg}`);
      }
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">HostSync</div>
          <div className="brand-sub">S3 主机分层 · 本地 Web UI</div>
        </div>
        <div className="topbar-actions">
          <div className="pill">Token 过期时间：{formatTime(expiresAt)}</div>
          <button className="btn" onClick={() => setTokenModalOpen(true)}>
            设置 Token
          </button>
          <button className="btn btn-primary" onClick={refreshHosts} disabled={!token || loadingHosts}>
            {loadingHosts ? '刷新中…' : '刷新'}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              setToken(null);
              localStorage.removeItem(TOKEN_KEY);
              setTokenModalOpen(true);
            }}
          >
            清除 Token
          </button>
        </div>
      </div>

      <div className="content">
        <HostList hosts={hosts} active={activeHost} onSelect={selectHost} />
        <FileTree
          root={tree}
          activeKey={activeKey}
          expanded={expanded}
          onToggleDir={toggleDir}
          onSelectFile={selectFile}
          query={fileQuery}
          onQuery={setFileQuery}
        />
        <Viewer
          host={activeHost}
          keyName={activeKey}
          file={file}
          loading={fileLoading}
          error={fileError ?? globalError}
          onDownload={downloadActive}
        />
      </div>

      <TokenModal
        open={tokenModalOpen}
        onSubmit={(t) => {
          if (!t) return;
          localStorage.setItem(TOKEN_KEY, t);
          setToken(t);
          setTokenModalOpen(false);
        }}
      />

      {globalError && (
        <div style={{ position: 'fixed', bottom: 12, left: 12, right: 12, pointerEvents: 'none' }}>
          <div
            className="panel"
            style={{
              pointerEvents: 'auto',
              padding: 12,
              borderRadius: 14,
              background: 'rgba(255, 92, 92, 0.10)',
              borderColor: 'rgba(255, 92, 92, 0.45)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ color: 'rgba(255,255,255,0.90)' }}>{globalError}</div>
              <button className="btn" onClick={() => setGlobalError(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

