/*
 * app.js: builds the Express application (routes, security, validation).
 * createApp() is separate from the code that starts listening, so tests can
 * start a fresh app with an in-memory database.
 */
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Database } = require('./db');
const V = require('../public/js/validate.js');

const COOKIE = 'inkwell_token';
const PAGE_SIZE = 6;

class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

/** Counts attempts per key inside a time window (in memory). */
function makeLimiter(max, windowMs) {
  const hits = new Map();
  return {
    tooMany(key) {
      const now = Date.now();
      const rec = hits.get(key);
      if (!rec || now > rec.reset) return false;
      return rec.count >= max;
    },
    hit(key) {
      const now = Date.now();
      const rec = hits.get(key);
      if (!rec || now > rec.reset) hits.set(key, { count: 1, reset: now + windowMs });
      else rec.count += 1;
    },
    clear(key) { hits.delete(key); },
  };
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function createApp(options = {}) {
  const {
    dbFile = null,
    jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
    bcryptCost = Number(process.env.BCRYPT_COST) || 10,
    production = process.env.NODE_ENV === 'production',
    loginLimit = 10,
  } = options;

  const db = new Database(dbFile);
  const app = express();
  app.disable('x-powered-by');
  if (production) app.set('trust proxy', 1);

  const loginLimiter = makeLimiter(loginLimit, 15 * 60 * 1000);
  const signupLimiter = makeLimiter(20, 60 * 60 * 1000);
  // A real hash to compare against when the email does not exist, so both cases take the same time.
  const dummyHash = bcrypt.hashSync('not-a-real-password-1', bcryptCost);

  /* ---------- security headers ---------- */
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Cache-Control': req.path.startsWith('/api/') ? 'no-store' : 'no-cache',
    });
    next();
  });

  app.use(express.json({ limit: '30kb' }));

  /* ---------- CSRF guard ----------
   * Every request that changes data must carry a custom header. A forged form on another site
   * cannot add custom headers without a CORS preflight (which we never allow). Together with the
   * SameSite=Strict cookie this blocks cross-site request forgery. */
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'inkwell') {
      return next(new HttpError(403, 'Missing X-Requested-With header.'));
    }
    next();
  });

  /* ---------- who is logged in? ---------- */
  app.use((req, res, next) => {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      try {
        const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
        req.user = db.findUserById(payload.sub); // a deleted user is no longer logged in
      } catch (e) { /* expired or tampered token = logged out */ }
    }
    next();
  });

  /** Route guard: only logged-in users pass. */
  const requireAuth = (req, res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in first.')));

  const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email });
  const authorOf = (id) => {
    const u = db.findUserById(id);
    return u ? { id: u.id, username: u.username } : { id: null, username: 'deleted user' };
  };

  function setSession(res, user) {
    const token = jwt.sign({ sub: user.id }, jwtSecret, { algorithm: 'HS256', expiresIn: '2d' });
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: production, maxAge: 2 * 24 * 3600 * 1000, path: '/' });
  }

  const validated = (result) => {
    if (!result.ok) throw new HttpError(400, 'Please fix the highlighted fields.', result.errors);
    return result.value;
  };

  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /* ---------- auth routes ---------- */
  app.post('/api/auth/signup', asyncH(async (req, res) => {
    if (signupLimiter.tooMany(req.ip)) throw new HttpError(429, 'Too many sign-ups. Try again later.');
    const { username, email, password } = validated(V.validateSignup(req.body));
    const taken = {};
    if (db.findUserByUsername(username)) taken.username = 'That username is already taken.';
    if (db.findUserByEmail(email)) taken.email = 'That email is already registered.';
    if (Object.keys(taken).length) throw new HttpError(409, 'Account already exists.', taken);
    signupLimiter.hit(req.ip);
    const passwordHash = await bcrypt.hash(password, bcryptCost);
    const user = db.addUser({ username, email, passwordHash });
    setSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  }));

  app.post('/api/auth/login', asyncH(async (req, res) => {
    const { email, password } = validated(V.validateLogin(req.body));
    const key = `${req.ip}|${email}`;
    if (loginLimiter.tooMany(key)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
    const user = db.findUserByEmail(email);
    const ok = await bcrypt.compare(password, user ? user.passwordHash : dummyHash);
    if (!user || !ok) {
      loginLimiter.hit(key);
      throw new HttpError(401, 'Incorrect email or password.'); // same message for both cases
    }
    loginLimiter.clear(key);
    setSession(res, user);
    res.json({ user: publicUser(user) });
  }));

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: production, path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

  /* ---------- posts ---------- */
  const excerpt = (body) => {
    const flat = body.replace(/\s+/g, ' ').trim();
    return flat.length > 170 ? `${flat.slice(0, 167).trimEnd()}...` : flat;
  };
  const summary = (p) => ({
    id: p.id, title: p.title, excerpt: excerpt(p.body), tags: p.tags, author: authorOf(p.authorId),
    createdAt: p.createdAt, updatedAt: p.updatedAt, commentCount: db.commentsFor(p.id).length,
  });
  const full = (p) => ({ ...summary(p), body: p.body });

  const getPostOr404 = (id) => {
    const post = db.findPost(id);
    if (!post) throw new HttpError(404, 'Post not found.');
    return post;
  };
  /** Only the author may change a post: 404 if missing, 403 if it is someone else's. */
  const ownPostOr403 = (req) => {
    const post = getPostOr404(req.params.id);
    if (post.authorId !== req.user.id) throw new HttpError(403, 'You can only change your own posts.');
    return post;
  };

  app.get('/api/posts', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 80);
    const tag = String(req.query.tag || '').trim().toLowerCase();
    const author = String(req.query.author || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const terms = q.split(/\s+/).filter(Boolean);

    let list = db.allPosts().filter((p) => {
      if (tag && !p.tags.includes(tag)) return false;
      if (author && authorOf(p.authorId).username.toLowerCase() !== author) return false;
      if (!terms.length) return true;
      const hay = `${p.title} ${p.body} ${p.tags.join(' ')} ${authorOf(p.authorId).username}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    list = list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(page, pages);
    res.json({ posts: list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map(summary), page: current, pages, total });
  });

  app.get('/api/posts/:id', (req, res) => res.json({ post: full(getPostOr404(req.params.id)) }));

  app.post('/api/posts', requireAuth, (req, res) => {
    const { title, body, tags } = validated(V.validatePost(req.body));
    const post = db.addPost({ authorId: req.user.id, title, body, tags });
    res.status(201).json({ post: full(post) });
  });

  app.put('/api/posts/:id', requireAuth, (req, res) => {
    const post = ownPostOr403(req);
    const { title, body, tags } = validated(V.validatePost(req.body));
    res.json({ post: full(db.updatePost(post.id, { title, body, tags })) });
  });

  app.delete('/api/posts/:id', requireAuth, (req, res) => {
    const post = ownPostOr403(req);
    db.deletePost(post.id);
    res.json({ ok: true });
  });

  /* ---------- comments (anyone can read and write) ---------- */
  const commentView = (c) => ({
    id: c.id, postId: c.postId, body: c.body, createdAt: c.createdAt,
    author: c.userId ? authorOf(c.userId).username : c.name, registered: Boolean(c.userId),
    authorId: c.userId,
  });

  app.get('/api/posts/:id/comments', (req, res) => {
    getPostOr404(req.params.id);
    const list = db.commentsFor(req.params.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    res.json({ comments: list.map(commentView) });
  });

  app.post('/api/posts/:id/comments', (req, res) => {
    const post = getPostOr404(req.params.id);
    const { body, name } = validated(V.validateComment(req.body, !req.user));
    const c = db.addComment({ postId: post.id, userId: req.user ? req.user.id : null, name: req.user ? req.user.username : name, body });
    res.status(201).json({ comment: commentView(c) });
  });

  /** A comment can be removed by whoever wrote it, or by the owner of the post. */
  app.delete('/api/comments/:id', requireAuth, (req, res) => {
    const c = db.findComment(req.params.id);
    if (!c) throw new HttpError(404, 'Comment not found.');
    const post = db.findPost(c.postId);
    const allowed = c.userId === req.user.id || (post && post.authorId === req.user.id);
    if (!allowed) throw new HttpError(403, 'You cannot delete this comment.');
    db.deleteComment(c.id);
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => next(new HttpError(404, 'Route not found.')));

  /* ---------- website files ---------- */
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  /* ---------- errors always come back as JSON ---------- */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || 500;
    let message = err.message;
    if (err.type === 'entity.parse.failed') { status = 400; message = 'Request body is not valid JSON.'; }
    else if (err.type === 'entity.too.large') { status = 413; message = 'Request body is too large.'; }
    else if (status === 500) { console.error(err); message = 'Something went wrong on the server.'; }
    res.status(status).json({ error: { message, ...(err.fields ? { fields: err.fields } : {}) } });
  });

  return { app, db };
}

module.exports = { createApp };
