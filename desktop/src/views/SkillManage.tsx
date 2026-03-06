import { useEffect, useState, useRef } from 'react';
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

type ScanProgress = {
  dirsScanned: number;
  foundCount: number;
  currentPath: string;
};

type Props = {
  onError: (msg: string | null) => void;
};

export function SkillManage({ onError }: Props) {
  const [list, setList] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

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
      unlistenRef.current?.();
    };
  }, []);

  const scanHome = async () => {
    setScanning(true);
    setProgress({ dirsScanned: 0, foundCount: 0, currentPath: '准备中…' });
    try {
      unlistenRef.current?.();
      unlistenRef.current = await listen<ScanProgress>('skill-scan-progress', (event) => {
        setProgress(event.payload);
      });

      const home = await homeDir();
      await invoke('skill_scan_roots', { roots: [home] });
      onError(null);
      load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
      setProgress(null);
      unlistenRef.current?.();
      unlistenRef.current = null;
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
            style={{
              padding: '8px 16px',
              background: 'var(--bg-secondary, #f5f5f5)',
              borderBottom: '1px solid var(--border, #e0e0e0)',
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
          {!loading && list.length > 0 && (
            <div className="list">
              {list.map((e) => (
                <div
                  key={e.id}
                  className={`item ${drawerPath === e.skillMdPath ? 'item-active' : ''}`}
                  onClick={() => openDrawer(e.skillMdPath)}
                >
                  <span style={{ fontWeight: 600 }}>{e.skillMdPath.split('/').pop() || e.name}</span>
                  <span className="mono muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                    {e.skillMdPath}
                  </span>
                </div>
              ))}
            </div>
          )}
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
