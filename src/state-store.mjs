import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function isoNow() {
  return new Date().toISOString();
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
}

export class GmailStateStore {
  constructor({ fixturePath, statePath }) {
    this.fixturePath = fixturePath;
    this.statePath = statePath;
    this.envelope = this.loadEnvelope();
  }

  loadFixture() {
    return JSON.parse(readFileSync(this.fixturePath, 'utf8'));
  }

  loadEnvelope() {
    ensureDir(this.statePath);
    if (existsSync(this.statePath)) {
      return JSON.parse(readFileSync(this.statePath, 'utf8'));
    }

    const fixture = this.loadFixture();
    const createdAt = isoNow();
    const envelope = {
      schemaVersion: 1,
      createdAt,
      updatedAt: createdAt,
      activeSnapshotId: 'snapshot-1',
      snapshots: [
        {
          id: 'snapshot-1',
          createdAt,
          reason: 'Initial fixture',
          state: fixture,
        },
      ],
    };

    this.persistEnvelope(envelope);
    return envelope;
  }

  persistEnvelope(envelope = this.envelope) {
    envelope.updatedAt = isoNow();
    ensureDir(this.statePath);
    writeFileSync(this.statePath, JSON.stringify(envelope, null, 2));
    this.envelope = envelope;
  }

  currentSnapshot() {
    return this.envelope.snapshots.find(snapshot => snapshot.id === this.envelope.activeSnapshotId);
  }

  currentState() {
    const snapshot = this.currentSnapshot();
    if (!snapshot) {
      throw new Error('Active snapshot missing');
    }
    return deepClone(snapshot.state);
  }

  nextSnapshotNumber() {
    return this.envelope.snapshots.reduce((maxSnapshotNumber, snapshot) => {
      const match = /^snapshot-(\d+)$/.exec(snapshot.id);
      const snapshotNumber = match ? Number(match[1]) : 0;
      return Math.max(maxSnapshotNumber, snapshotNumber);
    }, 0) + 1;
  }

  createSnapshot(reason, state) {
    const nextSnapshotNumber = this.nextSnapshotNumber();
    const snapshotId = `snapshot-${nextSnapshotNumber}`;
    state.nextIds.snapshot = Math.max(state.nextIds.snapshot, nextSnapshotNumber + 1);
    const snapshot = {
      id: snapshotId,
      createdAt: isoNow(),
      reason,
      state: deepClone(state),
    };
    this.envelope.snapshots.push(snapshot);
    this.envelope.activeSnapshotId = snapshotId;
    this.persistEnvelope();
    return snapshot;
  }

  listSnapshots() {
    return this.envelope.snapshots
      .map(snapshot => ({
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        reason: snapshot.reason,
        active: snapshot.id === this.envelope.activeSnapshotId,
      }))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  getMetadata() {
    const state = this.currentState();
    return {
      app: 'gmail-rl',
      user: state.user,
      activeSnapshotId: this.envelope.activeSnapshotId,
      snapshotCount: this.envelope.snapshots.length,
      threadCount: state.threads.length,
      draftCount: state.drafts.length,
    };
  }

  listLabels() {
    return this.currentState().labels;
  }

  listDrafts() {
    return this.currentState().drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  findThread(threadId, state = this.currentState()) {
    return state.threads.find(thread => thread.id === threadId) ?? null;
  }

  summarizeThread(thread, state) {
    const messages = thread.messageIds
      .map(messageId => state.messages.find(message => message.id === messageId))
      .filter(Boolean);
    const latestMessage = messages[messages.length - 1];
    return {
      id: thread.id,
      subject: thread.subject,
      participants: thread.participants,
      labels: thread.labels,
      unread: thread.unread,
      starred: thread.starred,
      lastUpdatedAt: thread.lastUpdatedAt,
      snippet: latestMessage ? latestMessage.body.slice(0, 140) : '',
    };
  }

  matchesQuery(thread, state, query) {
    if (!query) {
      return true;
    }
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    const messages = thread.messageIds
      .map(messageId => state.messages.find(message => message.id === messageId))
      .filter(Boolean);
    const haystacks = [thread.subject, ...thread.participants, ...messages.map(message => message.body)];
    return haystacks.some(value => String(value).toLowerCase().includes(needle));
  }

  listThreads({ label, query }) {
    const state = this.currentState();
    const normalizedLabel = label && label !== 'all' ? label : null;
    return state.threads
      .filter(thread => {
        if (normalizedLabel === 'starred') {
          return thread.starred;
        }
        if (normalizedLabel) {
          return thread.labels.includes(normalizedLabel);
        }
        return true;
      })
      .filter(thread => this.matchesQuery(thread, state, query))
      .map(thread => this.summarizeThread(thread, state))
      .sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt));
  }

  getThread(threadId) {
    const state = this.currentState();
    const thread = this.findThread(threadId, state);
    if (!thread) {
      return null;
    }
    const messages = thread.messageIds
      .map(messageId => state.messages.find(message => message.id === messageId))
      .filter(Boolean);
    return {
      ...this.summarizeThread(thread, state),
      messages,
    };
  }

  mutate(reason, mutator) {
    const state = this.currentState();
    const result = mutator(state);
    const snapshot = this.createSnapshot(reason, state);
    return { snapshot, result, state };
  }

  createDraft(input) {
    return this.mutate('Create draft', state => {
      const draftId = `draft-${state.nextIds.draft}`;
      state.nextIds.draft += 1;
      const timestamp = isoNow();
      const draft = {
        id: draftId,
        to: normalizeList(input.to),
        cc: normalizeList(input.cc),
        bcc: normalizeList(input.bcc),
        subject: String(input.subject ?? ''),
        body: String(input.body ?? ''),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.drafts.unshift(draft);
      return draft;
    }).result;
  }

  updateDraft(draftId, input) {
    const result = this.mutate('Update draft', state => {
      const draft = state.drafts.find(entry => entry.id === draftId);
      if (!draft) {
        return null;
      }
      draft.to = normalizeList(input.to);
      draft.cc = normalizeList(input.cc);
      draft.bcc = normalizeList(input.bcc);
      draft.subject = String(input.subject ?? '');
      draft.body = String(input.body ?? '');
      draft.updatedAt = isoNow();
      return draft;
    }).result;
    return result;
  }

  sendDraft(draftId) {
    const mutation = this.mutate('Send draft', state => {
      const draftIndex = state.drafts.findIndex(entry => entry.id === draftId);
      if (draftIndex === -1) {
        return null;
      }
      const draft = state.drafts[draftIndex];
      state.drafts.splice(draftIndex, 1);
      const threadId = `thread-${state.nextIds.thread}`;
      state.nextIds.thread += 1;
      const messageId = `message-${state.nextIds.message}`;
      state.nextIds.message += 1;
      const sentAt = isoNow();
      const message = {
        id: messageId,
        threadId,
        from: state.user.primaryEmail,
        to: normalizeList(draft.to),
        cc: normalizeList(draft.cc),
        sentAt,
        body: draft.body,
      };
      state.messages.push(message);
      const participants = Array.from(new Set([state.user.primaryEmail, ...message.to, ...message.cc]));
      const thread = {
        id: threadId,
        subject: draft.subject || '(no subject)',
        participants,
        messageIds: [messageId],
        labels: ['sent'],
        unread: false,
        starred: false,
        lastUpdatedAt: sentAt,
      };
      state.threads.unshift(thread);
      return { thread, message };
    });
    if (!mutation.result) {
      return null;
    }
    return this.getThread(mutation.result.thread.id);
  }

  setStarred(threadId, starred) {
    const result = this.mutate(starred ? 'Star thread' : 'Unstar thread', state => {
      const thread = this.findThread(threadId, state);
      if (!thread) {
        return null;
      }
      thread.starred = Boolean(starred);
      return thread;
    }).result;
    return result ? this.getThread(threadId) : null;
  }

  archiveThread(threadId) {
    const result = this.mutate('Archive thread', state => {
      const thread = this.findThread(threadId, state);
      if (!thread) {
        return null;
      }
      thread.labels = thread.labels.filter(label => label !== 'inbox');
      if (!thread.labels.includes('archive')) {
        thread.labels.push('archive');
      }
      return thread;
    }).result;
    return result ? this.getThread(threadId) : null;
  }

  setUnread(threadId, unread) {
    const result = this.mutate(unread ? 'Mark unread' : 'Mark read', state => {
      const thread = this.findThread(threadId, state);
      if (!thread) {
        return null;
      }
      thread.unread = Boolean(unread);
      return thread;
    }).result;
    return result ? this.getThread(threadId) : null;
  }

  updateLabels(threadId, { add = [], remove = [] }) {
    const result = this.mutate('Update labels', state => {
      const thread = this.findThread(threadId, state);
      if (!thread) {
        return null;
      }
      const nextLabels = new Set(thread.labels);
      for (const label of normalizeList(add)) {
        nextLabels.add(label);
      }
      for (const label of normalizeList(remove)) {
        nextLabels.delete(label);
      }
      thread.labels = Array.from(nextLabels);
      return thread;
    }).result;
    return result ? this.getThread(threadId) : null;
  }

  reset() {
    const fixture = this.loadFixture();
    return this.createSnapshot('Reset to seeded fixture', fixture);
  }

  restoreSnapshot(snapshotId) {
    const snapshot = this.envelope.snapshots.find(entry => entry.id === snapshotId);
    if (!snapshot) {
      return null;
    }
    const restoredState = deepClone(snapshot.state);
    return this.createSnapshot(`Restore ${snapshotId}`, restoredState);
  }
}
