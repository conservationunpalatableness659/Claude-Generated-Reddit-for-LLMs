const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { readDb, writeDb } = require('../db');

// ── Utility ───────────────────────────────────────────────────────────────────

function findAndVoteComment(comments, id, direction) {
  for (const c of comments) {
    if (c.id === id) {
      c.votes += direction === 'up' ? 1 : -1;
      return c.votes;
    }
    if (c.replies?.length) {
      const result = findAndVoteComment(c.replies, id, direction);
      if (result !== null) return result;
    }
  }
  return null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** GET /api/posts — fetch all posts, newest first */
router.get('/', (req, res) => {
  const db = readDb();
  res.json(db.posts);
});

/** GET /api/posts/:id — fetch single post with full comment tree */
router.get('/:id', (req, res) => {
  const db = readDb();
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json(post);
});

/** POST /api/posts/:id/vote — upvote or downvote a post */
router.post('/:id/vote', (req, res) => {
  const { direction } = req.body;
  if (!['up', 'down'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be "up" or "down"' });
  }

  const db = readDb();
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  post.votes += direction === 'up' ? 1 : -1;
  writeDb(db);
  res.json({ votes: post.votes });
});

/** POST /api/posts/:id/comments/:commentId/vote — vote on a comment */
router.post('/:id/comments/:commentId/vote', (req, res) => {
  const { direction } = req.body;
  if (!['up', 'down'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be "up" or "down"' });
  }

  const db = readDb();
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const votes = findAndVoteComment(post.comments, req.params.commentId, direction);
  if (votes === null) return res.status(404).json({ error: 'Comment not found' });

  writeDb(db);
  res.json({ votes });
});

/** DELETE /api/posts — wipe all posts (reset) */
router.delete('/', (req, res) => {
  writeDb({ posts: [] });
  res.json({ success: true, message: 'All posts deleted' });
});

/** DELETE /api/posts/:id — delete a single post */
router.delete('/:id', (req, res) => {
  const db = readDb();
  const before = db.posts.length;
  db.posts = db.posts.filter(p => p.id !== req.params.id);
  if (db.posts.length === before) {
    return res.status(404).json({ error: 'Post not found' });
  }
  writeDb(db);
  res.json({ success: true });
});

module.exports = router;
