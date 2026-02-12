import fs from 'node:fs';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Upload } from '@aws-sdk/lib-storage';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client as IS3Client,
  S3Client,
} from '@aws-sdk/client-s3';
import { HostSyncConfig } from './config';

function parseEndpointToUrl(endpoint: string): URL {
  const trimmed = endpoint.trim();
  const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withProto);
}

export function createS3Client(config: HostSyncConfig): IS3Client {
  const url = parseEndpointToUrl(config.endpoint);

  // 兼容更多 S3 网关：默认使用 path-style（Bucket 在路径中）
  return new S3Client({
    region: config.region ?? 'us-east-1',
    endpoint: url.origin,
    forcePathStyle: config.forcePathStyle ?? true,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });
}

export type S3ObjectInfo = {
  key: string;
  size?: number;
  etag?: string;
  lastModified?: string;
};

export async function listAllObjects(
  client: IS3Client,
  bucket: string,
  prefix: string,
): Promise<S3ObjectInfo[]> {
  const results: S3ObjectInfo[] = [];
  let token: string | undefined;

  while (true) {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );

    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      results.push({
        key: obj.Key,
        size: typeof obj.Size === 'number' ? obj.Size : undefined,
        etag: typeof obj.ETag === 'string' ? obj.ETag : undefined,
        lastModified: obj.LastModified ? obj.LastModified.toISOString() : undefined,
      });
    }

    if (!resp.IsTruncated) break;
    token = resp.NextContinuationToken;
    if (!token) break;
  }

  return results;
}

export async function uploadFile(
  client: IS3Client,
  bucket: string,
  key: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  const uploader = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
    },
  });
  await uploader.done();
}

export async function downloadFile(
  client: IS3Client,
  bucket: string,
  key: string,
  destPath: string,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = resp.Body as any;
  if (!body || typeof body.pipe !== 'function') {
    throw new Error('下载失败：响应体不是可读流');
  }
  await pipeline(body, createWriteStream(destPath));
}

export async function getObjectStream(
  client: IS3Client,
  bucket: string,
  key: string,
): Promise<NodeJS.ReadableStream> {
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = resp.Body as any;
  if (!body || typeof body.on !== 'function') {
    throw new Error('读取失败：响应体不是可读流');
  }
  return body as NodeJS.ReadableStream;
}

