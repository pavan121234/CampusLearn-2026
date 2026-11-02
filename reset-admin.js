require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dataDir = path.resolve(process.env.DATA_DIR || __dirname);
require('fs').mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'academic.db');
const email = String(process.argv[2] || process.env.ADMIN_EMAIL || 'admin@example.com')
  .trim().toLowerCase();
const password = String(process.argv[3] || process.env.ADMIN_PASSWORD || '');
const name = String(process.env.ADMIN_NAME || 'Super Admin').trim();

if (!email || !email.includes('@')) {
  console.error('Usage: node reset-admin.js <admin-email> <new-password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Choose a password with at least 8 characters.');
  console.error('Usage: node reset-admin.js <admin-email> <new-password>');
  process.exit(1);
}

const db = new Database(dbPath);
try {
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','faculty','student')),
    branch TEXT DEFAULT '',
    semester INTEGER DEFAULT 1,
    scheme TEXT DEFAULT '2022',
    roll_no TEXT DEFAULT '',
    must_change_password INTEGER DEFAULT 1,
    phone TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  const emailOwner = db.prepare('SELECT id, role FROM users WHERE lower(email) = ?').get(email);
  if (emailOwner && emailOwner.role !== 'admin') {
    throw new Error(`The email ${email} belongs to a ${emailOwner.role} account. Use a different email.`);
  }

  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  const hash = bcrypt.hashSync(password, 10);
  if (emailOwner) {
    db.prepare(`UPDATE users SET name = ?, password_hash = ?, must_change_password = 0 WHERE id = ?`)
      .run(name, hash, emailOwner.id);
    console.log('Super Admin password reset successfully.');
  } else if (admin) {
    db.prepare(`UPDATE users SET name = ?, email = ?, password_hash = ?, must_change_password = 0 WHERE id = ?`)
      .run(name, email, hash, admin.id);
    console.log('Existing Super Admin email and password updated successfully.');
  } else {
    db.prepare(`INSERT INTO users (name, email, password_hash, role, must_change_password)
      VALUES (?, ?, ?, 'admin', 0)`).run(name, email, hash);
    console.log('Super Admin account created successfully.');
  }
  console.log(`Admin email: ${email}`);
  console.log('Restart the server, then sign in with this email and password.');
} catch (error) {
  console.error(`Admin setup failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
