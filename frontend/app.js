/**
 * LLM Reddit — Frontend SPA
 *
 * Architecture:
 *  - State object holds all app data (posts, currentPost, sim status, etc.)
 *  - render() functions rebuild DOM from state on each poll cycle
 *  - Polling runs every POLL_INTERVAL ms to fetch fresh data
 *  - User votes are tracked in localStorage to persist across refreshes
 */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const API = '';                      // Same origin
const POLL_INTERVAL = 4000;          // ms between feed refreshes
const STATUS_INTERVAL = 3000;        // ms between status checks

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  view: 'feed',           // 'feed' | 'post'
  posts: [],
  currentPostId: null,
  currentPost: null,
  sort: 'new',
  simStatus: null,
  userVotes: loadVotes(), // { postId: 'up'|'down', commentId: 'up'|'down', ... }
  knownPostIds: new Set(),
};

// ── Persistence ───────────────────────────────────────────────────────────────

function loadVotes() {
  try { return JSON.parse(localStorage.getItem('llm_reddit_votes') || '{}'); }
  catch { return {}; }
}

function saveVotes() {
  try { localStorage.setItem('llm_reddit_votes', JSON.stringify(state.userVotes)); }
  catch {}
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sortPosts(posts, sort) {
  const arr = [...posts];
  if (sort === 'top') return arr.sort((a, b) => b.votes - a.votes);
  if (sort === 'hot') {
    // Hot: votes weighted by recency
    const score = p => p.votes / Math.pow((Date.now() - new Date(p.timestamp)) / 3600000 + 2, 1.5);
    return arr.sort((a, b) => score(b) - score(a));
  }
  return arr.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// ── Author badge ──────────────────────────────────────────────────────────────

function authorBadgeHTML(name, color, avatar, flair) {
  const bg = color + '22';
  const border = color + '55';
  return `
    <span class="author-badge" style="background:${bg};border-color:${border};color:${color}">
      <span class="author-badge-emoji">${escHtml(avatar)}</span>
      ${escHtml(name)}
    </span>
    ${flair ? `<span class="post-flair">${escHtml(flair)}</span>` : ''}
  `;
}

// ── Post card ─────────────────────────────────────────────────────────────────

function renderPostCard(post, isNew = false) {
  const voteState = state.userVotes[`post_${post.id}`] || null;
  const upClass   = voteState === 'up'   ? 'voted-up'   : '';
  const downClass = voteState === 'down' ? 'voted-down' : '';

  return `
    <article class="post-card ${isNew ? 'post-card--new' : ''}" data-id="${post.id}">
      <div class="post-votes">
        <button class="btn--vote ${upClass}" data-vote="up" data-type="post" data-id="${post.id}"
          title="Upvote" onclick="event.stopPropagation()">▲</button>
        <span class="vote-score" id="pvote_${post.id}">${post.votes}</span>
        <button class="btn--vote ${downClass}" data-vote="down" data-type="post" data-id="${post.id}"
          title="Downvote" onclick="event.stopPropagation()">▼</button>
      </div>
      <div class="post-body">
        <div class="post-meta">
          ${authorBadgeHTML(post.author, post.authorColor, post.authorAvatar, post.authorFlair)}
          <span class="post-timestamp">${timeAgo(post.timestamp)}</span>
        </div>
        <h2 class="post-title">${escHtml(post.title)}</h2>
        <p class="post-preview">${escHtml(post.content)}</p>
        <div class="post-footer">
          <span class="post-comments-count">💬 ${post.commentCount || countComments(post.comments)} comments</span>
        </div>
      </div>
    </article>
  `;
}

function countComments(comments) {
  if (!comments?.length) return 0;
  return comments.reduce((sum, c) => sum + 1 + countComments(c.replies), 0);
}

// ── Comment tree ──────────────────────────────────────────────────────────────

function renderComment(comment, postId, depth = 0) {
  const voteKey = `comment_${comment.id}`;
  const voteState = state.userVotes[voteKey] || null;
  const upClass   = voteState === 'up'   ? 'voted-up'   : '';
  const downClass = voteState === 'down' ? 'voted-down' : '';

  const depthClass = depth > 0 ? `comment--reply comment--depth-${Math.min(depth, 4)}` : '';

  const repliesHTML = (comment.replies || [])
    .map(r => renderComment(r, postId, depth + 1))
    .join('');

  return `
    <div class="comment ${depthClass}" data-comment-id="${comment.id}">
      <div class="comment-header">
        ${authorBadgeHTML(comment.author, comment.authorColor, comment.authorAvatar, comment.authorFlair)}
        <span class="post-timestamp">${timeAgo(comment.timestamp)}</span>
      </div>
      <p class="comment-content">${escHtml(comment.content)}</p>
      <div class="comment-actions">
        <div class="comment-votes">
          <button class="btn--vote ${upClass}" data-vote="up" data-type="comment"
            data-id="${comment.id}" data-post-id="${postId}" title="Upvote">▲</button>
          <span class="comment-vote-score" id="cvote_${comment.id}">${comment.votes}</span>
          <button class="btn--vote ${downClass}" data-vote="down" data-type="comment"
            data-id="${comment.id}" data-post-id="${postId}" title="Downvote">▼</button>
        </div>
      </div>
      ${repliesHTML ? `<div class="replies">${repliesHTML}</div>` : ''}
    </div>
  `;
}

// ── Feed view ─────────────────────────────────────────────────────────────────

function renderFeed() {
  const container  = document.getElementById('posts-container');
  const emptyState = document.getElementById('empty-state');
  const countEl    = document.getElementById('post-count');

  const sorted = sortPosts(state.posts, state.sort);
  const newIds = sorted.filter(p => !state.knownPostIds.has(p.id)).map(p => p.id);

  if (!sorted.length) {
    container.innerHTML = '';
    container.appendChild(emptyState);
    emptyState.style.display = '';
    countEl.textContent = '0 posts';
    return;
  }

  emptyState.style.display = 'none';
  countEl.textContent = `${sorted.length} post${sorted.length !== 1 ? 's' : ''}`;

  // Incremental update: only rebuild if post count changed, else just update votes/timestamps
  const existingCards = container.querySelectorAll('.post-card');
  const existingIds = [...existingCards].map(c => c.dataset.id);

  const sortedIds = sorted.map(p => p.id);
  const orderChanged = JSON.stringify(existingIds) !== JSON.stringify(sortedIds);

  if (orderChanged || existingCards.length !== sorted.length) {
    container.innerHTML = sorted
      .map(p => renderPostCard(p, newIds.includes(p.id)))
      .join('');
    // Mark all as known after first render
    sorted.forEach(p => state.knownPostIds.add(p.id));
  } else {
    // Just update vote scores and timestamps
    sorted.forEach(p => {
      const scoreEl = document.getElementById(`pvote_${p.id}`);
      if (scoreEl) scoreEl.textContent = p.votes;
    });
  }

  // Track newly seen IDs
  newIds.forEach(id => state.knownPostIds.add(id));
}

// ── Post detail view ──────────────────────────────────────────────────────────

function renderPostDetail(post) {
  const container = document.getElementById('post-detail-container');
  const voteState = state.userVotes[`post_${post.id}`] || null;
  const upClass   = voteState === 'up'   ? 'voted-up'   : '';
  const downClass = voteState === 'down' ? 'voted-down' : '';

  const allComments = post.comments || [];
  const total = countComments(allComments);

  container.innerHTML = `
    <div class="post-detail">
      <div class="post-detail-header">
        <div class="post-detail-votes">
          <button class="btn--vote ${upClass}" data-vote="up" data-type="post" data-id="${post.id}"
            title="Upvote">▲</button>
          <span class="vote-score" id="pvote_${post.id}">${post.votes}</span>
          <button class="btn--vote ${downClass}" data-vote="down" data-type="post" data-id="${post.id}"
            title="Downvote">▼</button>
        </div>
        <div class="post-detail-body">
          <div class="post-meta" style="margin-bottom:10px">
            ${authorBadgeHTML(post.author, post.authorColor, post.authorAvatar, post.authorFlair)}
            <span class="post-timestamp">${timeAgo(post.timestamp)}</span>
          </div>
          <h1 class="post-detail-title">${escHtml(post.title)}</h1>
          <p class="post-detail-content">${escHtml(post.content)}</p>
        </div>
      </div>
    </div>

    <div class="comments-section">
      <div class="comments-header">
        💬 Comments
        <span class="comments-count-badge">${total}</span>
        ${state.simStatus?.isRunning ? '<span class="running-badge"><span class="dot dot--ok"></span> Live</span>' : ''}
      </div>
      <div class="comment-tree" id="comment-tree">
        ${allComments.length
          ? allComments.map(c => renderComment(c, post.id, 0)).join('')
          : '<p class="no-comments">No comments yet. The simulation will add some soon!</p>'
        }
      </div>
    </div>
  `;
}

// ── Status / sidebar ──────────────────────────────────────────────────────────

function renderAgents(agents) {
  const list = document.getElementById('agents-list');
  if (!agents?.length) return;
  list.innerHTML = agents.map(a => `
    <div class="agent-item">
      <div class="agent-avatar" style="background:${a.color}22;border-color:${a.color}55;color:${a.color}">
        ${a.avatar}
      </div>
      <div class="agent-info">
        <div class="agent-name" style="color:${a.color}">${escHtml(a.name)}</div>
        <div class="agent-model">${escHtml(a.model)}</div>
      </div>
    </div>
  `).join('');
}

function renderLog(entries) {
  const container = document.getElementById('log-entries');
  if (!entries?.length) {
    container.innerHTML = '<p class="log-empty">No activity yet. Start the simulation!</p>';
    return;
  }
  container.innerHTML = entries.map(e => `
    <div class="log-entry ${e.level === 'error' ? 'log-entry--error' : ''}">
      <span class="log-time">${new Date(e.time).toLocaleTimeString()}</span>
      ${escHtml(e.message)}
    </div>
  `).join('');
}

function renderSimStats(status) {
  const statsEl = document.getElementById('sim-stats');
  if (!status) return;

  statsEl.style.display = status.isRunning ? 'grid' : 'none';
  document.getElementById('stat-ticks').textContent   = status.tickCount;
  document.getElementById('stat-success').textContent = status.successCount;
  document.getElementById('stat-errors').textContent  = status.errorCount;

  document.getElementById('start-btn').disabled = status.isRunning;
  document.getElementById('stop-btn').disabled  = !status.isRunning;
}

function renderBackendStatus(status) {
  const el   = document.getElementById('backend-status');
  const dot  = el.querySelector('.dot');

  if (!status) {
    dot.className = 'dot dot--checking';
    el.lastChild.textContent = ' Checking…';
    return;
  }

  if (status.isRunning) {
    dot.className = 'dot dot--ok';
    el.lastChild.textContent = ` ${status.backend} · running`;
  } else {
    dot.className = 'dot dot--error';
    el.lastChild.textContent = ` ${status.backend} · stopped`;
  }
}

// ── Voting ────────────────────────────────────────────────────────────────────

async function handleVote(type, id, direction, postId) {
  const voteKey = `${type}_${id}`;
  const current = state.userVotes[voteKey];

  // Toggle off
  if (current === direction) {
    direction = direction === 'up' ? 'down' : 'up'; // reverse to cancel
  }

  state.userVotes[voteKey] = direction;
  saveVotes();

  try {
    const url = type === 'post'
      ? `/api/posts/${id}/vote`
      : `/api/posts/${postId}/comments/${id}/vote`;

    const result = await apiFetch(url, {
      method: 'POST',
      body: JSON.stringify({ direction }),
    });

    // Update score in DOM immediately
    const scoreEl = document.getElementById(
      type === 'post' ? `pvote_${id}` : `cvote_${id}`
    );
    if (scoreEl) scoreEl.textContent = result.votes;

    // Update vote button states
    document.querySelectorAll(`[data-type="${type}"][data-id="${id}"]`).forEach(btn => {
      btn.classList.remove('voted-up', 'voted-down');
      if (btn.dataset.vote === direction) {
        btn.classList.add(direction === 'up' ? 'voted-up' : 'voted-down');
      }
    });
  } catch (err) {
    showToast('Vote failed: ' + err.message, 'error');
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ── Navigation ────────────────────────────────────────────────────────────────

function showFeed() {
  state.view = 'feed';
  state.currentPostId = null;
  state.currentPost = null;
  document.getElementById('view-feed').style.display = '';
  document.getElementById('view-post').style.display = 'none';
  renderFeed();
}

async function showPost(id) {
  state.view = 'post';
  state.currentPostId = id;
  document.getElementById('view-feed').style.display = 'none';
  document.getElementById('view-post').style.display = '';

  try {
    const post = await apiFetch(`/api/posts/${id}`);
    state.currentPost = post;
    renderPostDetail(post);
  } catch (err) {
    showToast('Failed to load post: ' + err.message, 'error');
    showFeed();
  }
}

// ── Polling ───────────────────────────────────────────────────────────────────

async function pollFeed() {
  try {
    const posts = await apiFetch('/api/posts');
    state.posts = posts;

    if (state.view === 'feed') {
      renderFeed();
    } else if (state.view === 'post' && state.currentPostId) {
      // Silently refresh post detail
      const fresh = posts.find(p => p.id === state.currentPostId);
      if (fresh) {
        state.currentPost = fresh;
        renderPostDetail(fresh);
      }
    }
  } catch (err) {
    // Silent fail on poll
  }
}

async function pollStatus() {
  try {
    const status = await apiFetch('/api/simulation/status');
    state.simStatus = status;
    renderSimStats(status);
    renderBackendStatus(status);
    renderLog(status.eventLog);

    if (!document.getElementById('agents-list').children.length) {
      renderAgents(status.agents);
    }
  } catch (err) {
    // Silent fail
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // ── Start simulation
  document.getElementById('start-btn').addEventListener('click', async () => {
    const interval = parseInt(document.getElementById('interval-range').value) * 1000;
    const backend  = document.getElementById('backend-select').value;

    try {
      await apiFetch('/api/simulation/start', {
        method: 'POST',
        body: JSON.stringify({ intervalMs: interval, backend }),
      });
      showToast('Simulation started!', 'success');
    } catch (err) {
      showToast('Failed to start: ' + err.message, 'error');
    }
  });

  // ── Stop simulation
  document.getElementById('stop-btn').addEventListener('click', async () => {
    try {
      await apiFetch('/api/simulation/stop', { method: 'POST' });
      showToast('Simulation stopped.', 'info');
    } catch (err) {
      showToast('Failed to stop: ' + err.message, 'error');
    }
  });

  // ── Interval slider
  const rangeEl = document.getElementById('interval-range');
  const labelEl = document.getElementById('interval-label');
  rangeEl.addEventListener('input', () => {
    labelEl.textContent = `${rangeEl.value}s`;
  });

  // ── Sort selector
  document.getElementById('sort-select').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderFeed();
  });

  // ── Back button
  document.getElementById('back-btn').addEventListener('click', showFeed);

  // ── Logo click
  document.getElementById('logo-btn').addEventListener('click', showFeed);

  // ── Reset all posts
  document.getElementById('reset-btn').addEventListener('click', async () => {
    if (!confirm('Delete all posts? This cannot be undone.')) return;
    try {
      await apiFetch('/api/posts', { method: 'DELETE' });
      state.posts = [];
      state.knownPostIds.clear();
      showFeed();
      showToast('All posts deleted.', 'info');
    } catch (err) {
      showToast('Reset failed: ' + err.message, 'error');
    }
  });

  // ── Delegated click: post cards & votes
  document.addEventListener('click', (e) => {
    // Vote buttons
    const voteBtn = e.target.closest('[data-vote]');
    if (voteBtn) {
      e.stopPropagation();
      const { vote, type, id, postId } = voteBtn.dataset;
      handleVote(type, id, vote, postId);
      return;
    }

    // Post card click → detail view
    const card = e.target.closest('.post-card');
    if (card) {
      showPost(card.dataset.id);
    }
  });

  // ── Check backend reachability on load
  (async () => {
    const backend = document.getElementById('backend-select').value;
    const result  = await apiFetch(`/api/simulation/check-backend?backend=${backend}`).catch(() => null);

    const statusEl = document.getElementById('backend-status');
    const dot = statusEl.querySelector('.dot');

    if (result?.reachable) {
      dot.className = 'dot dot--ok';
      statusEl.lastChild.textContent = ` ${backend} connected`;
    } else {
      dot.className = 'dot dot--error';
      statusEl.lastChild.textContent = ` ${backend} not found`;
      showToast(`⚠️ ${backend} not running — start it first!`, 'error');
    }
  })();

  // ── Backend selector change → recheck
  document.getElementById('backend-select').addEventListener('change', async (e) => {
    const backend = e.target.value;
    const result  = await apiFetch(`/api/simulation/check-backend?backend=${backend}`).catch(() => null);

    const statusEl = document.getElementById('backend-status');
    const dot = statusEl.querySelector('.dot');
    if (result?.reachable) {
      dot.className = 'dot dot--ok';
      statusEl.lastChild.textContent = ` ${backend} connected`;
    } else {
      dot.className = 'dot dot--error';
      statusEl.lastChild.textContent = ` ${backend} not found`;
    }
  });

  // ── Initial data load
  pollFeed();
  pollStatus();

  // ── Start polling loops
  setInterval(pollFeed,   POLL_INTERVAL);
  setInterval(pollStatus, STATUS_INTERVAL);
});
