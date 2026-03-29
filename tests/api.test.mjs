import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.mjs';

let server;
let baseUrl;

test.before(async () => {
  server = await startServer(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 4010;
  baseUrl = `http://127.0.0.1:${port}`;
  await request('/api/reset', { method: 'POST' });
});

test.after(async () => {
  await new Promise(resolvePromise => server.close(resolvePromise));
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const body = await response.json();
  return { response, body };
}

test('lists seeded inbox threads', async () => {
  const { response, body } = await request('/api/threads?label=inbox');
  assert.equal(response.status, 200);
  assert.equal(body.threads.length, 2);
  assert.equal(body.threads[0].id, 'thread-1');
});

test('creates and sends a draft', async () => {
  const created = await request('/api/drafts', {
    method: 'POST',
    body: JSON.stringify({
      to: ['agent@google.com'],
      cc: [],
      bcc: [],
      subject: 'RL delivery test',
      body: 'Ship the Gmail environment.',
    }),
  });
  assert.equal(created.response.status, 201);
  const sent = await request(`/api/drafts/${created.body.draft.id}/send`, { method: 'POST' });
  assert.equal(sent.response.status, 200);
  assert.equal(sent.body.thread.labels.includes('sent'), true);
});

test('updates drafts and exposes them through the drafts API', async () => {
  const created = await request('/api/drafts', {
    method: 'POST',
    body: JSON.stringify({
      to: ['owner@google.com'],
      cc: [],
      bcc: [],
      subject: 'Initial draft',
      body: 'Initial body.',
    }),
  });
  assert.equal(created.response.status, 201);

  const updated = await request(`/api/drafts/${created.body.draft.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      to: ['owner@google.com', 'reviewer@google.com'],
      cc: ['cc@google.com'],
      bcc: [],
      subject: 'Updated draft',
      body: 'Updated body.',
    }),
  });
  assert.equal(updated.response.status, 200);
  assert.deepEqual(updated.body.draft.to, ['owner@google.com', 'reviewer@google.com']);
  assert.deepEqual(updated.body.draft.cc, ['cc@google.com']);

  const drafts = await request('/api/drafts');
  assert.equal(drafts.response.status, 200);
  assert.ok(drafts.body.drafts.some(draft => draft.id === created.body.draft.id && draft.subject === 'Updated draft'));
});

test('stars, archives, and restores a thread', async () => {
  const starred = await request('/api/threads/thread-2/star', {
    method: 'POST',
    body: JSON.stringify({ starred: true }),
  });
  assert.equal(starred.response.status, 200);
  assert.equal(starred.body.thread.starred, true);

  const archived = await request('/api/threads/thread-2/archive', { method: 'POST' });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.body.thread.labels.includes('archive'), true);
  assert.equal(archived.body.thread.labels.includes('inbox'), false);

  const snapshots = await request('/api/snapshots');
  const priorSnapshot = snapshots.body.snapshots.find(snapshot => snapshot.reason === 'Initial fixture');
  assert.ok(priorSnapshot);

  const restored = await request(`/api/snapshots/${priorSnapshot.id}/restore`, { method: 'POST' });
  assert.equal(restored.response.status, 200);

  const thread = await request('/api/threads/thread-2');
  assert.equal(thread.body.thread.starred, false);
  assert.equal(thread.body.thread.labels.includes('inbox'), true);
});

test('searches threads and updates labels', async () => {
  const search = await request('/api/threads?label=all&q=launch');
  assert.equal(search.response.status, 200);
  assert.ok(search.body.threads.some(thread => thread.id === 'thread-1'));

  const labeled = await request('/api/threads/thread-2/labels', {
    method: 'POST',
    body: JSON.stringify({ add: ['important'], remove: ['travel'] }),
  });
  assert.equal(labeled.response.status, 200);
  assert.equal(labeled.body.thread.labels.includes('important'), true);
  assert.equal(labeled.body.thread.labels.includes('travel'), false);
});

test('serves the OpenAPI spec', async () => {
  const response = await fetch(`${baseUrl}/openapi.yaml`);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /Gmail RL Environment API/);
  assert.match(text, /\/api\/threads/);
});

test('serves the browser shell', async () => {
  const response = await fetch(`${baseUrl}/`);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /Gmail RL/);
});
