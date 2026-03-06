import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type ApiKeyEntry = {
  id: string;
  name: string;
  kind: string;
  apiKey: string;
  baseUrl?: string;
  remark?: string;
  model?: string;
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
  const [form, setForm] = useState({ name: '', kind: 'openai', apiKey: '', baseUrl: '', remark: '', testModel: '' });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [listTesting, setListTesting] = useState<string | null>(null);
  const [listTestResults, setListTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    setForm({ name: '', kind: 'openai', apiKey: '', baseUrl: '', remark: '', testModel: '' });
    setTestResult(null);
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
      testModel: e.model ?? '',
    });
    setTestResult(null);
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
          model: form.testModel || null,
        });
      } else if (drawerId) {
        await invoke('api_update', {
          id: drawerId,
          name: form.name,
          kind: form.kind,
          apiKey: form.apiKey,
          baseUrl: form.baseUrl || null,
          remark: form.remark || null,
          model: form.testModel || null,
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

  const testApi = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await invoke<{ ok: boolean; message: string }>('api_test', {
        kind: form.kind,
        apiKey: form.apiKey,
        baseUrl: form.baseUrl || null,
        model: form.testModel || null,
      });
      setTestResult(result);
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const testApiFromList = async (e: React.MouseEvent, entry: ApiKeyEntry) => {
    e.stopPropagation();
    setListTesting(entry.id);
    setListTestResults((prev) => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
    try {
      const result = await invoke<{ ok: boolean; message: string }>('api_test', {
        kind: entry.kind,
        apiKey: entry.apiKey,
        baseUrl: entry.baseUrl || null,
        model: entry.model || null,
      });
      setListTestResults((prev) => ({ ...prev, [entry.id]: result }));
    } catch (err) {
      setListTestResults((prev) => ({
        ...prev,
        [entry.id]: { ok: false, message: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setListTesting(null);
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
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{e.name}</span>
                    <span
                      style={{
                        fontSize: 11,
                        marginLeft: 8,
                        padding: '1px 6px',
                        borderRadius: 3,
                        color: listTestResults[e.id]
                          ? listTestResults[e.id].ok ? '#22c55e' : '#ef4444'
                          : '#a0a0a0',
                        border: `1px solid ${listTestResults[e.id]
                          ? listTestResults[e.id].ok ? '#22c55e' : '#ef4444'
                          : '#666'}`,
                      }}
                    >
                      {listTesting === e.id ? '检测中' : listTestResults[e.id]
                        ? listTestResults[e.id].ok ? '正常' : '异常'
                        : '未知'}
                    </span>
                    <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>
                      {e.kind}
                      {e.baseUrl ? ` · ${e.baseUrl}` : ''}
                    </span>
                    {listTestResults[e.id] && !listTestResults[e.id].ok && (
                      <div style={{ fontSize: 11, marginTop: 2, color: '#ef4444', wordBreak: 'break-all' }}>
                        {listTestResults[e.id].message}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn"
                    style={{ fontSize: 12, padding: '2px 8px', marginLeft: 8, flexShrink: 0 }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      const info: Record<string, string> = {
                        name: e.name,
                        kind: e.kind,
                        apiKey: e.apiKey,
                      };
                      if (e.baseUrl) info.baseUrl = e.baseUrl;
                      if (e.model) info.model = e.model;
                      if (e.remark) info.remark = e.remark;
                      navigator.clipboard.writeText(JSON.stringify(info, null, 2));
                      setCopiedId(e.id);
                      setTimeout(() => setCopiedId((prev) => (prev === e.id ? null : prev)), 2000);
                    }}
                  >
                    {copiedId === e.id ? '已复制' : '复制'}
                  </button>
                  <button
                    className="btn"
                    style={{ fontSize: 12, padding: '2px 8px', marginLeft: 8, flexShrink: 0 }}
                    disabled={listTesting === e.id}
                    onClick={(ev) => testApiFromList(ev, e)}
                  >
                    {listTesting === e.id ? '测试中…' : '测试'}
                  </button>
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
              <label>
                <span className="muted" style={{ fontSize: 12 }}>测试 Model（可选，不填仅验证连通性）</span>
                <input
                  className="search mono"
                  value={form.testModel}
                  onChange={(ev) => setForm((f) => ({ ...f, testModel: ev.target.value }))}
                  placeholder={form.kind === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o-mini'}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary" onClick={save} disabled={saving || !form.name.trim() || !form.apiKey.trim()}>
                  {saving ? '保存中…' : '保存'}
                </button>
                <button
                  className="btn"
                  onClick={testApi}
                  disabled={testing || !form.apiKey.trim()}
                >
                  {testing ? '测试中…' : '测试'}
                </button>
                {!drawerNew && drawerId && (
                  <button className="btn btn-danger" onClick={() => drawerId && remove(drawerId)}>
                    删除
                  </button>
                )}
              </div>
              {testResult && (
                <div
                  style={{
                    fontSize: 12,
                    marginTop: 4,
                    color: testResult.ok ? '#22c55e' : '#ef4444',
                    wordBreak: 'break-all',
                  }}
                >
                  {testResult.message}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
