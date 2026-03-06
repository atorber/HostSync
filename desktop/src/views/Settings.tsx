import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type S3Config = {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
  forcePathStyle?: boolean;
};

type Props = {
  onError: (msg: string | null) => void;
  onConfigReadyChange?: (ready: boolean) => void;
};

export function Settings({ onError, onConfigReadyChange }: Props) {
  const [config, setConfig] = useState<S3Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupResult, setBackupResult] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await invoke<S3Config>('config_load');
        setConfig(cfg);
        onError(null);
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
        setConfig({
          endpoint: '',
          accessKey: '',
          secretKey: '',
          bucket: '',
          region: '',
          forcePathStyle: true,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await invoke('config_save', {
        input: {
          endpoint: config.endpoint,
          accessKey: config.accessKey,
          secretKey: config.secretKey,
          bucket: config.bucket,
          region: config.region || null,
          forcePathStyle: config.forcePathStyle ?? true,
        },
      });
      onConfigReadyChange?.(true);
      onError(null);
    } catch (e) {
      onConfigReadyChange?.(false);
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const backup = async () => {
    setBackupLoading(true);
    setBackupResult(null);
    try {
      await invoke('init_s3');
      const key = await invoke<string>('backup_run');
      setBackupResult(`已备份到 S3：${key}`);
      onConfigReadyChange?.(true);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackupLoading(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="content-single">
        <div className="panel flex-1">
          <div className="panel-body">
            <div className="muted">加载中…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="content-single">
      <div className="panel flex-1">
        <div className="panel-header">
          <div className="panel-title">S3 配置</div>
        </div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Endpoint</span>
            <input
              className="search mono"
              value={config.endpoint}
              onChange={(e) => setConfig((c) => (c ? { ...c, endpoint: e.target.value } : c))}
              placeholder="https://s3.example.com"
            />
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Bucket</span>
            <input
              className="search"
              value={config.bucket}
              onChange={(e) => setConfig((c) => (c ? { ...c, bucket: e.target.value } : c))}
            />
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Access Key</span>
            <input
              className="search mono"
              type="password"
              value={config.accessKey}
              onChange={(e) => setConfig((c) => (c ? { ...c, accessKey: e.target.value } : c))}
            />
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Secret Key</span>
            <input
              className="search mono"
              type="password"
              value={config.secretKey}
              onChange={(e) => setConfig((c) => (c ? { ...c, secretKey: e.target.value } : c))}
            />
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Region（可选）</span>
            <input
              className="search"
              value={config.region ?? ''}
              onChange={(e) => setConfig((c) => (c ? { ...c, region: e.target.value || undefined } : c))}
              placeholder="us-east-1"
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={config.forcePathStyle ?? true}
              onChange={(e) => setConfig((c) => (c ? { ...c, forcePathStyle: e.target.checked } : c))}
            />
            <span className="muted" style={{ fontSize: 12 }}>Path-style 访问</span>
          </label>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className="panel flex-1" style={{ marginTop: 12 }}>
        <div className="panel-header">
          <div className="panel-title">一键备份</div>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            将当前 API 配置与 Skill 索引备份到 S3 的 backup/ 目录，需先配置并保存上方 S3 信息。
          </p>
          <button className="btn btn-primary" onClick={backup} disabled={backupLoading}>
            {backupLoading ? '备份中…' : '备份到云端'}
          </button>
          {backupResult && <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>{backupResult}</div>}
        </div>
      </div>
    </div>
  );
}
