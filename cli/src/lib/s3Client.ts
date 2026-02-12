import fs from 'node:fs';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Upload } from '@aws-sdk/lib-storage';
import {
  GetObjectCommand,
  ListObjectsCommand,
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
  const client = new S3Client({
    region: config.region ?? 'us-east-1',
    endpoint: url.origin,
    forcePathStyle: config.forcePathStyle ?? true,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });

  // Ceph RGW / 旧版 S3 兼容网关兼容性修复：
  // AWS SDK v3 会在请求 URL 中附加 x-id=<OperationName> 查询参数，
  // 某些 Ceph RGW 版本不识别该参数，会把 ListObjects 当成 GetObject 处理
  // 从而返回 NoSuchKey 404。这里在请求发出前把它去掉。
  client.middlewareStack.add(
    (next: any) => async (args: any) => {
      const req = args.request;
      if (req && typeof req === 'object' && req.query && typeof req.query === 'object') {
        delete req.query['x-id'];
      }
      return next(args);
    },
    {
      step: 'build',
      name: 'stripXIdForCephCompat',
      priority: 'low',
    },
  );

  return client;
}

export type S3ObjectInfo = {
  key: string;
  size?: number;
  etag?: string;
  lastModified?: string;
};

function pushContents(results: S3ObjectInfo[], contents: any[] | undefined): void {
  for (const obj of contents ?? []) {
    if (!obj.Key) continue;
    results.push({
      key: obj.Key,
      size: typeof obj.Size === 'number' ? obj.Size : undefined,
      etag: typeof obj.ETag === 'string' ? obj.ETag : undefined,
      lastModified: obj.LastModified ? obj.LastModified.toISOString() : undefined,
    });
  }
}

function isNoSuchKeyError(err: any): boolean {
  const code = err?.Code ?? err?.name ?? '';
  return code === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404;
}

async function listV2(client: IS3Client, bucket: string, prefix: string): Promise<S3ObjectInfo[]> {
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

    pushContents(results, resp.Contents);

    if (!resp.IsTruncated) break;
    token = resp.NextContinuationToken;
    if (!token) break;
  }

  return results;
}

async function listV1(client: IS3Client, bucket: string, prefix: string): Promise<S3ObjectInfo[]> {
  const results: S3ObjectInfo[] = [];
  let marker: string | undefined;

  while (true) {
    const resp = await client.send(
      new ListObjectsCommand({
        Bucket: bucket,
        Prefix: prefix,
        Marker: marker,
      }),
    );

    pushContents(results, resp.Contents);

    if (!resp.IsTruncated) break;
    const last = resp.Contents?.at(-1)?.Key;
    if (!last) break;
    marker = last;
  }

  return results;
}

export async function listAllObjects(
  client: IS3Client,
  bucket: string,
  prefix: string,
): Promise<S3ObjectInfo[]> {
  // 策略：V2 → V1 → 把 NoSuchKey 视为空列表（Ceph RGW 兼容）
  try {
    return await listV2(client, bucket, prefix);
  } catch (err: any) {
    if (!isNoSuchKeyError(err)) throw err;
  }

  try {
    return await listV1(client, bucket, prefix);
  } catch (err: any) {
    if (!isNoSuchKeyError(err)) throw err;
  }

  // 某些 Ceph RGW 对空 bucket/空前缀始终返回 NoSuchKey，视为空列表
  return [];
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

