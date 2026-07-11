import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

export function startStaticServer({ root = 'www', port = 4173, host = '127.0.0.1' } = {}) {
  const absoluteRoot = resolve(root);
  const rootPrefix = `${absoluteRoot}${sep}`;

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? host}`);
    let relativePath;

    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }

    let filePath = resolve(absoluteRoot, relativePath || 'index.html');
    if (filePath !== absoluteRoot && !filePath.startsWith(rootPrefix)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = resolve(filePath, 'index.html');
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  });

  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveServer(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? 'www';
  const port = Number.parseInt(process.argv[3] ?? '4173', 10);
  const server = await startStaticServer({ root, port });
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  process.stdout.write(`TaskFocus static server: http://127.0.0.1:${boundPort}\n`);
}
