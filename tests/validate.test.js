const test = require('node:test');
const assert = require('node:assert');
const V = require('../public/js/validate.js');

test('signup: valid input is cleaned (trim, lowercase email)', () => {
  const r = V.validateSignup({ username: '  mahin_01 ', email: '  Mahin@Example.COM ', password: 'abcdefg1' });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.value, { username: 'mahin_01', email: 'mahin@example.com', password: 'abcdefg1' });
});

test('signup: every bad field gets its own message', () => {
  const r = V.validateSignup({ username: 'a!', email: 'nope', password: 'short' });
  assert.ok(!r.ok);
  assert.deepStrictEqual(Object.keys(r.errors).sort(), ['email', 'password', 'username']);
});

test('password rules: length, letter + number, 72 byte limit', () => {
  assert.ok(V.validateSignup({ username: 'abc', email: 'a@b.co', password: 'abcdefgh' }).errors.password);
  assert.ok(V.validateSignup({ username: 'abc', email: 'a@b.co', password: '12345678' }).errors.password);
  assert.ok(V.validateSignup({ username: 'abc', email: 'a@b.co', password: 'a1'.repeat(40) }).errors.password);
  assert.ok(V.validateSignup({ username: 'abc', email: 'a@b.co', password: 'abcdefg1' }).ok);
});

test('wrong types never crash validation', () => {
  [null, undefined, 5, [], {}].forEach((bad) => {
    assert.ok(!V.validateSignup({ username: bad, email: bad, password: bad }).ok);
    assert.ok(!V.validatePost({ title: bad, body: bad, tags: bad }).ok);
  });
  assert.ok(!V.validateSignup(null).ok);
});

test('post: title/content limits and control characters', () => {
  const long = 'x'.repeat(20);
  assert.ok(V.validatePost({ title: 'Hi', body: long }).errors.title);
  assert.ok(V.validatePost({ title: 'Hello', body: 'short' }).errors.body);
  assert.ok(V.validatePost({ title: 'Hello', body: long + '\u0000' }).errors.body);
  assert.ok(V.validatePost({ title: 'Line\nbreak', body: long }).errors.title);
  assert.ok(V.validatePost({ title: 'Hello', body: 'x'.repeat(10001) }).errors.body);
  assert.ok(V.validatePost({ title: 'Hello', body: long }).ok);
});

test('post: tags are lowercased, de-duplicated and limited', () => {
  const body = 'x'.repeat(30);
  const ok = V.validatePost({ title: 'Hello', body, tags: '#JS, js, Web-Dev ,' });
  assert.deepStrictEqual(ok.value.tags, ['js', 'web-dev']);
  assert.ok(V.validatePost({ title: 'Hello', body, tags: 'a,b,c,d,e,f,g' }).errors.tags);
  assert.ok(V.validatePost({ title: 'Hello', body, tags: ['ok', 'bad tag!'] }).errors.tags);
  assert.ok(V.validatePost({ title: 'Hello', body, tags: [1, 2] }).errors.tags);
});

test('comment: anonymous visitors must give a name', () => {
  assert.ok(V.validateComment({ body: 'Nice post' }, true).errors.name);
  assert.ok(V.validateComment({ body: 'Nice post', name: 'Sara' }, true).ok);
  assert.ok(V.validateComment({ body: 'Nice post' }, false).ok);
  assert.ok(V.validateComment({ body: 'x' }, false).errors.body);
});
