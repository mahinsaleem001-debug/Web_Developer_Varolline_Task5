/*
 * validate.js: ONE set of form rules used by BOTH the browser and the server.
 * The browser uses it to show instant messages; the server uses the same file to
 * re-check everything (never trust the browser). Each function returns
 *   { ok: boolean, errors: { field: message }, value: { cleaned values } }
 */
(function (root) {
  'use strict';

  const LIMITS = {
    username: [3, 20],
    password: [8, 72], // bcrypt only uses the first 72 bytes
    title: [3, 120],
    body: [20, 10000],
    comment: [2, 1000],
    name: [2, 30],
    tagLen: [2, 20],
    tags: 5,
  };

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
  const TAG_RE = /^[a-z0-9-]+$/;
  // control characters except tab (9), newline (10) and carriage return (13)
  const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

  const isStr = (v) => typeof v === 'string';
  const byteLen = (s) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length);
  const clean = (s) => s.replace(/\r\n?/g, '\n');

  function result(errors, value) {
    return { ok: Object.keys(errors).length === 0, errors, value };
  }

  function checkText(errors, field, raw, [min, max], label, { multiline = false } = {}) {
    if (!isStr(raw)) { errors[field] = `${label} is required.`; return ''; }
    const v = multiline ? clean(raw).trim() : raw.trim();
    if (v.length < min) errors[field] = v.length === 0 ? `${label} is required.` : `${label} must be at least ${min} characters.`;
    else if (v.length > max) errors[field] = `${label} must be at most ${max} characters.`;
    else if (CONTROL_RE.test(v)) errors[field] = `${label} contains invalid characters.`;
    else if (!multiline && /\n/.test(v)) errors[field] = `${label} must be on one line.`;
    return v;
  }

  function checkEmail(errors, raw) {
    if (!isStr(raw) || !raw.trim()) { errors.email = 'Email is required.'; return ''; }
    const v = raw.trim().toLowerCase();
    if (v.length > 254 || !EMAIL_RE.test(v)) errors.email = 'Enter a valid email address.';
    return v;
  }

  function checkPassword(errors, raw, strict) {
    if (!isStr(raw) || raw.length === 0) { errors.password = 'Password is required.'; return ''; }
    if (!strict) return raw;
    if (raw.length < LIMITS.password[0]) errors.password = `Password must be at least ${LIMITS.password[0]} characters.`;
    else if (byteLen(raw) > LIMITS.password[1]) errors.password = `Password must be at most ${LIMITS.password[1]} bytes.`;
    else if (!/[A-Za-z]/.test(raw) || !/[0-9]/.test(raw)) errors.password = 'Password needs at least one letter and one number.';
    return raw;
  }

  function validateSignup(input) {
    const d = input || {};
    const errors = {};
    const username = checkText(errors, 'username', d.username, LIMITS.username, 'Username');
    if (!errors.username && !USERNAME_RE.test(username)) errors.username = 'Username may contain only letters, numbers and underscores.';
    const email = checkEmail(errors, d.email);
    const password = checkPassword(errors, d.password, true);
    return result(errors, { username, email, password });
  }

  function validateLogin(input) {
    const d = input || {};
    const errors = {};
    const email = checkEmail(errors, d.email);
    const password = checkPassword(errors, d.password, false);
    return result(errors, { email, password });
  }

  function parseTags(raw) {
    if (raw == null || raw === '') return [];
    const list = Array.isArray(raw) ? raw : isStr(raw) ? raw.split(',') : null;
    return list;
  }

  function validatePost(input) {
    const d = input || {};
    const errors = {};
    const title = checkText(errors, 'title', d.title, LIMITS.title, 'Title');
    const body = checkText(errors, 'body', d.body, LIMITS.body, 'Content', { multiline: true });
    const list = parseTags(d.tags);
    const tags = [];
    if (list === null || list.some((t) => !isStr(t))) {
      errors.tags = 'Tags must be a list of words.';
    } else {
      list.map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean).forEach((t) => { if (!tags.includes(t)) tags.push(t); });
      if (tags.length > LIMITS.tags) errors.tags = `Use at most ${LIMITS.tags} tags.`;
      else if (tags.some((t) => t.length < LIMITS.tagLen[0] || t.length > LIMITS.tagLen[1] || !TAG_RE.test(t))) {
        errors.tags = `Each tag needs ${LIMITS.tagLen[0]} to ${LIMITS.tagLen[1]} letters, numbers or dashes.`;
      }
    }
    return result(errors, { title, body, tags });
  }

  /** `anonymous` = the visitor is not logged in, so a display name is required. */
  function validateComment(input, anonymous) {
    const d = input || {};
    const errors = {};
    const body = checkText(errors, 'body', d.body, LIMITS.comment, 'Comment', { multiline: true });
    let name = '';
    if (anonymous) name = checkText(errors, 'name', d.name, LIMITS.name, 'Name');
    return result(errors, { body, name });
  }

  const api = { LIMITS, validateSignup, validateLogin, validatePost, validateComment };
  root.BlogValidate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
