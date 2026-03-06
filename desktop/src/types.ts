export type HostsResponse = {
  hosts: string[];
};

export type S3ObjectInfo = {
  key: string;
  size?: number;
  etag?: string;
  lastModified?: string;
};

export type FilesResponse = {
  host: string;
  objects: S3ObjectInfo[];
};

export type FileResponse = {
  key: string;
  text: string;
  truncated: boolean;
};

export type AuthInfoResponse = {
  desktop?: boolean;
  expiresAt?: number;
};
