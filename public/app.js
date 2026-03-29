const state = {
  env: null,
  labels: [],
  threads: [],
  drafts: [],
  snapshots: [],
  selectedLabel: 'inbox',
  selectedThreadId: null,
  selectedThread: null,
  search: '',
};

const elements = {
  labelList: document.querySelector('#label-list'),
  snapshotList: document.querySelector('#snapshot-list'),
  threadList: document.querySelector('#thread-list'),
  draftList: document.querySelector('#draft-list'),
  threadDetail: document.querySelector('#thread-detail'),
  searchInput: document.querySelector('#search-input'),
  metaPill: document.querySelector('#meta-pill'),
  composeDialog: document.querySelector('#compose-dialog'),
  composeForm: document.querySelector('#compose-form'),
  composeButton: document.querySelector('#compose-button'),
  closeCompose: document.querySelector('#close-compose'),
  resetButton: document.querySelector('#reset-button'),
  listTitle: document.querySelector('#list-title'),
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function commaList(value) {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

async function loadData() {
  const [env, labelsResult, threadsResult, draftsResult, snapshotsResult] = await Promise.all([
    request('/api/env'),
    request('/api/labels'),
    request(`/api/threads?label=${encodeURIComponent(state.selectedLabel)}&q=${encodeURIComponent(state.search)}`),
    request('/api/drafts'),
    request('/api/snapshots'),
  ]);

  state.env = env;
  state.labels = labelsResult.labels;
  state.threads = threadsResult.threads;
  state.drafts = draftsResult.drafts;
  state.snapshots = snapshotsResult.snapshots;

  if (state.selectedThreadId) {
    try {
      const detail = await request(`/api/threads/${state.selectedThreadId}`);
      state.selectedThread = detail.thread;
    } catch {
      state.selectedThread = null;
      state.selectedThreadId = null;
    }
  }

  render();
}

function renderLabels() {
  const draftCount = state.drafts.length;
  const items = [
    ...state.labels,
    { id: 'drafts', name: `Drafts (${draftCount})`, kind: 'system' },
  ];
  elements.labelList.innerHTML = '';
  for (const label of items) {
    const button = document.createElement('button');
    button.className = `label-item${state.selectedLabel === label.id ? ' active' : ''}`;
    button.innerHTML = `<span>${label.name}</span><span class="muted">${label.kind}</span>`;
    button.addEventListener('click', async () => {
      state.selectedLabel = label.id;
      state.selectedThreadId = null;
      state.selectedThread = null;
      await loadData();
    });
    elements.labelList.appendChild(button);
  }
}

function renderSnapshots() {
  elements.snapshotList.innerHTML = '';
  for (const snapshot of state.snapshots.slice(0, 8)) {
    const button = document.createElement('button');
    button.className = 'snapshot-item';
    button.innerHTML = `
      <div class="snapshot-header">
        <strong>${snapshot.id}</strong>
        <span class="muted">${snapshot.active ? 'Active' : 'Restore'}</span>
      </div>
      <div class="snapshot-reason">${snapshot.reason}</div>
      <div class="muted">${new Date(snapshot.createdAt).toLocaleString()}</div>
    `;
    button.disabled = snapshot.active;
    button.addEventListener('click', async () => {
      await request(`/api/snapshots/${snapshot.id}/restore`, { method: 'POST' });
      await loadData();
    });
    elements.snapshotList.appendChild(button);
  }
}

function renderThreads() {
  const viewingDrafts = state.selectedLabel === 'drafts';
  elements.threadList.classList.toggle('hidden', viewingDrafts);
  elements.draftList.classList.toggle('hidden', !viewingDrafts);
  elements.listTitle.textContent = viewingDrafts ? 'Drafts' : state.selectedLabel;

  if (viewingDrafts) {
    elements.draftList.innerHTML = '';
    for (const draft of state.drafts) {
      const card = document.createElement('article');
      card.className = 'draft-card';
      card.innerHTML = `
        <div class="draft-header">
          <strong>${draft.subject || '(no subject)'}</strong>
          <span class="muted">${new Date(draft.updatedAt).toLocaleString()}</span>
        </div>
        <div class="draft-meta">To: ${draft.to.join(', ') || 'No recipient'}</div>
        <p>${draft.body.slice(0, 120)}</p>
        <button class="compose-button">Send</button>
      `;
      card.querySelector('button').addEventListener('click', async () => {
        await request(`/api/drafts/${draft.id}/send`, { method: 'POST' });
        state.selectedLabel = 'sent';
        await loadData();
      });
      elements.draftList.appendChild(card);
    }
    return;
  }

  elements.threadList.innerHTML = '';
  for (const thread of state.threads) {
    const card = document.createElement('article');
    card.className = `thread-card${thread.unread ? ' unread' : ''}${state.selectedThreadId === thread.id ? ' active' : ''}`;
    card.innerHTML = `
      <div class="thread-header">
        <strong>${thread.participants.join(', ')}</strong>
        <span class="muted">${new Date(thread.lastUpdatedAt).toLocaleDateString()}</span>
      </div>
      <div class="thread-subject">${thread.subject}${thread.starred ? ' ★' : ''}</div>
      <div class="thread-snippet">${thread.snippet}</div>
      <div class="muted">${thread.labels.join(', ')}</div>
    `;
    card.addEventListener('click', async () => {
      state.selectedThreadId = thread.id;
      const detail = await request(`/api/threads/${thread.id}`);
      state.selectedThread = detail.thread;
      renderDetail();
      renderThreads();
    });
    elements.threadList.appendChild(card);
  }
}

async function mutateThread(action, body) {
  if (!state.selectedThreadId) {
    return;
  }
  await request(`/api/threads/${state.selectedThreadId}/${action}`, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
  await loadData();
}

function renderDetail() {
  if (!state.selectedThread) {
    elements.threadDetail.className = 'thread-detail empty-state';
    elements.threadDetail.textContent = 'Select a thread to inspect messages.';
    return;
  }

  const thread = state.selectedThread;
  const actions = document.querySelector('#thread-actions-template').content.cloneNode(true);
  const container = document.createElement('div');
  container.className = 'thread-detail';
  container.innerHTML = `
    <div>
      <h2>${thread.subject}</h2>
      <div class="muted">Labels: ${thread.labels.join(', ')}</div>
      <div class="muted">Unread: ${thread.unread ? 'Yes' : 'No'} | Starred: ${thread.starred ? 'Yes' : 'No'}</div>
    </div>
  `;
  container.appendChild(actions);
  const actionsNode = container.querySelector('.detail-actions');
  actionsNode.querySelector('[data-action="toggle-star"]').addEventListener('click', () => mutateThread('star', { starred: !thread.starred }));
  actionsNode.querySelector('[data-action="toggle-read"]').addEventListener('click', () => mutateThread('read', { unread: !thread.unread }));
  actionsNode.querySelector('[data-action="archive"]').addEventListener('click', () => mutateThread('archive'));
  actionsNode.querySelector('[data-action="label-important"]').addEventListener('click', () => mutateThread('labels', { add: ['important'] }));

  for (const message of thread.messages) {
    const article = document.createElement('article');
    article.className = 'message-card';
    article.innerHTML = `
      <div class="message-meta">
        <strong>${message.from}</strong> to ${message.to.join(', ')}
      </div>
      <div class="muted">${new Date(message.sentAt).toLocaleString()}</div>
      <div class="message-body">${message.body}</div>
    `;
    container.appendChild(article);
  }

  elements.threadDetail.className = 'thread-detail';
  elements.threadDetail.replaceChildren(container);
}

function renderMeta() {
  elements.metaPill.textContent = `${state.env.threadCount} threads · ${state.env.draftCount} drafts · ${state.env.activeSnapshotId}`;
}

function render() {
  renderLabels();
  renderSnapshots();
  renderThreads();
  renderDetail();
  renderMeta();
}

elements.searchInput.addEventListener('input', async event => {
  state.search = event.target.value;
  await loadData();
});

elements.composeButton.addEventListener('click', () => {
  elements.composeForm.reset();
  elements.composeDialog.showModal();
});

elements.closeCompose.addEventListener('click', () => {
  elements.composeDialog.close();
});

elements.composeForm.addEventListener('submit', async event => {
  event.preventDefault();
  const draft = {
    to: commaList(document.querySelector('#draft-to').value),
    cc: commaList(document.querySelector('#draft-cc').value),
    bcc: commaList(document.querySelector('#draft-bcc').value),
    subject: document.querySelector('#draft-subject').value,
    body: document.querySelector('#draft-body').value,
  };
  await request('/api/drafts', { method: 'POST', body: JSON.stringify(draft) });
  elements.composeDialog.close();
  state.selectedLabel = 'drafts';
  await loadData();
});

elements.resetButton.addEventListener('click', async () => {
  await request('/api/reset', { method: 'POST' });
  state.selectedThreadId = null;
  state.selectedThread = null;
  state.selectedLabel = 'inbox';
  await loadData();
});

loadData();
