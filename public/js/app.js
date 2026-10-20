/*
 * app.js: the Inkwell interface (single page, hash routes).
 *   #/                      all posts (search, tag, author, pages: #/?q=css&tag=web&author=sara&page=2)
 *   #/post/<id>             read a post and its comments
 *   #/login  #/signup       account forms
 *   #/write  #/edit/<id>    editor (logged-in users only)
 * All text is inserted with textContent through el(); innerHTML is never used.
 * Forms are checked with the SAME rules the server uses (validate.js), and server messages are shown too.
 */
(function () {
  'use strict';

  const V = window.BlogValidate;
  const API = window.BlogApi;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const main = document.getElementById('main');
  const state = { user: null, tags: [] };
  let renderToken = 0; // lets us ignore slow responses from a page we already left

  /* ---------------- helpers ---------------- */

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c); });
    return n;
  }

  function icon(name, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const fmtDate = (iso) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  const readTime = (body) => `${Math.max(1, Math.round(body.trim().split(/\s+/).length / 200))} min read`;
  const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();

  /** A pleasant, stable gradient for every post, taken from its title. */
  function paint(node, seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
    node.style.background = `linear-gradient(135deg, hsl(${h} 62% 48%), hsl(${(h + 48) % 360} 70% 32%))`;
  }

  function announce(msg) {
    const sr = $('#sr-live');
    sr.textContent = '';
    setTimeout(() => { sr.textContent = msg; }, 30);
  }

  let toastTimer = 0;
  function toast(message, kind) {
    const box = $('#toasts');
    box.textContent = '';
    clearTimeout(toastTimer);
    box.append(el('div', { class: 'toast' + (kind ? ' toast-' + kind : '') },
      el('span', { text: message }),
      el('button', { type: 'button', class: 'toast-x', 'aria-label': 'Dismiss', onclick: () => { box.textContent = ''; } }, icon('x'))));
    toastTimer = setTimeout(() => { box.textContent = ''; }, 4500);
    announce(message);
  }

  function confirmDialog(title, text, confirmLabel) {
    return new Promise((resolve) => {
      const dlg = $('#confirm');
      dlg.textContent = '';
      let result = false;
      dlg.append(el('div', { class: 'dlg-in' },
        el('h2', { id: 'confirm-title', text: title }),
        el('p', { class: 'muted', text }),
        el('div', { class: 'dlg-actions' },
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancel', onclick: () => dlg.close() }),
          el('button', { type: 'button', class: 'btn btn-danger', text: confirmLabel, onclick: () => { result = true; dlg.close(); } }))));
      dlg.addEventListener('close', () => resolve(result), { once: true });
      dlg.showModal();
    });
  }

  function go(hash) { location.hash = hash; }

  function setTitle(t) { document.title = t ? `${t} | Inkwell` : 'Inkwell | Stories worth sharing'; }

  /* ---------------- header ---------------- */

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('inkwell-theme', theme); } catch (e) { /* ignore */ }
    renderNav();
  }

  function renderNav() {
    const nav = $('#nav');
    nav.textContent = '';
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const themeBtn = el('button', {
      type: 'button', class: 'icon-btn', 'aria-label': dark ? 'Switch to light theme' : 'Switch to dark theme',
      onclick: () => setTheme(dark ? 'light' : 'dark'),
    }, icon(dark ? 'sun' : 'moon'));

    if (state.user) {
      nav.append(
        el('a', { class: 'btn btn-primary btn-sm', href: '#/write' }, icon('edit'), el('span', { text: 'Write' })),
        el('a', { class: 'nav-link', href: '#/?author=' + encodeURIComponent(state.user.username), text: 'My posts' }),
        el('span', { class: 'avatar', 'aria-hidden': 'true', text: initial(state.user.username) }),
        el('span', { class: 'who', text: state.user.username }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Log out', onclick: logout }),
        themeBtn);
    } else {
      nav.append(
        el('a', { class: 'nav-link', href: '#/login', text: 'Log in' }),
        el('a', { class: 'btn btn-primary btn-sm', href: '#/signup', text: 'Sign up' }),
        themeBtn);
    }
  }

  async function logout() {
    try { await API.logout(); } catch (e) { /* even if it fails, forget the user locally */ }
    state.user = null;
    renderNav();
    toast('You have been logged out.');
    go('#/');
    if (location.hash === '#/') render();
  }

  /* ---------------- form helper ---------------- */

  /**
   * Builds a labelled field with its own error line.
   * validator(values) must return an errors object; we show the one for this field.
   */
  function field({ name, label, type = 'text', hint, autocomplete, multiline, rows, maxlength, value = '', placeholder }) {
    const id = `f-${name}`;
    const errId = `${id}-err`;
    const control = multiline
      ? el('textarea', { id, name, rows: rows || 6, maxlength, placeholder, autocomplete: autocomplete || 'off' }, value)
      : el('input', { id, name, type, maxlength, placeholder, autocomplete: autocomplete || 'off', value, spellcheck: type === 'text' ? 'true' : 'false' });
    if (multiline) control.value = value;
    const err = el('p', { class: 'field-err', id: errId, role: 'alert' });
    const hintEl = hint ? el('p', { class: 'field-hint', id: `${id}-hint`, text: hint }) : null;
    control.setAttribute('aria-describedby', [hintEl ? `${id}-hint` : '', errId].filter(Boolean).join(' '));

    let right = null;
    if (type === 'password') {
      const toggle = el('button', { type: 'button', class: 'pw-toggle', 'aria-label': 'Show password', 'aria-pressed': 'false' }, icon('eye'));
      toggle.addEventListener('click', () => {
        const show = control.type === 'password';
        control.type = show ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', String(show));
        toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        toggle.textContent = '';
        toggle.append(icon(show ? 'eye-off' : 'eye'));
      });
      right = toggle;
    }

    const wrap = el('div', { class: 'field' },
      el('label', { for: id, text: label }),
      right ? el('div', { class: 'with-toggle' }, control, right) : control,
      hintEl, err);

    return {
      wrap, control, name,
      setError(msg) {
        err.textContent = msg || '';
        wrap.classList.toggle('invalid', Boolean(msg));
        if (msg) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
      },
    };
  }

  /** Wires fields to a validator: checks on blur, re-checks while typing once touched, and on submit. */
  function wireForm(form, fields, validator, onValid, submitBtn, busyLabel) {
    const idleLabel = submitBtn.textContent;
    const values = () => Object.fromEntries(fields.map((f) => [f.name, f.control.value]));
    const touched = new Set();
    const check = (onlyTouched) => {
      const { errors } = validator(values());
      fields.forEach((f) => f.setError(!onlyTouched || touched.has(f.name) ? errors[f.name] : ''));
      return errors;
    };
    fields.forEach((f) => {
      f.control.addEventListener('blur', () => { touched.add(f.name); check(true); });
      f.control.addEventListener('input', () => { if (touched.has(f.name)) check(true); });
    });
    const banner = el('p', { class: 'form-err', role: 'alert' });
    form.prepend(banner);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      banner.textContent = '';
      fields.forEach((f) => touched.add(f.name));
      const errors = check(false);
      const first = fields.find((f) => errors[f.name]);
      if (first) { first.control.focus(); return; }
      submitBtn.disabled = true;
      submitBtn.textContent = busyLabel;
      try {
        await onValid(values());
      } catch (err) {
        if (err.fields) {
          fields.forEach((f) => f.setError(err.fields[f.name] || ''));
          const bad = fields.find((f) => err.fields[f.name]);
          if (bad) bad.control.focus();
        }
        banner.textContent = err.message;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = idleLabel;
      }
    });
  }

  /* ---------------- pages ---------------- */

  function parseRoute() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const qi = raw.indexOf('?');
    const path = (qi === -1 ? raw : raw.slice(0, qi)).split('/').filter(Boolean);
    const query = new URLSearchParams(qi === -1 ? '' : raw.slice(qi + 1));
    return { path, query };
  }

  function postCard(p) {
    const cover = el('div', { class: 'cover', 'aria-hidden': 'true' }, el('span', { class: 'cover-letter', text: initial(p.title) }));
    paint(cover, p.title);
    return el('article', { class: 'card' },
      el('a', { class: 'card-cover', href: '#/post/' + p.id, tabindex: '-1', 'aria-hidden': 'true' }, cover),
      el('div', { class: 'card-body' },
        el('div', { class: 'tags' }, p.tags.slice(0, 3).map((t) => el('a', { class: 'tag', href: '#/?tag=' + encodeURIComponent(t), text: '#' + t }))),
        el('h2', { class: 'card-title' }, el('a', { href: '#/post/' + p.id, text: p.title })),
        el('p', { class: 'card-excerpt', text: p.excerpt }),
        el('div', { class: 'meta' },
          el('span', { class: 'avatar avatar-sm', 'aria-hidden': 'true', text: initial(p.author.username) }),
          el('a', { class: 'meta-author', href: '#/?author=' + encodeURIComponent(p.author.username), text: p.author.username }),
          el('span', { class: 'dot', 'aria-hidden': 'true', text: '·' }),
          el('time', { datetime: p.createdAt, text: fmtDate(p.createdAt) }),
          el('span', { class: 'meta-comments', 'aria-label': `${p.commentCount} comments` }, icon('chat'), String(p.commentCount)))));
  }

  async function renderHome(query, token) {
    const params = { q: query.get('q') || '', tag: query.get('tag') || '', author: query.get('author') || '', page: Number(query.get('page')) || 1 };
    main.textContent = '';
    main.setAttribute('data-view', 'home');
    setTitle(params.author ? `Posts by ${params.author}` : '');

    const input = el('input', { id: 'search', type: 'search', placeholder: 'Search stories, tags or authors', maxlength: 80, value: params.q, 'aria-label': 'Search posts' });
    const form = el('form', { class: 'search', role: 'search' }, icon('search'), input, el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'Search' }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = new URLSearchParams();
      if (input.value.trim()) p.set('q', input.value.trim());
      go('#/' + (p.toString() ? '?' + p : ''));
    });

    const hero = el('section', { class: 'hero' },
      el('p', { class: 'eyebrow', text: 'The Inkwell blog' }),
      el('h1', { id: 'page-title', tabindex: '-1', text: params.author ? `Posts by ${params.author}` : 'Stories worth sharing.' }),
      el('p', { class: 'lead', text: params.author ? 'Everything this writer has published.' : 'Read what others are writing, then add your own voice. Anyone can read and comment. Create a free account to publish.' }),
      form);
    const tagsBar = el('div', { class: 'tagbar', 'aria-label': 'Popular tags' });
    const list = el('div', { class: 'grid', 'aria-busy': 'true' });
    const pager = el('nav', { class: 'pager', 'aria-label': 'Pages' });
    const status = el('p', { class: 'count', 'aria-live': 'polite' });
    main.append(hero, tagsBar, status, list, pager);

    let data;
    try { data = await API.posts(params); } catch (e) {
      if (token !== renderToken) return;
      list.setAttribute('aria-busy', 'false');
      list.replaceWith(errorBox(e.message, () => render()));
      return;
    }
    if (token !== renderToken) return;
    list.setAttribute('aria-busy', 'false');

    // collect tags for the chip bar from the posts we know about
    data.posts.forEach((p) => p.tags.forEach((t) => { if (!state.tags.includes(t)) state.tags.push(t); }));
    if (params.tag) {
      tagsBar.append(el('span', { class: 'filter-chip' }, `Tag: #${params.tag}`, el('a', { href: '#/', 'aria-label': 'Clear tag filter' }, icon('x'))));
    } else {
      state.tags.slice(0, 8).forEach((t) => tagsBar.append(el('a', { class: 'tag tag-lg', href: '#/?tag=' + encodeURIComponent(t), text: '#' + t })));
    }
    if (!tagsBar.childNodes.length) tagsBar.remove();

    status.textContent = `${data.total} ${data.total === 1 ? 'post' : 'posts'}` + (params.q ? ` for “${params.q}”` : '');
    if (!data.posts.length) {
      list.replaceWith(el('div', { class: 'empty' },
        el('h2', { text: params.q || params.tag ? 'No posts match your search' : 'No posts yet' }),
        el('p', { text: state.user ? 'Be the first to write one.' : 'Log in to publish the first story.' }),
        el('a', { class: 'btn btn-primary', href: state.user ? '#/write' : '#/signup', text: state.user ? 'Write a post' : 'Create an account' })));
      return;
    }
    data.posts.forEach((p) => list.append(postCard(p)));

    if (data.pages > 1) {
      const link = (n, text, label, current) => {
        const p = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && !(k === 'page')));
        if (n > 1) p.set('page', n);
        return el('a', { class: 'page' + (current ? ' current' : ''), href: '#/' + (p.toString() ? '?' + p : ''), 'aria-label': label, 'aria-current': current ? 'page' : null, text });
      };
      if (data.page > 1) pager.append(link(data.page - 1, 'Previous', 'Previous page'));
      for (let n = 1; n <= data.pages; n++) pager.append(link(n, String(n), `Page ${n}`, n === data.page));
      if (data.page < data.pages) pager.append(link(data.page + 1, 'Next', 'Next page'));
    }
  }

  function errorBox(message, retry) {
    return el('div', { class: 'empty error' }, el('h2', { text: 'Something went wrong' }), el('p', { text: message }),
      el('button', { type: 'button', class: 'btn btn-primary', text: 'Try again', onclick: retry }));
  }

  function notFound(title, text) {
    main.textContent = '';
    main.append(el('section', { class: 'empty' },
      el('h1', { id: 'page-title', tabindex: '-1', text: title }), el('p', { text }),
      el('a', { class: 'btn btn-primary', href: '#/', text: 'Back to all posts' })));
  }

  async function renderPost(id, token) {
    main.textContent = '';
    main.setAttribute('data-view', 'post');
    setTitle('Loading…');
    let post;
    try { post = (await API.post(id)).post; } catch (e) {
      if (token !== renderToken) return;
      setTitle('Not found');
      if (e.status === 404) return notFound('Post not found', 'This post may have been deleted.');
      main.append(errorBox(e.message, () => render()));
      return;
    }
    if (token !== renderToken) return;
    setTitle(post.title);

    const isOwner = state.user && state.user.id === post.author.id;
    const cover = el('div', { class: 'post-cover', 'aria-hidden': 'true' }, el('span', { class: 'cover-letter big', text: initial(post.title) }));
    paint(cover, post.title);

    const actions = isOwner ? el('div', { class: 'owner-actions' },
      el('a', { class: 'btn btn-ghost btn-sm', href: '#/edit/' + post.id }, icon('edit'), el('span', { text: 'Edit' })),
      el('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', onclick: async () => {
        if (!(await confirmDialog('Delete this post?', 'The post and all of its comments will be removed permanently.', 'Delete post'))) return;
        try { await API.deletePost(post.id); toast('Post deleted.'); go('#/'); } catch (e) { toast(e.message, 'error'); }
      } }, icon('trash'), el('span', { text: 'Delete' }))) : null;

    const article = el('article', { class: 'post' },
      el('a', { class: 'back', href: '#/' }, icon('arrow-left'), 'All posts'),
      cover,
      el('div', { class: 'tags' }, post.tags.map((t) => el('a', { class: 'tag', href: '#/?tag=' + encodeURIComponent(t), text: '#' + t }))),
      el('h1', { id: 'page-title', tabindex: '-1', class: 'post-title', text: post.title }),
      el('div', { class: 'meta meta-lg' },
        el('span', { class: 'avatar', 'aria-hidden': 'true', text: initial(post.author.username) }),
        el('a', { class: 'meta-author', href: '#/?author=' + encodeURIComponent(post.author.username), text: post.author.username }),
        el('span', { class: 'dot', 'aria-hidden': 'true', text: '·' }),
        el('time', { datetime: post.createdAt, text: fmtDate(post.createdAt) }),
        el('span', { class: 'dot', 'aria-hidden': 'true', text: '·' }),
        el('span', { text: readTime(post.body) }),
        post.updatedAt !== post.createdAt ? el('span', { class: 'edited', text: `(edited ${fmtDate(post.updatedAt)})` }) : null),
      actions,
      el('div', { class: 'post-body' }, post.body.split(/\n{2,}/).map((para) => el('p', { text: para.trim() }))));

    const commentsBox = el('section', { class: 'comments', 'aria-labelledby': 'comments-h' });
    main.append(article, commentsBox);
    await renderComments(post, commentsBox, token);
  }

  async function renderComments(post, box, token) {
    box.textContent = '';
    const heading = el('h2', { id: 'comments-h', text: 'Comments' });
    const list = el('ul', { class: 'comment-list' });
    box.append(heading, list);

    const draw = (comments) => {
      heading.textContent = `Comments (${comments.length})`;
      list.textContent = '';
      if (!comments.length) list.append(el('li', { class: 'muted no-comments', text: 'No comments yet. Start the conversation.' }));
      comments.forEach((c) => {
        const canDelete = state.user && (c.authorId === state.user.id || post.author.id === state.user.id);
        list.append(el('li', { class: 'comment' },
          el('span', { class: 'avatar', 'aria-hidden': 'true', text: initial(c.author) }),
          el('div', { class: 'comment-main' },
            el('p', { class: 'comment-head' },
              el('strong', { text: c.author }), c.registered ? el('span', { class: 'badge', text: 'member' }) : null,
              el('time', { datetime: c.createdAt, text: fmtDate(c.createdAt) })),
            el('p', { class: 'comment-body', text: c.body })),
          canDelete ? el('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': `Delete comment by ${c.author}`, onclick: async () => {
            if (!(await confirmDialog('Delete this comment?', 'This cannot be undone.', 'Delete'))) return;
            try { await API.deleteComment(c.id); toast('Comment deleted.'); load(); } catch (e) { toast(e.message, 'error'); }
          } }, icon('trash')) : null));
      });
    };

    const load = async () => {
      try { const { comments } = await API.comments(post.id); if (token === renderToken) draw(comments); }
      catch (e) { list.textContent = ''; list.append(el('li', { class: 'form-err', text: e.message })); }
    };

    /* comment form (anyone may comment) */
    const fields = [];
    if (!state.user) fields.push(field({ name: 'name', label: 'Your name', maxlength: V.LIMITS.name[1], autocomplete: 'nickname' }));
    const bodyField = field({ name: 'body', label: state.user ? `Comment as ${state.user.username}` : 'Comment', multiline: true, rows: 4, maxlength: V.LIMITS.comment[1] });
    fields.push(bodyField);
    const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Post comment' });
    const form = el('form', { class: 'comment-form', novalidate: true }, ...fields.map((f) => f.wrap),
      el('div', { class: 'form-row' }, submit,
        state.user ? null : el('span', { class: 'muted small' }, 'Have an account? ', el('a', { href: '#/login', text: 'Log in' }))));
    wireForm(form, fields, (v) => V.validateComment(v, !state.user), async (v) => {
      await API.addComment(post.id, state.user ? { body: v.body } : { name: v.name, body: v.body });
      bodyField.control.value = '';
      toast('Comment added.');
      await load();
    }, submit, 'Posting…');
    box.append(form);
    await load();
  }

  function authPage(mode) {
    const signup = mode === 'signup';
    main.textContent = '';
    main.setAttribute('data-view', 'auth');
    setTitle(signup ? 'Create account' : 'Log in');
    if (state.user) { go('#/'); return; }

    const fields = signup
      ? [field({ name: 'username', label: 'Username', autocomplete: 'username', hint: '3 to 20 letters, numbers or underscores.', maxlength: 20 }),
        field({ name: 'email', label: 'Email', type: 'email', autocomplete: 'email', maxlength: 254 }),
        field({ name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', hint: 'At least 8 characters, with a letter and a number.', maxlength: 72 })]
      : [field({ name: 'email', label: 'Email', type: 'email', autocomplete: 'email', maxlength: 254 }),
        field({ name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password', maxlength: 72 })];
    const submit = el('button', { type: 'submit', class: 'btn btn-primary btn-block btn-lg', text: signup ? 'Create account' : 'Log in' });
    const form = el('form', { class: 'auth-form', novalidate: true }, ...fields.map((f) => f.wrap), submit);

    const next = new URLSearchParams(location.hash.split('?')[1] || '').get('next');
    wireForm(form, fields, signup ? V.validateSignup : V.validateLogin, async (v) => {
      const res = signup ? await API.signup(v) : await API.login(v);
      state.user = res.user;
      renderNav();
      toast(signup ? `Welcome to Inkwell, ${res.user.username}!` : `Welcome back, ${res.user.username}!`);
      go(next && next.startsWith('/') ? '#' + next : '#/');
    }, submit, signup ? 'Creating account…' : 'Logging in…');

    main.append(el('section', { class: 'auth' },
      el('div', { class: 'auth-card' },
        el('h1', { id: 'page-title', tabindex: '-1', text: signup ? 'Create your account' : 'Welcome back' }),
        el('p', { class: 'muted', text: signup ? 'Join Inkwell to write posts and comment as yourself.' : 'Log in to write and manage your posts.' }),
        form,
        el('p', { class: 'auth-switch' }, signup ? 'Already have an account? ' : 'New here? ',
          el('a', { href: signup ? '#/login' : '#/signup', text: signup ? 'Log in' : 'Create an account' })))));
  }

  /** Editor for new posts (post = null) and for editing (post = existing). */
  function renderEditor(post) {
    main.textContent = '';
    main.setAttribute('data-view', 'editor');
    setTitle(post ? 'Edit post' : 'Write');
    const title = field({ name: 'title', label: 'Title', maxlength: V.LIMITS.title[1], value: post ? post.title : '', placeholder: 'Give your story a title' });
    const tags = field({ name: 'tags', label: 'Tags', hint: 'Up to 5, separated by commas (for example: css, tips).', value: post ? post.tags.join(', ') : '', maxlength: 120 });
    const body = field({ name: 'body', label: 'Content', multiline: true, rows: 14, maxlength: V.LIMITS.body[1], value: post ? post.body : '', hint: 'Leave a blank line between paragraphs.' });
    const counter = el('p', { class: 'counter', 'aria-hidden': 'true' });
    const updateCount = () => { counter.textContent = `${body.control.value.length} / ${V.LIMITS.body[1]}`; };
    body.control.addEventListener('input', updateCount); updateCount();

    const submit = el('button', { type: 'submit', class: 'btn btn-primary btn-lg', text: post ? 'Save changes' : 'Publish' });
    const form = el('form', { class: 'editor-form', novalidate: true }, title.wrap, tags.wrap, body.wrap, counter,
      el('div', { class: 'form-row' }, submit, el('a', { class: 'btn btn-ghost btn-lg', href: post ? '#/post/' + post.id : '#/', text: 'Cancel' })));
    wireForm(form, [title, tags, body], V.validatePost, async (v) => {
      const res = post ? await API.updatePost(post.id, v) : await API.createPost(v);
      toast(post ? 'Post updated.' : 'Post published!');
      go('#/post/' + res.post.id);
    }, submit, post ? 'Saving…' : 'Publishing…');

    main.append(el('section', { class: 'editor' },
      el('h1', { id: 'page-title', tabindex: '-1', text: post ? 'Edit your post' : 'Write a new post' }), form));
  }

  async function renderEdit(id, token) {
    main.textContent = '';
    let post;
    try { post = (await API.post(id)).post; } catch (e) {
      if (token !== renderToken) return;
      return e.status === 404 ? notFound('Post not found', 'This post may have been deleted.') : main.append(errorBox(e.message, () => render()));
    }
    if (token !== renderToken) return;
    if (post.author.id !== state.user.id) return notFound('Not allowed', 'You can only edit your own posts.');
    renderEditor(post);
  }

  /* ---------------- router ---------------- */

  const PROTECTED = new Set(['write', 'edit']);

  function render(first) {
    const token = ++renderToken;
    const { path, query } = parseRoute();
    const [view, arg] = path;

    // route protection on the client (the server enforces it again on every request)
    if (PROTECTED.has(view) && !state.user) {
      toast('Please log in to continue.');
      go('#/login?next=' + encodeURIComponent('/' + path.join('/')));
      return;
    }

    if (view === 'post' && arg) renderPost(decodeURIComponent(arg), token);
    else if (view === 'login') authPage('login');
    else if (view === 'signup') authPage('signup');
    else if (view === 'write') renderEditor(null);
    else if (view === 'edit' && arg) renderEdit(decodeURIComponent(arg), token);
    else if (!view) renderHome(query, token);
    else notFound('Page not found', 'That page does not exist.');

    if (!first) {
      window.scrollTo(0, 0);
      const h = $('#page-title');
      if (h) h.focus({ preventScroll: true });
    }
  }

  async function boot() {
    try { state.user = (await API.me()).user; } catch (e) { state.user = null; }
    renderNav();
    window.addEventListener('hashchange', () => render(false));
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.key === '/' && !['input', 'textarea', 'select'].includes(tag)) {
        const s = $('#search');
        if (s) { e.preventDefault(); s.focus(); }
      }
    });
    render(true);
  }

  boot();
})();
