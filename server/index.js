const path = require('node:path');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const production = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET is not set: using a random secret. Everyone is logged out whenever the server restarts.');
  console.warn('Copy .env.example values into your environment to keep sessions across restarts.');
}

const { app } = createApp({
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'blog.json'),
  production,
});

app.listen(PORT, () => console.log(`Inkwell is running at http://localhost:${PORT}`));
