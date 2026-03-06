import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type ApiKeyEntry = {
  id: string;
  name: string;
  kind: string;
  apiKey: string;
  baseUrl?: string;
  remark?: string;
  createdAt: number;
  updatedAt: number;
};

type Props = {
  onError: (msg: string | null) => void;
};

export function ApiManage({ onError }: Props) {
  const [list, setList] = useState<ApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerNew, setDrawerNew] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'openai', apiKey: '', baseUrl: '', remark: '' });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await invoke<ApiKeyEntry[]>('api_list');
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
  }, []);

  const openNew = () => {
    setDrawerNew(true);
    setDrawerId(null);
    setForm({ name: '', kind: 'openai', apiKey: '', baseUrl: '', remark: '' });
  };

  const openEdit = (e: ApiKeyEntry) => {
    setDrawerNew(false);
    setDrawerId(e.id);
    setForm({
      name: e.name,
      kind: e.kind,
      apiKey: e.apiKey,
      baseUrl: e.baseUrl ?? '',
      remark: e.remark ?? '',
    });
  };

  const closeDrawer = () => {
    setDrawerId(null);
    setDrawerNew(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (drawerNew) {
        await invoke('api_create', {
          name: form.name,
          kind: form.kind,
          apiKey: form.apiKey,
          baseUrl: form.baseUrl || null,
          remark: form.remark || null,
        });
      } else if (drawerId) {
        await invoke('api_update', {
          id: drawerId,
          name: form.name,
          kind: form.kind,
          apiKey: form.apiKey,
          baseUrl: form.baseUrl || null,
          remark: form.remark || null,
        });
      }
      onError(null);
      closeDrawer();
      load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const syncToCloud = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await invoke('init_s3');
      const key = await invoke<string>('api_sync_to_cloud');
      setSyncMsg(`已同步到 ${key}`);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const pullFromCloud = async () => {
    setPulling(true);
    setSyncMsg(null);
    try {
      await invoke('init_s3');
      await invoke('api_pull_from_cloud');
      setSyncMsg('已从云端拉取并覆盖本地');
      onError(null);
      load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('确定删除？')) return;
    try {
      await invoke('api_delete', { id });
      onError(null);
      closeDrawer();
      load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="content-single">
      <div className="panel flex-1">
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="panel-title">API 管理</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" onClick={pullFromCloud} disabled={pulling}>
              {pulling ? '拉取中…' : '从云端拉取'}
            </button>
            <button className="btn" onClick={syncToCloud} disabled={syncing}>
              {syncing ? '同步中…' : '同步到云端'}
            </button>
            <button className="btn btn-primary" onClick={openNew}>
              新增
            </button>
          </div>
        </div>
        <div className="panel-body">
          {loading && <div className="muted">加载中…</div>}
          {!loading && list.length === 0 && <div className="muted">暂无 API 配置，点击「新增」添加</div>}
          {syncMsg && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              {syncMsg}
            </div>
          )}
          {!loading && list.length > 0 && (
            <div className="list">
              {list.map((e) => (
                <div
                  key={e.id}
                  className={`item ${drawerId === e.id ? 'item-active' : ''}`}
                  onClick={() => openEdit(e)}
                >
                  <span style={{ fontWeight: 600 }}>{e.name}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {e.kind}
                    {e.baseUrl ? ` · ${e.baseUrl}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {(drawerNew || drawerId) && (
        <div className="drawer-backdrop" onClick={closeDrawer}>
          <div className="drawer" onClick={(ev) => ev.stopPropagation()}>
            <div className="panel-header" style={{ justifyContent: 'space-between' }}>
              <div className="panel-title">{drawerNew ? '新增 API' : '编辑 API'}</div>
              <button className="btn" onClick={closeDrawer}>
                关闭
              </button>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label>
                <span className="muted" style={{ fontSize: 12 }}>名称</span>
                <input
                  className="search"
                  value={form.name}
                  onChange={(ev) => setForm((f) => ({ ...f, name: ev.target.value }))}
                  placeholder="例如：OpenAI 生产"
                />
              </label>
              <label>
                <span className="muted" style={{ fontSize: 12 }}>类型</span>
                <select
                  className="search"
                  value={form.kind}
                  onChange={(ev) => setForm((f) => ({ ...f, kind: ev.target.value }))}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="custom">自定义</option>
                </select>
              </label>
              <label>
                <span className="muted" style={{ fontSize: 12 }}>API Key</span>
                <input
                  className="search mono"
                  type="password"
                  value={form.apiKey}
                  onChange={(ev) => setForm((f) => ({ ...f, apiKey: ev.target.value }))}
                  placeholder="sk-..."
                />
              </label>
              <label>
                <span className="muted" style={{ fontSize: 12 }}>Base URL（可选）</span>
                <input
                  className="search mono"
                  value={form.baseUrl}
                  onChange={(ev) => setForm((f) => ({ ...f, baseUrl: ev.target.value }))}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label>
                <span className="muted" style={{ fontSize: 12 }}>备注（可选）</span>
                <input
                  className="search"
                  value={form.remark}
                  onChange={(ev) => setForm((f) => ({ ...f, remark: ev.target.value }))}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary" onClick={save} disabled={saving || !form.name.trim() || !form.apiKey.trim()}>
                  {saving ? '保存中…' : '保存'}
                </button>
                {!drawerNew && drawerId && (
                  <button className="btn btn-danger" onClick={() => drawerId && remove(drawerId)}>
                    删除
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
