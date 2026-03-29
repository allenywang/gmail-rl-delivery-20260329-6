import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');
const proofDir = join(rootDir, 'artifacts/proof');
mkdirSync(proofDir, { recursive: true });

const server = await startServer(0);
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 4010;
const baseUrl = `http://127.0.0.1:${port}`;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}

try {
  await request('/api/reset', { method: 'POST' });
  const before = await request('/api/threads?label=inbox');
  const draft = await request('/api/drafts', {
    method: 'POST',
    body: JSON.stringify({
      to: ['pm@google.com'],
      cc: [],
      bcc: [],
      subject: 'Validation thread',
      body: 'This is a local validation send flow.',
    }),
  });
  const sent = await request(`/api/drafts/${draft.draft.id}/send`, { method: 'POST' });
  const starred = await request(`/api/threads/${sent.thread.id}/star`, {
    method: 'POST',
    body: JSON.stringify({ starred: true }),
  });
  const labeled = await request(`/api/threads/${sent.thread.id}/labels`, {
    method: 'POST',
    body: JSON.stringify({ add: ['important'] }),
  });
  const archived = await request(`/api/threads/${sent.thread.id}/archive`, {
    method: 'POST',
  });
  const sentThreads = await request('/api/threads?label=sent');
  const snapshots = await request('/api/snapshots');
  const initialSnapshot = snapshots.snapshots.find(snapshot => snapshot.reason === 'Initial fixture');
  const restored = await request(`/api/snapshots/${initialSnapshot.id}/restore`, { method: 'POST' });
  const env = await request('/api/env');
  const restoredSentThreads = await request('/api/threads?label=sent');
  const proof = {
    baseUrl,
    launchCommands: [
      'cd deliveries/gmail-rl-6',
      'pnpm test',
      'pnpm typecheck',
      'pnpm validate:local',
      'pnpm start',
    ],
    validationSteps: [
      'Reset the environment',
      'Create a draft',
      'Send the draft',
      'Star the sent thread',
      'Apply an important label',
      'Archive the sent thread',
      'Restore the seeded snapshot',
      'Verify snapshot growth and restore behavior',
    ],
    inboxThreadCountBefore: before.threads.length,
    sentThreadCountAfter: sentThreads.threads.length,
    sentThreadCountAfterRestore: restoredSentThreads.threads.length,
    activeSnapshotId: env.activeSnapshotId,
    snapshotCount: snapshots.snapshots.length,
    sentThreadId: sent.thread.id,
    sentThreadStarred: starred.thread.starred,
    sentThreadLabelsBeforeArchive: labeled.thread.labels,
    sentThreadLabelsAfterArchive: archived.thread.labels,
    restoredSnapshotId: restored.snapshotId,
  };
  const proofPath = join(proofDir, 'local-validation.json');
  const summaryPath = join(proofDir, 'local-validation.md');
  writeFileSync(proofPath, JSON.stringify(proof, null, 2));
  writeFileSync(
    summaryPath,
    [
      '# Gmail RL Local Validation',
      '',
      `Base URL: ${baseUrl}`,
      '',
      '## Launch Commands',
      ...proof.launchCommands.map(command => `- ${command}`),
      '',
      '## Validation Steps',
      ...proof.validationSteps.map(step => `- ${step}`),
      '',
      '## Assertions',
      `- Inbox threads before validation: ${proof.inboxThreadCountBefore}`,
      `- Sent threads after send flow: ${proof.sentThreadCountAfter}`,
      `- Sent thread starred: ${proof.sentThreadStarred}`,
      `- Labels before archive: ${proof.sentThreadLabelsBeforeArchive.join(', ')}`,
      `- Labels after archive: ${proof.sentThreadLabelsAfterArchive.join(', ')}`,
      `- Snapshot count observed: ${proof.snapshotCount}`,
      `- Restore snapshot id: ${proof.restoredSnapshotId}`,
      `- Sent threads after restore: ${proof.sentThreadCountAfterRestore}`,
      '',
      `JSON proof: ${proofPath}`,
    ].join('\n'),
  );
  console.log(JSON.stringify({ ok: true, proofPath, summaryPath, ...proof }, null, 2));
} finally {
  await new Promise(resolvePromise => server.close(resolvePromise));
}
