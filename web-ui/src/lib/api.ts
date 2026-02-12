import type { AuthInfoResponse, FileResponse, FilesResponse, HostsResponse } from '../types';

export class ApiClient {
  private token: string | null;

  constructor(token: string | null) {
    this.token = token;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers ?? {});
    headers.set('Accept', 'application/json');
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);

    const res = await fetch(path, { ...init, headers });
    if (res.status === 401) throw new Error('unauthorized');
    if (!res.ok) {
      let detail = '';
      try {
        const data = (await res.json()) as any;
        const code = data?.code ? String(data.code) : '';
        const msg = data?.message ? String(data.message) : '';
        const hints = Array.isArray(data?.hints) ? data.hints.map((h: any) => String(h)).slice(0, 3) : [];
        const parts = [code && `code=${code}`, msg && `msg=${msg}`].filter(Boolean).join(' ');
        const hintText = hints.length ? ` hints=${hints.join(' | ')}` : '';
        detail = parts || hintText ? ` (${parts}${hintText})` : '';
      } catch {
        // ignore
      }
      throw new Error(`http ${res.status}${detail}`);
    }
    return (await res.json()) as T;
  }

  async health(): Promise<{ ok: boolean }> {
    return await this.request('/api/health');
  }

  async authInfo(): Promise<AuthInfoResponse> {
    return await this.request('/api/authinfo');
  }

  async hosts(): Promise<HostsResponse> {
    return await this.request('/api/hosts');
  }

  async files(host: string): Promise<FilesResponse> {
    return await this.request(`/api/files/${encodeURIComponent(host)}`);
  }

  async file(key: string): Promise<FileResponse> {
    const qs = new URLSearchParams({ key });
    return await this.request(`/api/file?${qs.toString()}`);
  }

  async download(key: string): Promise<Blob> {
    const qs = new URLSearchParams({ key });
    const headers = new Headers();
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    const res = await fetch(`/api/download?${qs.toString()}`, { headers });
    if (res.status === 401) throw new Error('unauthorized');
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.blob();
  }
}

