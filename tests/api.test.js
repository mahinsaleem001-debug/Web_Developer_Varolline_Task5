const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server/app');

/** Start a fresh app (in-memory database, fast bcrypt) on a random port. */
async function startServer(opts = {}) {
  const { app, db } = createApp({ dbFile: null, jwtSecret: 'test-secret', bcryptCost: 4, ...opts });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, db, close: () => new Promise((r) => server.close(r)) };
}

/** A tiny HTTP client that keeps cookies, like a browser. */
function client(base) {
  let cookie = '';
  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-Requested-With': 'inkwell' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, json, headers: res.headers, text };
  }
  return { get: (p) => call('GET', p), post: (p, b, h) => call('POST', p, b, h), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p), raw: call };
}

const USER = { username: 'mahin', email: 'mahin@example.com', password: 'secret123' };
const POST = { title: 'My first post', body: 'This is the body of my very first blog post.', tags: ['intro', 'hello'] };

async function signedUp(base, user = USER) {
  const c = client(base);
  const r = await c.post('/api/auth/signup', user);
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  return c;
}

test('signup hashes the password and logs the user in', async () => {
  const s = await startServer();
  try {
    const c = client(s.base);
    const r = await c.post('/api/auth/signup', USER);
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.user.username, 'mahin');
    assert.ok(!('passwordHash' in r.json.user) && !('password' in r.json.user));
    const stored = s.db.findUserByEmail(USER.email);
    assert.ok(stored.passwordHash.startsWith('$2'), 'bcrypt hash');
    assert.notStrictEqual(stored.passwordHash, USER.password);
    assert.ok(r.headers.get('set-cookie').includes('HttpOnly'));
    assert.ok(r.headers.get('set-cookie').includes('SameSite=Strict'));
    assert.strictEqual((await c.get('/api/auth/me')).json.user.email, USER.email);
  } finally { await s.close(); }
});

test('signup validates input on the server and rejects duplicates', async () => {
  const s = await startServer();
  try {
    const c = client(s.base);
    const bad = await c.post('/api/auth/signup', { username: 'x', email: 'bad', password: '1' });
    assert.strictEqual(bad.status, 400);
    assert.ok(bad.json.error.fields.username && bad.json.error.fields.email && bad.json.error.fields.password);
    await signedUp(s.base);
    const dup = await client(s.base).post('/api/auth/signup', { ...USER, username: 'MAHIN' });
    assert.strictEqual(dup.status, 409);
    assert.ok(dup.json.error.fields.username && dup.json.error.fields.email);
  } finally { await s.close(); }
});

test('login works, wrong credentials get one generic 401, logout clears the session', async () => {
  const s = await startServer();
  try {
    await signedUp(s.base);
    const c = client(s.base);
    const wrongPw = await c.post('/api/auth/login', { email: USER.email, password: 'wrongpass1' });
    const noUser = await c.post('/api/auth/login', { email: 'nobody@example.com', password: 'wrongpass1' });
    assert.strictEqual(wrongPw.status, 401);
    assert.strictEqual(noUser.status, 401);
    assert.strictEqual(wrongPw.json.error.message, noUser.json.error.message);
    assert.strictEqual((await c.post('/api/auth/login', { email: USER.email })).status, 400);
    assert.strictEqual((await c.post('/api/auth/login', { email: USER.email, password: USER.password })).status, 200);
    assert.ok((await c.get('/api/auth/me')).json.user);
    await c.post('/api/auth/logout', {});
    assert.strictEqual((await c.get('/api/auth/me')).json.user, null);
    assert.strictEqual((await c.post('/api/posts', POST)).status, 401);
  } finally { await s.close(); }
});

test('login is rate limited after repeated failures', async () => {
  const s = await startServer({ loginLimit: 3 });
  try {
    await signedUp(s.base);
    const c = client(s.base);
    for (let i = 0; i < 3; i++) assert.strictEqual((await c.post('/api/auth/login', { email: USER.email, password: 'wrongpass1' })).status, 401);
    assert.strictEqual((await c.post('/api/auth/login', { email: USER.email, password: USER.password })).status, 429);
  } finally { await s.close(); }
});

test('protected routes need login; forged or tampered cookies do not work', async () => {
  const s = await startServer();
  try {
    const anon = client(s.base);
    assert.strictEqual((await anon.post('/api/posts', POST)).status, 401);
    assert.strictEqual((await anon.put('/api/posts/x', POST)).status, 401);
    assert.strictEqual((await anon.del('/api/posts/x')).status, 401);
    assert.strictEqual((await anon.del('/api/comments/x')).status, 401);
    const forged = await anon.raw('POST', '/api/posts', POST, { Cookie: 'inkwell_token=abc.def.ghi' });
    assert.strictEqual(forged.status, 401);
  } finally { await s.close(); }
});

test('CSRF guard: changing data without the custom header is refused', async () => {
  const s = await startServer();
  try {
    const c = await signedUp(s.base);
    const r = await fetch(`${s.base}/api/posts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'x=1' }, body: JSON.stringify(POST) });
    assert.strictEqual(r.status, 403);
    assert.strictEqual((await c.post('/api/posts', POST)).status, 201);
  } finally { await s.close(); }
});

test('create, read, edit and delete a post as its author', async () => {
  const s = await startServer();
  try {
    const c = await signedUp(s.base);
    const created = await c.post('/api/posts', { ...POST, tags: 'Intro, #Hello' });
    assert.strictEqual(created.status, 201);
    const id = created.json.post.id;
    assert.deepStrictEqual(created.json.post.tags, ['intro', 'hello']);
    assert.strictEqual(created.json.post.author.username, 'mahin');

    const read = await client(s.base).get(`/api/posts/${id}`); // anyone can read
    assert.strictEqual(read.status, 200);
    assert.strictEqual(read.json.post.body, POST.body);

    const edited = await c.put(`/api/posts/${id}`, { title: 'Edited title', body: 'Edited body that is long enough.', tags: [] });
    assert.strictEqual(edited.status, 200);
    assert.strictEqual(edited.json.post.title, 'Edited title');
    assert.ok(edited.json.post.updatedAt >= created.json.post.createdAt);

    assert.strictEqual((await c.del(`/api/posts/${id}`)).status, 200);
    assert.strictEqual((await c.get(`/api/posts/${id}`)).status, 404);
  } finally { await s.close(); }
});

test('post input is validated on the server', async () => {
  const s = await startServer();
  try {
    const c = await signedUp(s.base);
    const r = await c.post('/api/posts', { title: 'a', body: 'b', tags: ['bad tag!'] });
    assert.strictEqual(r.status, 400);
    assert.ok(r.json.error.fields.title && r.json.error.fields.body && r.json.error.fields.tags);
    assert.strictEqual((await c.post('/api/posts', { title: ['x'], body: {}, tags: 5 })).status, 400);
    assert.strictEqual((await c.raw('POST', '/api/posts', undefined)).status, 400);
    const broken = await fetch(`${s.base}/api/posts`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'inkwell', Cookie: 'a=b' }, body: '{bad json' });
    assert.strictEqual(broken.status, 400);
  } finally { await s.close(); }
});

test('users cannot edit or delete other users\' posts (403)', async () => {
  const s = await startServer();
  try {
    const owner = await signedUp(s.base);
    const other = await signedUp(s.base, { username: 'sara', email: 'sara@example.com', password: 'secret123' });
    const id = (await owner.post('/api/posts', POST)).json.post.id;
    assert.strictEqual((await other.put(`/api/posts/${id}`, POST)).status, 403);
    assert.strictEqual((await other.del(`/api/posts/${id}`)).status, 403);
    assert.strictEqual((await owner.get(`/api/posts/${id}`)).json.post.title, POST.title);
    assert.strictEqual((await other.put('/api/posts/does-not-exist', POST)).status, 404);
  } finally { await s.close(); }
});

test('listing: newest first, search, tag, author filter and pagination', async () => {
  const s = await startServer();
  try {
    const a = await signedUp(s.base);
    const b = await signedUp(s.base, { username: 'sara', email: 'sara@example.com', password: 'secret123' });
    for (let i = 1; i <= 8; i++) {
      await a.post('/api/posts', { title: `Post number ${i}`, body: `Body text for post ${i}, about ${i % 2 ? 'cooking' : 'coding'}.`, tags: [i % 2 ? 'food' : 'tech'] });
    }
    await b.post('/api/posts', { title: 'Sara writes', body: 'Sara wrote this post about travel.', tags: ['travel'] });
    const page1 = (await a.get('/api/posts')).json;
    assert.strictEqual(page1.total, 9);
    assert.strictEqual(page1.posts.length, 6);
    assert.strictEqual(page1.pages, 2);
    assert.strictEqual(page1.posts[0].title, 'Sara writes');
    assert.ok(!('body' in page1.posts[0]), 'list returns an excerpt, not the full body');
    assert.strictEqual((await a.get('/api/posts?page=2')).json.posts.length, 3);
    assert.strictEqual((await a.get('/api/posts?page=99')).json.page, 2);
    assert.strictEqual((await a.get('/api/posts?q=cooking')).json.total, 4);
    assert.strictEqual((await a.get('/api/posts?tag=travel')).json.total, 1);
    assert.strictEqual((await a.get('/api/posts?author=SARA')).json.total, 1);
    assert.strictEqual((await a.get('/api/posts?q=zzzz')).json.total, 0);
  } finally { await s.close(); }
});

test('anyone can comment: anonymous needs a name, members use their username', async () => {
  const s = await startServer();
  try {
    const owner = await signedUp(s.base);
    const id = (await owner.post('/api/posts', POST)).json.post.id;
    const anon = client(s.base);
    assert.strictEqual((await anon.post(`/api/posts/${id}/comments`, { body: 'Nice post!' })).status, 400);
    const a = await anon.post(`/api/posts/${id}/comments`, { name: 'Guest', body: 'Nice post!' });
    assert.strictEqual(a.status, 201);
    assert.strictEqual(a.json.comment.author, 'Guest');
    assert.strictEqual(a.json.comment.registered, false);
    const m = await owner.post(`/api/posts/${id}/comments`, { body: 'Thanks everyone' });
    assert.strictEqual(m.json.comment.author, 'mahin');
    const list = (await anon.get(`/api/posts/${id}/comments`)).json.comments;
    assert.deepStrictEqual(list.map((c) => c.author), ['Guest', 'mahin']);
    assert.strictEqual((await anon.get(`/api/posts/${id}`)).json.post.commentCount, 2);
    assert.strictEqual((await anon.post('/api/posts/nope/comments', { name: 'G', body: 'hello' })).status, 404);
  } finally { await s.close(); }
});

test('comment deletion: its author or the post owner only', async () => {
  const s = await startServer();
  try {
    const owner = await signedUp(s.base);
    const sara = await signedUp(s.base, { username: 'sara', email: 'sara@example.com', password: 'secret123' });
    const eve = await signedUp(s.base, { username: 'eve', email: 'eve@example.com', password: 'secret123' });
    const id = (await owner.post('/api/posts', POST)).json.post.id;
    const c1 = (await sara.post(`/api/posts/${id}/comments`, { body: 'From Sara' })).json.comment.id;
    const c2 = (await sara.post(`/api/posts/${id}/comments`, { body: 'From Sara again' })).json.comment.id;
    assert.strictEqual((await eve.del(`/api/comments/${c1}`)).status, 403);
    assert.strictEqual((await sara.del(`/api/comments/${c1}`)).status, 200);
    assert.strictEqual((await owner.del(`/api/comments/${c2}`)).status, 200);
    assert.strictEqual((await owner.del(`/api/comments/${c2}`)).status, 404);
  } finally { await s.close(); }
});

test('deleting a post also deletes its comments', async () => {
  const s = await startServer();
  try {
    const owner = await signedUp(s.base);
    const id = (await owner.post('/api/posts', POST)).json.post.id;
    await owner.post(`/api/posts/${id}/comments`, { body: 'First!' });
    await owner.del(`/api/posts/${id}`);
    assert.strictEqual(s.db.data.comments.length, 0);
  } finally { await s.close(); }
});

test('security headers, JSON 404 and no secret leaks', async () => {
  const s = await startServer();
  try {
    const c = await signedUp(s.base);
    const r = await c.get('/api/auth/me');
    assert.ok(r.headers.get('content-security-policy').includes("script-src 'self'"));
    assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(r.headers.get('x-powered-by'), null);
    const nf = await c.get('/api/nothing-here');
    assert.strictEqual(nf.status, 404);
    assert.ok(nf.json.error.message);
    assert.ok(!r.text.includes('passwordHash'));
    const id = (await c.post('/api/posts', POST)).json.post.id;
    assert.ok(!JSON.stringify((await c.get(`/api/posts/${id}`)).json).includes('mahin@example.com'), 'post author email is private');
  } finally { await s.close(); }
});

test('HTML in posts is stored as text (the browser shows it with textContent)', async () => {
  const s = await startServer();
  try {
    const c = await signedUp(s.base);
    const payload = '<script>alert(1)</script> this is long enough text';
    const r = await c.post('/api/posts', { title: '<b>Bold</b> title', body: payload, tags: [] });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.post.body, payload);
    assert.ok(r.headers.get('content-type').startsWith('application/json'));
  } finally { await s.close(); }
});
