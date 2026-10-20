# Inkwell API and route documentation

Base URL (local): `http://localhost:3000`
All API bodies and responses are JSON. Errors always look like:

```json
{ "error": { "message": "Please fix the highlighted fields.", "fields": { "title": "Title is required." } } }
```
`fields` appears only for validation (400) and duplicate (409) errors.

## Authentication model

- Passwords are hashed with **bcrypt** (cost 10) before they are stored. Plain passwords are never saved or returned.
- After sign-up or login the server sets a **JWT** in an `HttpOnly`, `SameSite=Strict` cookie (`inkwell_token`, valid 2 days, `Secure` in production). JavaScript cannot read it.
- **CSRF protection:** every request that is not GET must send the header `X-Requested-With: inkwell`. Browsers cannot add this header on a cross-site form, so forged requests get `403`.
- **Protected** routes need the cookie, otherwise they answer `401`. Routes that change someone's post or comment also check ownership and answer `403`.
- Login is rate limited: 10 failed attempts per IP and email in 15 minutes, then `429`.
- All input is validated on the server with the same rules the browser uses (`public/js/validate.js`).

## Status codes

| Code | Meaning |
|---|---|
| 200 / 201 | Success / created |
| 400 | Validation failed or body is not valid JSON |
| 401 | Not logged in, or wrong email or password |
| 403 | Logged in, but not allowed (not your post or comment, or missing CSRF header) |
| 404 | Post, comment or route not found |
| 409 | Username or email already registered |
| 413 | Request body larger than 30 KB |
| 429 | Too many attempts |

## Validation rules

| Field | Rule |
|---|---|
| `username` | 3 to 20 characters: letters, numbers, underscore. Unique, case-insensitive |
| `email` | Valid email, max 254 characters, stored in lower case, unique |
| `password` | 8 to 72 bytes, at least one letter and one number |
| `title` | 3 to 120 characters, one line |
| `body` (post) | 20 to 10,000 characters |
| `tags` | Up to 5, each 2 to 20 characters (`a-z`, `0-9`, `-`). Array or comma separated text. Lower-cased, duplicates removed |
| `body` (comment) | 2 to 1,000 characters |
| `name` (comment) | Required only when not logged in, 2 to 30 characters |

Control characters are rejected in every text field. The browser shows text with `textContent`, so HTML in posts is never executed.

## Auth endpoints

| Method and path | Access | Description |
|---|---|---|
| `POST /api/auth/signup` | Public | Create an account and log in. Body: `{ username, email, password }`. `201` with `{ user }` |
| `POST /api/auth/login` | Public | Body: `{ email, password }`. `200` with `{ user }`. Wrong details always give the same `401` message |
| `POST /api/auth/logout` | Public | Clears the cookie. `200` `{ ok: true }` |
| `GET /api/auth/me` | Public | `{ user }` for the logged-in user, or `{ user: null }` |

`user` = `{ id, username, email }`.

## Post endpoints

| Method and path | Access | Description |
|---|---|---|
| `GET /api/posts` | Public | List posts, newest first, 6 per page. Query: `q` (search), `tag`, `author` (username), `page` |
| `GET /api/posts/:id` | Public | One post with the full `body` |
| `POST /api/posts` | **Logged in** | Create. Body: `{ title, body, tags }`. `201` with `{ post }` |
| `PUT /api/posts/:id` | **Owner only** | Replace title, body and tags. `403` for other users |
| `DELETE /api/posts/:id` | **Owner only** | Delete the post and its comments |

List response: `{ posts: [{ id, title, excerpt, tags, author: { id, username }, createdAt, updatedAt, commentCount }], page, pages, total }`.
Single post: the same fields plus `body`.

## Comment endpoints

| Method and path | Access | Description |
|---|---|---|
| `GET /api/posts/:id/comments` | Public | Comments of a post, oldest first |
| `POST /api/posts/:id/comments` | Public | Body: `{ body }` plus `name` when not logged in. Logged-in users comment under their username |
| `DELETE /api/comments/:id` | **Logged in** | Allowed for the comment's author or the post owner, otherwise `403` |

Comment: `{ id, postId, body, createdAt, author, registered, authorId }`.

## Website routes (browser)

| Route | Access | Page |
|---|---|---|
| `#/` | Public | All posts. Filters: `?q=`, `?tag=`, `?author=`, `?page=` |
| `#/post/:id` | Public | Read a post and comment |
| `#/login`, `#/signup` | Public (logged-in users are sent home) | Account forms |
| `#/write` | **Logged in** | New post. Visitors are redirected to `#/login?next=...` |
| `#/edit/:id` | **Owner only** | Edit a post |

## Examples

```bash
# sign up (the cookie is saved in cookies.txt)
curl -c cookies.txt -H "Content-Type: application/json" -H "X-Requested-With: inkwell" \
  -d '{"username":"mahin","email":"mahin@example.com","password":"Secret123"}' \
  http://localhost:3000/api/auth/signup

# create a post
curl -b cookies.txt -H "Content-Type: application/json" -H "X-Requested-With: inkwell" \
  -d '{"title":"Hello","body":"My very first post on Inkwell.","tags":["intro"]}' \
  http://localhost:3000/api/posts

# read posts (no login needed)
curl "http://localhost:3000/api/posts?q=hello"
```
