import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GmailStateStore } from './state-store.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');
const fixturePath = join(rootDir, 'data/fixtures/initial-state.json');
const publicDir = join(rootDir, 'public');

function resolveStatePath() {
  if (process.env.GMAIL_RL_STATE_PATH) {
    return resolve(process.env.GMAIL_RL_STATE_PATH);
  }

  if (process.env.VERCEL) {
    const runtimeDir = join(process.env.TMPDIR || '/tmp', 'gmail-rl-runtime');
    return join(runtimeDir, 'state.json');
  }

  return join(rootDir, 'data/runtime/state.json');
}

const statePath = resolveStatePath();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function json(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload, null, 2));
}

function text(response, statusCode, payload, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, { 'content-type': contentType });
  response.end(payload);
}

async function parseBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function safeAssetPath(urlPath) {
  const relativePath = urlPath === '/' ? '/index.html' : urlPath;
  const assetPath = resolve(publicDir, `.${relativePath}`);
  if (!assetPath.startsWith(publicDir)) {
    return null;
  }
  return assetPath;
}

function buildAppServer() {
  const store = new GmailStateStore({ fixturePath, statePath });

  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const path = requestUrl.pathname;

      if (request.method === 'GET' && path === '/health') {
        return json(response, 200, { ok: true });
      }

      if (request.method === 'GET' && path === '/api/env') {
        return json(response, 200, store.getMetadata());
      }

      if (request.method === 'GET' && path === '/api/labels') {
        return json(response, 200, { labels: store.listLabels() });
      }

      if (request.method === 'GET' && path === '/api/threads') {
        const label = requestUrl.searchParams.get('label') ?? undefined;
        const query = requestUrl.searchParams.get('q') ?? undefined;
        return json(response, 200, { threads: store.listThreads({ label, query }) });
      }

      if (request.method === 'GET' && path === '/api/drafts') {
        return json(response, 200, { drafts: store.listDrafts() });
      }

      if (request.method === 'GET' && path === '/api/snapshots') {
        return json(response, 200, { snapshots: store.listSnapshots() });
      }

      if (request.method === 'GET' && path.startsWith('/api/threads/')) {
        const [, , resource, threadId, action] = path.split('/');
        if (resource === 'threads' && threadId && !action) {
          const thread = store.getThread(threadId);
          if (!thread) {
            return json(response, 404, { error: 'Thread not found' });
          }
          return json(response, 200, { thread });
        }
      }

      if (request.method === 'POST' && path === '/api/drafts') {
        const body = await parseBody(request);
        const draft = store.createDraft(body);
        return json(response, 201, { draft });
      }

      if (request.method === 'PUT' && path.startsWith('/api/drafts/')) {
        const [, , resource, draftId] = path.split('/');
        if (resource === 'drafts' && draftId) {
          const body = await parseBody(request);
          const draft = store.updateDraft(draftId, body);
          if (!draft) {
            return json(response, 404, { error: 'Draft not found' });
          }
          return json(response, 200, { draft });
        }
      }

      if (request.method === 'POST' && path.startsWith('/api/drafts/') && path.endsWith('/send')) {
        const [, , resource, draftId] = path.split('/');
        if (resource === 'drafts' && draftId) {
          const thread = store.sendDraft(draftId);
          if (!thread) {
            return json(response, 404, { error: 'Draft not found' });
          }
          return json(response, 200, { thread });
        }
      }

      if (request.method === 'POST' && path.startsWith('/api/threads/')) {
        const [, , resource, threadId, action] = path.split('/');
        if (resource === 'threads' && threadId && action) {
          if (action === 'archive') {
            const thread = store.archiveThread(threadId);
            return thread ? json(response, 200, { thread }) : json(response, 404, { error: 'Thread not found' });
          }

          const body = await parseBody(request);
          if (action === 'star') {
            const thread = store.setStarred(threadId, body.starred);
            return thread ? json(response, 200, { thread }) : json(response, 404, { error: 'Thread not found' });
          }
          if (action === 'read') {
            const thread = store.setUnread(threadId, body.unread);
            return thread ? json(response, 200, { thread }) : json(response, 404, { error: 'Thread not found' });
          }
          if (action === 'labels') {
            const thread = store.updateLabels(threadId, body);
            return thread ? json(response, 200, { thread }) : json(response, 404, { error: 'Thread not found' });
          }
        }
      }

      if (request.method === 'POST' && path === '/api/reset') {
        const snapshot = store.reset();
        return json(response, 200, { snapshotId: snapshot.id });
      }

      if (request.method === 'POST' && path.startsWith('/api/snapshots/') && path.endsWith('/restore')) {
        const [, , resource, snapshotId] = path.split('/');
        if (resource === 'snapshots' && snapshotId) {
          const snapshot = store.restoreSnapshot(snapshotId);
          return snapshot ? json(response, 200, { snapshotId: snapshot.id }) : json(response, 404, { error: 'Snapshot not found' });
        }
      }

      if (request.method === 'GET' && path === '/openapi.yaml') {
        const spec = readFileSync(join(rootDir, 'openapi/gmail-rl.openapi.yaml'), 'utf8');
        return text(response, 200, spec, 'application/yaml; charset=utf-8');
      }

      if (request.method === 'GET') {
        const assetPath = safeAssetPath(path);
        if (!assetPath || !existsSync(assetPath)) {
          return text(response, 404, 'Not found');
        }
        const content = readFileSync(assetPath);
        const contentType = mimeTypes[extname(assetPath)] ?? 'application/octet-stream';
        return text(response, 200, content, contentType);
      }

      return json(response, 405, { error: 'Method not allowed' });
    } catch (error) {
      return json(response, 500, {
        error: 'Internal server error',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

const appServer = buildAppServer();

export default function handler(request, response) {
  return appServer.emit('request', request, response);
}

export function startServer(port = Number(process.env.PORT || 4010)) {
  mkdirSync(dirname(statePath), { recursive: true });
  const server = buildAppServer();
  return new Promise(resolveServer => {
    server.listen(port, '127.0.0.1', () => {
      resolveServer(server);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer();
  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : 4010;
  console.log(`gmail-rl listening on http://127.0.0.1:${resolvedPort}`);
}
