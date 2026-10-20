/*
 * db.js: a tiny document database stored in one JSON file.
 * Three collections (users, posts, comments). Every write is saved to disk
 * atomically (write a temp file, then rename), so a crash cannot corrupt the data.
 * Only this file knows about storage, so it can be swapped for SQLite or MongoDB later
 * without touching the routes.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class Database {
  /** @param {string|null} file path of the JSON file, or null to keep everything in memory (tests) */
  constructor(file) {
    this.file = file;
    this.data = { users: [], posts: [], comments: [] };
    if (file && fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = { users: parsed.users || [], posts: parsed.posts || [], comments: parsed.comments || [] };
    } else if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      this._save();
    }
  }

  _save() {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  newId() { return crypto.randomUUID(); }

  /* ---- users ---- */
  findUserById(id) { return this.data.users.find((u) => u.id === id) || null; }
  findUserByEmail(email) { return this.data.users.find((u) => u.email === email) || null; }
  findUserByUsername(name) {
    const n = String(name).toLowerCase();
    return this.data.users.find((u) => u.username.toLowerCase() === n) || null;
  }
  addUser({ username, email, passwordHash }) {
    const user = { id: this.newId(), username, email, passwordHash, createdAt: new Date().toISOString() };
    this.data.users.push(user);
    this._save();
    return user;
  }

  /* ---- posts ---- */
  findPost(id) { return this.data.posts.find((p) => p.id === id) || null; }
  allPosts() { return this.data.posts; }
  addPost({ authorId, title, body, tags }) {
    const now = new Date().toISOString();
    const post = { id: this.newId(), authorId, title, body, tags, createdAt: now, updatedAt: now };
    this.data.posts.push(post);
    this._save();
    return post;
  }
  updatePost(id, { title, body, tags }) {
    const post = this.findPost(id);
    if (!post) return null;
    Object.assign(post, { title, body, tags, updatedAt: new Date().toISOString() });
    this._save();
    return post;
  }
  deletePost(id) {
    const before = this.data.posts.length;
    this.data.posts = this.data.posts.filter((p) => p.id !== id);
    this.data.comments = this.data.comments.filter((c) => c.postId !== id); // no orphan comments
    this._save();
    return this.data.posts.length < before;
  }

  /* ---- comments ---- */
  findComment(id) { return this.data.comments.find((c) => c.id === id) || null; }
  commentsFor(postId) { return this.data.comments.filter((c) => c.postId === postId); }
  addComment({ postId, userId, name, body }) {
    const c = { id: this.newId(), postId, userId: userId || null, name, body, createdAt: new Date().toISOString() };
    this.data.comments.push(c);
    this._save();
    return c;
  }
  deleteComment(id) {
    const before = this.data.comments.length;
    this.data.comments = this.data.comments.filter((c) => c.id !== id);
    this._save();
    return this.data.comments.length < before;
  }
}

module.exports = { Database };
