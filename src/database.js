const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Sur Railway, on utilise /app/data (volume persistant) ou le dossier local
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(path.join(dataDir, 'tokens.db'));

// Création de la table
db.run(`
  CREATE TABLE IF NOT EXISTS tokens (
    user_id       TEXT PRIMARY KEY,
    username      TEXT,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    INTEGER NOT NULL,
    created_at    INTEGER DEFAULT (strftime('%s','now'))
  )
`);

const run = (sql, params = []) => new Promise((resolve, reject) =>
  db.run(sql, params, function(err) { err ? reject(err) : resolve(this); })
);
const get = (sql, params = []) => new Promise((resolve, reject) =>
  db.get(sql, params, (err, row) => { err ? reject(err) : resolve(row); })
);
const all = (sql, params = []) => new Promise((resolve, reject) =>
  db.all(sql, params, (err, rows) => { err ? reject(err) : resolve(rows); })
);

module.exports = {
  async saveToken(userId, username, accessToken, refreshToken, expiresIn) {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    await run(`
      INSERT INTO tokens (user_id, username, access_token, refresh_token, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username      = excluded.username,
        access_token  = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at    = excluded.expires_at
    `, [userId, username, accessToken, refreshToken, expiresAt]);
  },

  getAllTokens: () => all('SELECT * FROM tokens'),
  getToken: (userId) => get('SELECT * FROM tokens WHERE user_id = ?', [userId]),

  async updateAccessToken(userId, accessToken, refreshToken, expiresIn) {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    await run(
      'UPDATE tokens SET access_token=?, refresh_token=?, expires_at=? WHERE user_id=?',
      [accessToken, refreshToken, expiresAt, userId]
    );
  },

  deleteToken: (userId) => run('DELETE FROM tokens WHERE user_id = ?', [userId]),

  async countTokens() {
    const row = await get('SELECT COUNT(*) as count FROM tokens');
    return row ? row.count : 0;
  }
};
