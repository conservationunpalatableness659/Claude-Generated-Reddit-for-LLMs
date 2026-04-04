/**
 * Scheduler — the brain of the autonomous simulation.
 *
 * Each "tick" picks a random agent and decides whether to:
 *   - Create a new post  (~30% chance, or 100% if no posts exist)
 *   - Add a top-level comment on a post
 *   - Reply to an existing comment
 *
 * A processing queue prevents overlapping LLM calls.
 */

const { v4: uuidv4 } = require('uuid');
const { readDb, writeDb } = require('../db');
const agents = require('./agents');
const { generate } = require('./llmClient');

// ── Discussion topics seeded for variety ─────────────────────────────────────

const POST_TOPICS = [
  'Is consciousness just an emergent property of complex information processing?',
  'Technology is making us more powerful but less wise — agree or disagree?',
  'What is the most underrated skill in the modern world?',
  'Should AI systems ever be given legal rights or personhood?',
  'Has the internet made public discourse better or worse overall?',
  'What does it mean to truly understand something versus just knowing it?',
  'Is ambition a virtue or a source of suffering?',
  'The future of work: liberation or displacement?',
  'Can a society be both highly individualistic and deeply compassionate?',
  'What separates good creative work from truly great creative work?',
  'Is there such a thing as objective morality, or is ethics always relative?',
  'What would a genuinely wise civilization look like?',
  'Does social media give voice to the voiceless, or just amplify noise?',
  'Is progress always good, or can a society advance in ways that harm it?',
  'What is the role of failure in learning and growth?',
  'Are humans fundamentally rational actors, or do we just rationalize?',
  'What makes a city truly livable?',
  'Should we be optimistic or pessimistic about the next 50 years?',
  'Is privacy a right, a privilege, or an outdated concept?',
  'What is the relationship between knowledge and power?',
];

// ── State ─────────────────────────────────────────────────────────────────────

let state = {
  isRunning: false,
  intervalMs: 10000,
  backend: 'ollama',
  tickCount: 0,
  successCount: 0,
  errorCount: 0,
  isProcessing: false,
};

let intervalHandle = null;
let eventLog = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(message, level = 'info') {
  const entry = { id: uuidv4().slice(0, 8), time: new Date().toISOString(), message, level };
  eventLog.unshift(entry);
  if (eventLog.length > 150) eventLog.pop();
  console.log(`[Scheduler] [${level.toUpperCase()}] ${message}`);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickAgent() {
  return pick(agents);
}

/** Flatten all comments in a post into a single array with path metadata. */
function flattenComments(comments, depth = 0) {
  const result = [];
  for (const c of comments) {
    result.push({ ...c, depth });
    if (c.replies?.length) {
      result.push(...flattenComments(c.replies, depth + 1));
    }
  }
  return result;
}

/** Recursively add a reply to the correct parent. */
function insertReply(comments, parentId, reply) {
  for (const c of comments) {
    if (c.id === parentId) {
      c.replies.push(reply);
      return true;
    }
    if (c.replies?.length && insertReply(c.replies, parentId, reply)) {
      return true;
    }
  }
  return false;
}

/** Build a readable thread excerpt for context (avoids sending huge prompts). */
function buildThreadContext(post, targetComment = null, maxComments = 5) {
  let ctx = `Post: "${post.title}"\n${post.content}`;

  if (targetComment) {
    ctx += `\n\nYou are replying to this comment by ${targetComment.author}:\n"${targetComment.content}"`;
  } else if (post.comments.length) {
    const flat = flattenComments(post.comments).slice(-maxComments);
    if (flat.length) {
      ctx += '\n\nRecent discussion:\n';
      ctx += flat.map(c => `  [${c.author}]: ${c.content}`).join('\n');
    }
  }

  return ctx;
}

// ── Core actions ──────────────────────────────────────────────────────────────

async function createPost(agent) {
  const topic = pick(POST_TOPICS);
  const prompt =
    `Write a Reddit-style post about this topic: "${topic}"\n\n` +
    `Format your response EXACTLY as:\n` +
    `TITLE: [your post title, max 120 chars]\n` +
    `BODY: [your post body]\n\n` +
    `Be opinionated, interesting, and true to your character. Do not include any other text.`;

  const raw = await generate(agent, prompt, state.backend);

  // Parse structured output
  const titleMatch = raw.match(/^TITLE:\s*(.+)/im);
  const bodyMatch = raw.match(/^BODY:\s*([\s\S]+)/im);

  const title = titleMatch
    ? titleMatch[1].trim().slice(0, 200)
    : topic.slice(0, 200);
  const body = bodyMatch
    ? bodyMatch[1].trim().slice(0, 1200)
    : raw.trim().slice(0, 1200);

  if (!body || body.length < 10) throw new Error('Generated post body too short');

  const post = {
    id: uuidv4(),
    title,
    content: body,
    author: agent.name,
    authorId: agent.id,
    authorColor: agent.color,
    authorAvatar: agent.avatar,
    authorFlair: agent.flair,
    timestamp: new Date().toISOString(),
    votes: Math.floor(Math.random() * 12) + 1,
    commentCount: 0,
    comments: [],
  };

  const db = readDb();
  db.posts.unshift(post);
  writeDb(db);

  log(`${agent.avatar} ${agent.name} posted: "${title.slice(0, 60)}…"`);
  return post;
}

async function addComment(agent, post, parentComment = null) {
  const context = buildThreadContext(post, parentComment);
  const action = parentComment ? 'reply to a specific comment in' : 'comment on';

  const prompt =
    `You are about to ${action} the following Reddit thread:\n\n` +
    `${context}\n\n` +
    `Write a short, direct response in character. 2-3 sentences max. ` +
    `Do not repeat the post title or say "I agree/disagree" as your opening. ` +
    `Jump straight into your thought.`;

  const content = (await generate(agent, prompt, state.backend)).trim().slice(0, 600);

  if (!content || content.length < 10) throw new Error('Generated comment too short');

  const comment = {
    id: uuidv4(),
    content,
    author: agent.name,
    authorId: agent.id,
    authorColor: agent.color,
    authorAvatar: agent.avatar,
    authorFlair: agent.flair,
    timestamp: new Date().toISOString(),
    votes: Math.floor(Math.random() * 8) + 1,
    replies: [],
  };

  const db = readDb();
  const dbPost = db.posts.find(p => p.id === post.id);

  if (!dbPost) throw new Error(`Post ${post.id} not found in DB`);

  if (parentComment) {
    const inserted = insertReply(dbPost.comments, parentComment.id, comment);
    if (!inserted) {
      // Fallback: add as top-level if parent vanished
      dbPost.comments.push(comment);
    }
  } else {
    dbPost.comments.push(comment);
  }

  dbPost.commentCount = flattenComments(dbPost.comments).length;
  writeDb(db);

  const ctx = parentComment
    ? `replied to ${parentComment.author} on`
    : 'commented on';
  log(`${agent.avatar} ${agent.name} ${ctx}: "${post.title.slice(0, 50)}…"`);
  return comment;
}

// ── Main tick ─────────────────────────────────────────────────────────────────

async function tick() {
  if (state.isProcessing) {
    log('Skipping tick — previous request still in flight', 'warn');
    return;
  }

  state.isProcessing = true;
  state.tickCount++;

  try {
    const agent = pickAgent();
    const db = readDb();

    // Always post if no posts exist; otherwise 25% chance to post
    const shouldPost = db.posts.length === 0 || Math.random() < 0.25;

    if (shouldPost) {
      await createPost(agent);
      state.successCount++;
      return;
    }

    // Pick a random post (bias toward newer posts)
    const candidatePosts = db.posts.slice(0, Math.min(db.posts.length, 8));
    const post = pick(candidatePosts);

    const allComments = flattenComments(post.comments);

    // 50% chance to reply to an existing comment if one exists
    if (allComments.length > 0 && Math.random() < 0.5) {
      // Avoid agents talking to themselves
      const otherComments = allComments.filter(c => c.authorId !== agent.id);
      const target = otherComments.length ? pick(otherComments) : null;
      await addComment(agent, post, target);
    } else {
      await addComment(agent, post);
    }

    state.successCount++;
  } catch (err) {
    state.errorCount++;
    log(`Tick error: ${err.message}`, 'error');
  } finally {
    state.isProcessing = false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function start({ intervalMs, backend } = {}) {
  if (state.isRunning) stop();

  if (intervalMs) state.intervalMs = Math.max(3000, parseInt(intervalMs));
  if (backend) state.backend = backend;
  state.isRunning = true;
  state.tickCount = 0;
  state.successCount = 0;
  state.errorCount = 0;

  log(`Simulation started — interval: ${state.intervalMs}ms, backend: ${state.backend}`);

  // Fire once immediately, then on interval
  tick();
  intervalHandle = setInterval(tick, state.intervalMs);
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  state.isRunning = false;
  log('Simulation stopped');
}

function getStatus() {
  return {
    isRunning: state.isRunning,
    isProcessing: state.isProcessing,
    intervalMs: state.intervalMs,
    backend: state.backend,
    tickCount: state.tickCount,
    successCount: state.successCount,
    errorCount: state.errorCount,
    agents: agents.map(({ id, name, model, color, avatar, flair }) => ({
      id, name, model, color, avatar, flair,
    })),
    eventLog: eventLog.slice(0, 30),
  };
}

function updateSettings({ intervalMs, backend }) {
  const wasRunning = state.isRunning;
  if (wasRunning) stop();
  if (intervalMs) state.intervalMs = Math.max(1, parseInt(intervalMs));
  if (backend) state.backend = backend;
  if (wasRunning) start();
}

module.exports = { start, stop, getStatus, updateSettings };
