import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import { Command } from 'commander';
import { loadConfig } from '../lib/config';
import { validateRemoteKey } from '../lib/pathMapper';
import { createS3Client, getObjectStream, listAllObjects } from '../lib/s3Client';
import { generateTemporaryToken, isTokenValid } from '../lib/token';

function getBearerToken(req: express.Request): string | undefined {
  const h = req.header('authorization') ?? '';
  const m = /^Bearer\s+(.+)\s*$/i.exec(h);
  return m?.[1];
}

async function findWebUiDist(): Promise<string> {
  // monorepo: cli/dist -> ../../web-ui/dist
  const candidates = [
    path.join(__dirname, '../../web-ui/dist'),
    path.join(process.cwd(), 'web-ui', 'dist'),
    path.join(__dirname, '../web-ui/dist'),
  ];

  for (const p of candidates) {
    try {
      const st = await fs.stat(p);
      if (st.isDirectory()) return p;
    } catch {
      // continue
    }
  }

  throw new Error('找不到 Web UI 构建产物（dist）。请先在仓库根目录执行 `npm run build`。');
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
  .option('-p, --port <port>', '端口', '3000')
  .action(async (options: { port: string }) => {
    const port = Number(options.port);
    if (!Number.isFinite(port) || port <= 0) throw new Error('端口不合法');

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

    app.get('/api/hosts', async (_req, res) => {
      const objs = await listAllObjects(client, config.bucket, '');
      const hosts = Array.from(
        new Set(
          objs
            .map((o) => o.key.split('/')[0])
            .filter((h) => typeof h === 'string' && h.length > 0),
        ),
      ).sort();
      res.json({ hosts });
    });

    app.get('/api/files/:host', async (req, res) => {
      const host = String(req.params.host ?? '').trim();
      if (!/^[a-z0-9-]+$/.test(host)) {
        res.status(400).json({ error: 'invalid host' });
        return;
      }

      const objs = await listAllObjects(client, config.bucket, `${host}/`);
      res.json({ host, objects: objs });
    });

    app.get('/api/file', async (req, res) => {
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
    });

    app.get('/api/download', async (req, res) => {
      const key = String(req.query.key ?? '');
      if (!validateRemoteKey(key)) {
        res.status(400).json({ error: 'invalid key' });
        return;
      }

      setDownloadHeaders(res, key);
      const stream = await getObjectStream(client, config.bucket, key);
      stream.pipe(res);
    });

    app.use(express.static(webDist));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });

    createServer(app).listen(port, '127.0.0.1', () => {
      // eslint-disable-next-line no-console
      console.log(
        [
          'Web UI 启动成功！',
          `访问: http://127.0.0.1:${port}`,
          `临时 Token（5分钟有效）: ${tokenState.token}`,
        ].join('\n'),
      );
    });
  });

