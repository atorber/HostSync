import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import packageJson from '../package.json';
import { ApiManage } from './views/ApiManage';
import { ConfigManage } from './views/ConfigManage';
import { HostManage } from './views/HostManage';
import { Settings } from './views/Settings';
import { SkillManage } from './views/SkillManage';
import { S3Files } from './views/S3Files';

type TabId = 'api' | 'skill' | 'config' | 'hosts' | 's3' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'api', label: 'API Keys' },
  { id: 'skill', label: 'Skills' },
  { id: 'config', label: '配置' },
  { id: 'hosts', label: '主机' },
  { id: 's3', label: '文件' },
  { id: 'settings', label: '设置' },
];

export function App() {
  const [tab, setTab] = useState<TabId>('api');
  const [configPath, setConfigPath] = useState('');
  const [configReady, setConfigReady] = useState<boolean | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const path = await invoke<string>('get_config_path');
        if (!cancelled) setConfigPath(path);
        await invoke('init_s3');
        if (!cancelled) setConfigReady(true);
      } catch {
        if (!cancelled) setConfigReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const renderContent = () => {
    switch (tab) {
      case 'api':
        return <ApiManage onError={setGlobalError} />;
      case 'skill':
        return <SkillManage onError={setGlobalError} />;
      case 'config':
        return <ConfigManage onError={setGlobalError} />;
      case 'hosts':
        return <HostManage onError={setGlobalError} />;
      case 's3':
        return <S3Files onError={setGlobalError} />;
      case 'settings':
        return <Settings onError={setGlobalError} onConfigReadyChange={setConfigReady} />;
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">HostSync</div>
          <div className="brand-sub">配置管理 · 桌面端 · v{packageJson.version}</div>
        </div>
        <div className="topbar-actions">
          {configPath && (
            <div className="pill" title={configPath}>
              <span className="mono" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {configPath}
              </span>
            </div>
          )}
          {configReady === false && (
            <span className="muted" style={{ fontSize: 12 }}>未配置 S3，请到「设置」中配置</span>
          )}
        </div>
      </div>

      <div className="app-body">
        <nav className="sidebar">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`sidebar-item ${tab === t.id ? 'sidebar-item-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <main className="main-content">
          {renderContent()}
        </main>
      </div>

      {globalError && (
        <div className="toast-error">
          <div className="panel" style={{ padding: 12, borderRadius: 14, background: 'rgba(255, 92, 92, 0.10)', border: '1px solid rgba(255, 92, 92, 0.45)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ color: 'rgba(255,255,255,0.90)' }}>{globalError}</div>
              <button className="btn" onClick={() => setGlobalError(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
