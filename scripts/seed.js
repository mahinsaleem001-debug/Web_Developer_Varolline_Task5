/*
 * Adds demo users, posts and comments so the blog is not empty when you present it.
 *   npm run seed
 * Demo logins (password for all: Demo1234):  sara@example.com, omar@example.com, hina@example.com
 * It only runs when the database has no posts yet, so it never duplicates data.
 */
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { Database } = require('../server/db');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'blog.json');
const db = new Database(file);

if (db.allPosts().length) {
  console.log('Database already has posts. Nothing to do.');
  process.exit(0);
}

const hash = bcrypt.hashSync('Demo1234', 10);
const sara = db.addUser({ username: 'sara', email: 'sara@example.com', passwordHash: hash });
const omar = db.addUser({ username: 'omar', email: 'omar@example.com', passwordHash: hash });
const hina = db.addUser({ username: 'hina', email: 'hina@example.com', passwordHash: hash });

const posts = [
  [sara, 'Why I finally learned CSS Grid', ['css', 'web'], 'For years I built every layout with floats and a lot of hope. Then I spent one weekend with CSS Grid and everything clicked.\n\nGrid lets you describe the page as rows and columns, and the browser does the maths. A card layout that used to take forty lines now takes four.\n\nIf you are still avoiding it, start small: one container, three columns, a gap. You will not go back.'],
  [omar, 'Five habits of calm developers', ['career', 'habits'], 'The calmest developers I know are not the fastest typists. They simply have a few habits that remove surprises.\n\nThey write down the next step before closing the laptop. They run the tests before they push. They ask a question after ten minutes of being stuck, not two hours.\n\nNone of this is glamorous, but it adds up to fewer fires and better evenings.'],
  [hina, 'A beginner guide to REST APIs', ['api', 'backend'], 'An API is a menu for your application. REST gives the menu a predictable shape: nouns in the URL, verbs in the method.\n\nGET /posts reads posts. POST /posts creates one. DELETE /posts/42 removes it. Status codes tell the client what happened: 200 for success, 404 for missing, 401 when you need to log in.\n\nOnce you see the pattern, every API feels familiar.'],
  [sara, 'Passwords: what hashing really means', ['security', 'backend'], 'Never store a password. Store a hash of it, made with a slow algorithm such as bcrypt.\n\nA hash cannot be turned back into the password, and a good one adds a random salt so two users with the same password get different results. When someone logs in, you hash what they typed and compare.\n\nIf your database leaks, attackers get hashes that are expensive to crack instead of the passwords themselves.'],
  [omar, 'My first week with JavaScript promises', ['javascript'], 'Promises confused me until I thought of them as a receipt. You order something, you get a receipt, and later the receipt turns into the thing you ordered or into an error.\n\nasync and await are just a friendlier way to wait for the receipt. Add try and catch around it, and your error handling finally lives in one place.'],
  [hina, 'Designing forms people actually finish', ['design', 'ux'], 'Most people abandon a form because it asks too much or complains too late.\n\nShow rules before the user types them, validate when they leave a field, and say exactly what to fix. Keep the keyboard working, keep labels visible, and never clear what they already entered.\n\nSmall kindnesses like these are the difference between a sign-up and a closed tab.'],
  [sara, 'Dark mode in twenty lines of CSS', ['css', 'design'], 'Dark mode is easier than it looks if you start with CSS variables. Define your colours once on the root, then override them for a dark theme.\n\nRemember to respect the system setting with prefers-color-scheme, and let people choose for themselves. Save the choice so the page does not flash the wrong colours when it loads.'],
  [omar, 'Reading other people\'s code', ['career', 'habits'], 'The fastest way to grow is to read code written by people better than you. Open a small library, find where a feature starts, and follow it one function at a time.\n\nTake notes. Rename things in your head. By the end you will have learned a pattern you can use tomorrow.'],
];

let t = Date.now() - posts.length * 3600 * 1000 * 5;
const created = posts.map(([author, title, tags, body]) => {
  const p = db.addPost({ authorId: author.id, title, body, tags });
  t += 3600 * 1000 * 5;
  p.createdAt = p.updatedAt = new Date(t).toISOString();
  return p;
});
db.addComment({ postId: created[0].id, userId: omar.id, name: omar.username, body: 'Grid finally made sense to me after reading this. Thank you!' });
db.addComment({ postId: created[0].id, userId: null, name: 'Guest reader', body: 'Great tip about starting small.' });
db.addComment({ postId: created[3].id, userId: hina.id, name: hina.username, body: 'Short and clear. I will share this with my team.' });
db._save();
console.log(`Seeded ${posts.length} posts and 3 demo users into ${file}`);
