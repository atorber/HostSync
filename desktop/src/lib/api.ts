import { invoke } from '@tauri-apps/api/core';
import type {
  AuthInfoResponse,
  FileResponse,
  FilesResponse,
  HostsResponse,
} from '../types';

/**
 * 桌面端 API：通过 Tauri invoke 调用 Rust 命令，与 web-ui 的 HTTP API 语义一致。
 */
export class ApiClient {
  async ensureS3Ready(): Promise<void> {
    await invoke('init_s3');
  }

  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async authInfo(): Promise<AuthInfoResponse> {
    await this.ensureS3Ready();
    return await invoke<AuthInfoResponse>('auth_info');
  }

  async hosts(): Promise<HostsResponse> {
    await this.ensureS3Ready();
    return await invoke<HostsResponse>('hosts');
  }

  async files(host: string): Promise<FilesResponse> {
    return await invoke<FilesResponse>('files', { host });
  }

  /** 桌面端返回的 objects 使用 last_modified（snake_case），统一为 lastModified */
  async filesNormalized(host: string): Promise<FilesResponse> {
    const raw = await this.files(host);
    return {
      host: raw.host,
      objects: raw.objects.map((o) => ({
        key: o.key,
        size: o.size,
        etag: o.etag,
        lastModified: (o as any).last_modified ?? o.lastModified,
      })),
    };
  }

  async file(key: string): Promise<FileResponse> {
    await this.ensureS3Ready();
    return await invoke<FileResponse>('file_content', { key });
  }

  async download(key: string): Promise<void> {
    await this.ensureS3Ready();
    await invoke('download_file', { key });
  }
}
