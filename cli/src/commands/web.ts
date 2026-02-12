import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Command } from 'commander';
import { loadConfig } from '../lib/config';
import { validateRemoteKey } from '../lib/pathMapper';
import { createS3Client, getObjectStream, listAllObjects } from '../lib/s3Client';
import { generateTemporaryToken, isTokenValid } from '../lib/token';

function asyncHandler(
  fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void> | void,
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function summarizeUpstreamError(err: any): { code: string; message: string; hints: string[] } {
  const code = String(err?.name ?? err?.code ?? 'UpstreamError');
  const message = String(err?.message ?? 'unknown error');

  const hints: string[] = [
    '检查 bucket 是否存在（以及是否拼写正确）',
    '检查 endpoint 是否为对象存储的 S3 兼容入口（带协议）',
    '检查 Access Key/Secret Key 权限是否包含 List/Get/Put',
    '尝试切换 forcePathStyle：true（path-style）/ false（virtual-hosted-style）',
    '若服务要求 region，请补齐或调整 region',
  ];

  // 某些 S3 兼容服务在 bucket/endpoint 不匹配时会返回 NoSuchKey（即使是 List）
  if (code === 'NoSuchKey') {
    hints.unshift('出现 NoSuchKey 往往意味着 endpoint/bucket 风格不匹配（尤其是 path-style vs virtual-hosted-style）');
  }

  return { code, message, hints };
}

function getBearerToken(req: express.Request): string | undefined {
  const h = req.header('authorization') ?? '';
  const m = /^Bearer\s+(.+)\s*$/i.exec(h);
  return m?.[1];
}

async function findWebUiDist(): Promise<string> {
  /**
   * 兼容多种运行方式：
   * - 构建后运行：node cli/dist/index.js（__dirname 在 cli/dist/**）
   * - 开发运行：tsx cli/src/index.ts（__dirname 在 cli/src/**，且 cwd 往往是 cli/）
   *
   * 因此同时尝试基于 __dirname 与 cwd 的多组候选路径。
   */
  const candidates = [
    // build: cli/dist/commands -> ../../web-ui/dist
    path.resolve(__dirname, '../../web-ui/dist'),
    // dev: cli/src/commands -> ../../../web-ui/dist
    path.resolve(__dirname, '../../../web-ui/dist'),
    // 若从仓库根目录执行
    path.resolve(process.cwd(), 'web-ui/dist'),
    // 若 cwd 在 cli/
    path.resolve(process.cwd(), '../web-ui/dist'),
  ];

  for (const p of candidates) {
    try {
      const st = await fs.stat(p);
      if (st.isDirectory()) return p;
    } catch {
      // continue
    }
  }

  throw new Error(
    '找不到 Web UI 构建产物（dist）。请先在仓库根目录执行 `npm run build`（或 `npm -w web-ui run build`）。',
  );
}

async function readObjectTextLimited(
  getStream: () => Promise<NodeJS.ReadableStream>,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const stream = await getStream();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;

  return await new Promise((resolve, reject) => {
    stream.on('data', (buf: Buffer) => {
      total += buf.length;
      if (total <= maxBytes) {
        chunks.push(buf);
      } else {
        truncated = true;
        stream.removeAllListeners('data');
        stream.removeAllListeners('end');
        // 尽快停止读取
        (stream as any).destroy?.();
        resolve({ text: Buffer.concat(chunks).toString('utf8'), truncated });
      }
    });
    stream.on('error', reject);
    stream.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), truncated }));
  });
}

function setDownloadHeaders(res: express.Response, key: string): void {
  const filename = key.split('/').pop() || 'download';
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export const webCommand = new Command('web')
  .description('启动本地 Web UI（仅绑定 127.0.0.1 + 临时 Token）')
  .option('-p, --port <port>', '端口（0 表示自动选择空闲端口）', '3000')
  .argument('[port]', '端口（可选；等价于 --port）')
  .action(async (portArg: string | undefined, options: { port: string }) => {
    const port = Number(portArg ?? options.port);
    if (!Number.isFinite(port) || port < 0 || !Number.isInteger(port)) throw new Error('端口不合法');

    const config = await loadConfig();
    const client = createS3Client(config);
    const webDist = await findWebUiDist();

    const tokenState = generateTemporaryToken();

    const app = express();
    app.disable('x-powered-by');

    app.get('/api/health', (_req, res) => res.json({ ok: true }));

    app.use('/api', (req, res, next) => {
      const token = getBearerToken(req);
      if (!isTokenValid(tokenState, token)) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      next();
    });

    app.get('/api/authinfo', (_req, res) => {
      res.json({ expiresAt: tokenState.expiresAt });
    });

    app.get(
      '/api/hosts',
      asyncHandler(async (_req, res) => {
      const objs = await listAllObjects(client, config.bucket, '');
      const hosts = Array.from(
        new Set(
          objs
            .map((o) => o.key.split('/')[0])
            .filter((h) => typeof h === 'string' && h.length > 0),
        ),
      ).sort();
      res.json({ hosts });
      }),
    );

    app.get(
      '/api/files/:host',
      asyncHandler(async (req, res) => {
      const host = String(req.params.host ?? '').trim();
      if (!/^[a-z0-9-]+$/.test(host)) {
        res.status(400).json({ error: 'invalid host' });
        return;
      }

      const objs = await listAllObjects(client, config.bucket, `${host}/`);
      res.json({ host, objects: objs });
      }),
    );

    app.get(
      '/api/file',
      asyncHandler(async (req, res) => {
      const key = String(req.query.key ?? '');
      if (!validateRemoteKey(key)) {
        res.status(400).json({ error: 'invalid key' });
        return;
      }

      const { text, truncated } = await readObjectTextLimited(
        async () => await getObjectStream(client, config.bucket, key),
        512 * 1024,
      );

      // 粗略判断二进制：出现 NUL 直接拒绝
      if (text.includes('\0')) {
        res.status(415).json({ error: 'binary file not supported' });
        return;
      }

      res.json({ key, truncated, text });
      }),
    );

    app.get(
      '/api/download',
      asyncHandler(async (req, res) => {
      const key = String(req.query.key ?? '');
      if (!validateRemoteKey(key)) {
        res.status(400).json({ error: 'invalid key' });
        return;
      }

      setDownloadHeaders(res, key);
      const stream = await getObjectStream(client, config.bucket, key);
      stream.pipe(res);
      }),
    );

    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      // eslint-disable-next-line no-console
      console.error(err);

      const info = summarizeUpstreamError(err);
      res.status(502).json({
        error: 'upstream_error',
        code: info.code,
        message: info.message,
        hints: info.hints,
      });
    });

    app.use(express.static(webDist));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });

    const server = createServer(app);

    server.on('error', (err: any) => {
      if (err?.code === 'EADDRINUSE') {
        // eslint-disable-next-line no-console
        console.error(
          [
            `端口被占用：127.0.0.1:${port}`,
            '你可以：',
            `- 换一个端口：hostsync web --port 3001`,
            `- 或自动选端口：hostsync web --port 0`,
          ].join('\n'),
        );
        process.exitCode = 1;
        return;
      }
      // eslint-disable-next-line no-console
      console.error(err);
      process.exitCode = 1;
    });

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null;
      const actualPort = addr?.port ?? port;
      // eslint-disable-next-line no-console
      console.log(
        [
          'Web UI 启动成功！',
          `访问: http://127.0.0.1:${actualPort}`,
          `临时 Token（5分钟有效）: ${tokenState.token}`,
        ].join('\n'),
      );
    });
  });

