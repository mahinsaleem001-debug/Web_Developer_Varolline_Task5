/*
 * api.js: the only place that talks to the server.
 * Adds the CSRF header, sends JSON and turns error responses into ApiError objects
 * (with `fields` for per-field messages from the server's validation).
 */
(function (root) {
  'use strict';

  class ApiError extends Error {
    constructor(status, message, fields) {
      super(message);
      this.status = status;
      this.fields = fields || null;
    }
  }

  async function request(method, path, body) {
    const headers = {};
    if (method !== 'GET') headers['X-Requested-With'] = 'inkwell';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    } catch (e) {
      throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = (data && data.error) || {};
      throw new ApiError(res.status, err.message || `Request failed (${res.status}).`, err.fields);
    }
    return data;
  }

  const qs = (obj) => {
    const p = new URLSearchParams();
    Object.keys(obj).forEach((k) => { if (obj[k] !== '' && obj[k] != null && obj[k] !== 1) p.set(k, obj[k]); });
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  root.BlogApi = {
    ApiError,
    me: () => request('GET', '/api/auth/me'),
    signup: (d) => request('POST', '/api/auth/signup', d),
    login: (d) => request('POST', '/api/auth/login', d),
    logout: () => request('POST', '/api/auth/logout', {}),
    posts: (params) => request('GET', `/api/posts${qs(params || {})}`),
    post: (id) => request('GET', `/api/posts/${encodeURIComponent(id)}`),
    createPost: (d) => request('POST', '/api/posts', d),
    updatePost: (id, d) => request('PUT', `/api/posts/${encodeURIComponent(id)}`, d),
    deletePost: (id) => request('DELETE', `/api/posts/${encodeURIComponent(id)}`),
    comments: (id) => request('GET', `/api/posts/${encodeURIComponent(id)}/comments`),
    addComment: (id, d) => request('POST', `/api/posts/${encodeURIComponent(id)}/comments`, d),
    deleteComment: (id) => request('DELETE', `/api/comments/${encodeURIComponent(id)}`),
  };
})(window);
