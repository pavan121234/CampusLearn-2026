require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');

const app = express();
const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('Set JWT_SECRET to a random value of at least 32 characters in your hosting service variables.');
}
if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)) {
  throw new Error('Production requires ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters. Set both in your hosting environment.');
}
// Use a mounted persistent directory in cloud hosting (for example Railway /data).
// Locally, default to the project folder so existing installations keep working.
const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PRIVATE_DRIVE_DIR = path.join(DATA_DIR, 'private-drive');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PRIVATE_DRIVE_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'academic.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR, {
  fallthrough: false,
  index: false,
  setHeaders: (res) => { res.setHeader('X-Content-Type-Options', 'nosniff'); }
}));
// Application assets belong to the release image, not the writable data volume.
// This keeps CSS/JS/images available when DATA_DIR is mounted at /data on Render/Railway/VPS.
app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

// Student personal-drive files are stored outside the public /uploads directory.
// Downloads are served only by the authenticated owner-checked API route below.
const driveUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PRIVATE_DRIVE_DIR),
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + '-' + safeName);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(pdf|png|jpe?g|gif|webp|mp4|webm|mov|txt|docx?|xlsx?|pptx?|zip)$/i.test(file.originalname);
    cb(allowed ? null : new Error('Unsupported file type for personal drive.'), allowed);
  }
});

// DATABASE TABLES
db.exec(`
CREATE TABLE IF NOT EXISTS users (
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
);

CREATE TABLE IF NOT EXISTS subjects (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 code TEXT NOT NULL,
 name TEXT NOT NULL,
 branch TEXT NOT NULL,
 semester INTEGER NOT NULL,
 scheme TEXT NOT NULL DEFAULT '2022',
 faculty_id INTEGER,
 UNIQUE(code, branch, semester, scheme),
 FOREIGN KEY(faculty_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS resources (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 subject_id INTEGER NOT NULL,
 faculty_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 type TEXT NOT NULL,
 description TEXT DEFAULT '',
 url TEXT DEFAULT '',
 file_name TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
 FOREIGN KEY(faculty_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS results (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL,
 subject_id INTEGER NOT NULL,
 exam_name TEXT NOT NULL,
 marks REAL NOT NULL,
 max_marks REAL NOT NULL DEFAULT 100,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL,
 subject_id INTEGER NOT NULL,
 month TEXT NOT NULL,
 present_days INTEGER NOT NULL,
 total_days INTEGER NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(student_id, subject_id, month),
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drive_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 item_type TEXT NOT NULL,
 url TEXT DEFAULT '',
 file_name TEXT DEFAULT '',
 original_name TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assignments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 subject_id INTEGER NOT NULL,
 faculty_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 question TEXT NOT NULL,
 due_date TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
 FOREIGN KEY(faculty_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 assignment_id INTEGER NOT NULL,
 student_id INTEGER NOT NULL,
 answer TEXT NOT NULL,
 file_name TEXT DEFAULT '',
 marks REAL,
 feedback TEXT DEFAULT '',
 submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(assignment_id, student_id),
 FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quizzes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 subject_id INTEGER NOT NULL,
 faculty_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 questions_json TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
 FOREIGN KEY(faculty_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS class_timetable (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 subject_id INTEGER NOT NULL,
 faculty_id INTEGER,
 day_of_week TEXT NOT NULL,
 start_time TEXT NOT NULL,
 end_time TEXT NOT NULL,
 room TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
 FOREIGN KEY(faculty_id) REFERENCES users(id) ON DELETE SET NULL,
 UNIQUE(subject_id, day_of_week, start_time)
);

CREATE TABLE IF NOT EXISTS password_otps (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 code_hash TEXT NOT NULL,
 purpose TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 used INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 message TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'info',
 action_url TEXT DEFAULT '',
 dedupe_key TEXT DEFAULT '',
 is_read INTEGER NOT NULL DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key <> '';

CREATE TABLE IF NOT EXISTS quiz_attempts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 quiz_id INTEGER NOT NULL,
 student_id INTEGER NOT NULL,
 score REAL NOT NULL,
 total REAL NOT NULL,
 answers_json TEXT NOT NULL,
 attempted_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

// Notification helpers: persistent in-app messages plus optional email delivery.
try { db.exec("ALTER TABLE notifications ADD COLUMN action_url TEXT DEFAULT ''"); } catch {}
let notificationTransporter = null;
function getNotificationTransporter() {
  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const missing = required.filter((key) => !String(process.env[key] || '').trim());
  if (missing.length) {
    console.error(`[Email] Not sent: missing Render environment variable(s): ${missing.join(', ')}`);
    return null;
  }
  if (!notificationTransporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE
      ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
      : port === 465;
    notificationTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return notificationTransporter;
}

async function emailNotification(userId, title, message) {
  try {
    const user = db.prepare("SELECT email FROM users WHERE id=?").get(Number(userId));
    if (!user?.email) {
      console.warn(`[Email] Not sent: user ${userId} has no email address.`);
      return false;
    }
    const transporter = getNotificationTransporter();
    if (!transporter) return false;
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: `CampusLearn: ${title}`,
      text: `${message}\\n\\nSign in to CampusLearn to open this update.`
    });
    console.info(`[Email] Sent "${title}" to ${user.email}; messageId=${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`[Email] Failed for user ${userId}:`, error.message);
    return false;
  }
}
function createNotification(userId, title, message, kind='info', dedupeKey='', actionUrl='') {
  try {
    const values = [Number(userId), String(title).slice(0,180), String(message).slice(0,2000), kind];
    if (dedupeKey) {
      const existing = db.prepare('SELECT id FROM notifications WHERE user_id=? AND dedupe_key=?').get(Number(userId), dedupeKey);
      if (existing) {
        db.prepare('UPDATE notifications SET title=?,message=?,kind=?,action_url=?,is_read=0,created_at=CURRENT_TIMESTAMP WHERE id=?').run(values[1], values[2], values[3], actionUrl, existing.id);
      } else {
        db.prepare('INSERT INTO notifications (user_id,title,message,kind,dedupe_key,action_url) VALUES (?,?,?,?,?,?)').run(...values, dedupeKey, actionUrl);
      }
    } else {
      db.prepare('INSERT INTO notifications (user_id,title,message,kind,action_url) VALUES (?,?,?,?,?)').run(...values, actionUrl);
    }
    if (!dedupeKey || !db.prepare('SELECT 1 FROM notifications WHERE user_id=? AND dedupe_key=?').get(Number(userId), dedupeKey)) emailNotification(userId,title,message);
    else emailNotification(userId,title,message);
  } catch (e) { console.error('Notification create failed:', e.message); }
}
function notifySubjectStudents(subject, title, message, kind, dedupeKey, actionUrl='') {
  const students = db.prepare(`SELECT id FROM users WHERE role='student' AND branch=? AND semester=? AND scheme=?`).all(subject.branch, subject.semester, subject.scheme);
  for (const student of students) createNotification(student.id, title, message, kind, `${dedupeKey}:${student.id}`, actionUrl);
}

// Migrate older personal-drive files out of the publicly served uploads folder.
// If a filename is also used by a resource/submission, copy it so those references keep working.
try {
  const legacyDriveItems = db.prepare("SELECT id, file_name FROM drive_items WHERE file_name IS NOT NULL AND file_name <> ''").all();
  const updateDriveFile = db.prepare('UPDATE drive_items SET file_name=? WHERE id=?');
  for (const item of legacyDriveItems) {
    const safeName = path.basename(item.file_name);
    const oldPath = path.join(UPLOADS_DIR, safeName);
    const privatePath = path.join(PRIVATE_DRIVE_DIR, safeName);
    if (!fs.existsSync(oldPath) || fs.existsSync(privatePath)) continue;
    const referencedElsewhere = Boolean(
      db.prepare('SELECT 1 FROM resources WHERE file_name=? LIMIT 1').get(item.file_name) ||
      db.prepare('SELECT 1 FROM submissions WHERE file_name=? LIMIT 1').get(item.file_name)
    );
    let privateName = safeName;
    if (referencedElsewhere) {
      privateName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;
      fs.copyFileSync(oldPath, path.join(PRIVATE_DRIVE_DIR, privateName));
    } else {
      fs.renameSync(oldPath, privatePath);
    }
    updateDriveFile.run(privateName, item.id);
  }
} catch (migrationError) {
  console.error('Personal-drive privacy migration warning:', migrationError.message);
}

// Support older databases that do not yet have the phone column.
try {
  db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''");
} catch (error) {
  if (!String(error.message).includes('duplicate column')) {
    throw error;
  }
}

// Ensure a Super Admin exists even when student/faculty rows already exist.
// Admin self-sign-up is intentionally disabled; bootstrap/reset via .env or reset-admin.js.
const existingAdmin = db.prepare(
  "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
).get();

if (!existingAdmin) {
  const adminEmail = String(
    process.env.ADMIN_EMAIL || 'admin@example.com'
  ).trim().toLowerCase();
  const adminName = process.env.ADMIN_NAME || 'Super Admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const emailOwner = db.prepare(
    'SELECT id, role FROM users WHERE lower(email) = ?'
  ).get(adminEmail);

  if (emailOwner) {
    throw new Error(
      `Cannot create the Super Admin: ${adminEmail} already belongs to a ${emailOwner.role} account. Set a different ADMIN_EMAIL in .env or run node reset-admin.js.`
    );
  }

  db.prepare(`
    INSERT INTO users
    (name, email, password_hash, role, must_change_password)
    VALUES (?, ?, ?, 'admin', 0)
  `).run(
    adminName,
    adminEmail,
    bcrypt.hashSync(adminPassword, 10)
  );
  console.log(`Default Super Admin created: ${adminEmail}`);
}

// FILE UPLOAD CONFIGURATION
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      );

      cb(null, Date.now() + '-' + safeName);
    }
  }),

  limits: {
    fileSize: 100 * 1024 * 1024
  },

  fileFilter: (_req, file, cb) => {
    const allowed =
      /\.(pdf|doc|docx|ppt|pptx|txt|png|jpg|jpeg|zip|mp4|webm|mov)$/i
        .test(file.originalname);

    if (!allowed) {
      return cb(
        new Error(
          'Unsupported file type. Upload PDF, Office, text, image, video or ZIP files.'
        )
      );
    }

    cb(null, true);
  }
});

// AUTHENTICATION AND HELPER FUNCTIONS
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : '';

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: 'Please log in again.'
    });
  }
}

function role(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'You do not have permission for this action.'
      });
    }

    next();
  };
}

function safeUser(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

function getUser(id) {
  return db.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).get(id);
}

function validText(value, max = 300) {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= max;
}

function ownedSubject(subjectId, userId) {
  return db.prepare(`
    SELECT *
    FROM subjects
    WHERE id = ? AND faculty_id = ?
  `).get(subjectId, userId);
}

function studentSubjectAccess(subjectId, user) {
  return db.prepare(`
    SELECT *
    FROM subjects
    WHERE id = ?
      AND branch = ?
      AND semester = ?
      AND scheme = ?
  `).get(
    subjectId,
    user.branch,
    Number(user.semester),
    user.scheme
  );
}

// ADMIN: send a diagnostic email to the signed-in administrator.
app.post('/api/admin/email/test', auth, role('admin'), async (req, res) => {
  const ok = await emailNotification(
    req.user.id,
    'Email configuration test',
    'This is a test email from CampusLearn. If you received it, SMTP email delivery is working.'
  );
  if (!ok) return res.status(503).json({ error: 'Test email failed. Check Render logs for [Email] details and verify SMTP environment variables.' });
  res.json({ message: 'Test email sent to your administrator email address.' });
});

// HEALTH CHECK
// NOTIFICATIONS: users can only read/update their own messages.
app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare('SELECT id,title,message,kind,action_url,is_read,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(req.user.id);
  res.json({ notifications: rows, unread: rows.filter(n => !n.is_read).length });
});
app.patch('/api/notifications/:id/read', auth, (req, res) => {
  const result = db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ message: 'Notification marked as read.' });
});
app.post('/api/notifications/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0').run(req.user.id);
  res.json({ message: 'All notifications marked as read.' });
});
app.post('/api/admin/notifications', auth, role('admin'), (req, res) => {
  const title = String(req.body.title || '').trim();
  const message = String(req.body.message || '').trim();
  const audience = String(req.body.audience || 'students');
  const kind = ['important','info','warning'].includes(req.body.kind) ? req.body.kind : 'important';
  if (!title || title.length > 180 || !message || message.length > 2000) return res.status(400).json({ error: 'Enter a title (max 180 characters) and message (max 2000 characters).' });
  if (!['all','students','faculty'].includes(audience)) return res.status(400).json({ error: 'Choose a valid audience.' });
  const roleFilter = audience === 'all' ? "role IN ('student','faculty','admin')" : 'role=?';
  const users = audience === 'all' ? db.prepare(`SELECT id FROM users WHERE ${roleFilter}`).all() : db.prepare(`SELECT id FROM users WHERE ${roleFilter}`).all(audience === 'students' ? 'student' : 'faculty');
  const key = `admin:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
  for (const user of users) createNotification(user.id, title, message, kind, `${key}:${user.id}`, '/notifications');
  res.status(201).json({ message: `Announcement sent to ${users.length} account(s).`, count: users.length });
});

app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1 AS ready').get();
    fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
    res.json({ ok: true, app: 'CampusLearn', storage: 'ready' });
  } catch (error) {
    console.error('[Health] Readiness check failed:', error.message);
    res.status(503).json({ ok: false, error: 'Application storage is not ready.' });
  }
});

// LOGIN
app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();

  const password = String(req.body.password || '');
  const requestedRole = String(req.body.role || '').trim();

  const user = db.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).get(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash) || (requestedRole && user.role !== requestedRole)) {
    return res.status(401).json({
      error: 'Invalid email or password.'
    });
  }

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: safeUser(user)
  });
});

// CURRENT USER
app.get('/api/me', auth, (req, res) => {
  const user = getUser(req.user.id);

  if (!user) {
    return res.status(404).json({
      error: 'Account not found.'
    });
  }

  res.json({ user: safeUser(user) });
});

// OTP HELPERS
function otpHash(code, userId, purpose) {
  return crypto.createHash('sha256')
    .update(`${userId}:${purpose}:${code}:${JWT_SECRET}`)
    .digest('hex');
}

async function deliverOtp(user, channel, code) {
  if (channel === 'email') {
    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASS
    ) {
      throw new Error(
        'Email OTP is not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM to .env.'
      );
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: 'CampusLearn authentication code',
      text: `Your CampusLearn verification code is ${code}. It expires in 10 minutes.`
    });

    return `Verification code sent to ${user.email}`;
  }

  if (channel === 'mobile') {
    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN ||
      !process.env.TWILIO_FROM
    ) {
      throw new Error(
        'SMS OTP is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM to .env.'
      );
    }

    if (!user.phone) {
      throw new Error(
        'No mobile number is saved for this account. Ask Super Admin to update the account.'
      );
    }

    const authValue = Buffer.from(
      `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
    ).toString('base64');

    const body = new URLSearchParams({
      To: user.phone,
      From: process.env.TWILIO_FROM,
      Body: `Your CampusLearn verification code is ${code}. It expires in 10 minutes.`
    });

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authValue}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
      }
    );

    if (!response.ok) {
      throw new Error(
        'SMS delivery failed. Check your Twilio configuration and phone number.'
      );
    }

    return 'Verification code sent to your registered mobile number';
  }

  throw new Error('Choose email or mobile verification.');
}

async function issueOtp(user, channel, purpose) {
  if (!user) {
    throw new Error('Account not found.');
  }

  const now = Math.floor(Date.now() / 1000);

  const recent = db.prepare(`
    SELECT COUNT(*) AS n
    FROM password_otps
    WHERE user_id = ? AND created_at > ?
  `).get(user.id, now - 900).n;

  if (recent >= 5) {
    throw new Error(
      'Too many codes requested. Try again in 15 minutes.'
    );
  }

  const code = String(crypto.randomInt(100000, 1000000));

  const message = await deliverOtp(user, channel, code);

  // A newly issued code replaces any older unused code for this account and purpose.
  // Only invalidate old codes after the new code has been delivered successfully.
  db.prepare(`
    UPDATE password_otps
    SET used = 1
    WHERE user_id = ? AND purpose = ? AND used = 0
  `).run(user.id, purpose);

  db.prepare(`
    INSERT INTO password_otps
    (user_id, code_hash, purpose, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    user.id,
    otpHash(code, user.id, purpose),
    purpose,
    now + 600,
    now
  );

  return message;
}

// CHANGE PASSWORD: VERIFY CURRENT PASSWORD (works without SMTP/SMS setup)
app.post('/api/auth/change-password', auth, (req, res) => {
  const user = getUser(req.user.id);
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');

  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  if (newPassword.length < 8 || newPassword.length > 100) {
    return res.status(400).json({ error: 'New password must contain 8 to 100 characters.' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from the current password.' });
  }

  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`)
    .run(bcrypt.hashSync(newPassword, 10), user.id);
  res.json({ message: 'Password changed successfully. Use the new password next time you sign in.' });
});

// CHANGE PASSWORD: REQUEST OTP
app.post('/api/auth/change-password/request-code', auth, async (req, res) => {
  try {
    const user = getUser(req.user.id);
    const channel = 'email';

    res.json({
      message: await issueOtp(user, channel, 'change-password')
    });
  } catch (error) {
    res.status(400).json({
      error: error.message || 'Could not send verification code.'
    });
  }
});

// CHANGE PASSWORD: VERIFY OTP
app.post('/api/auth/change-password/verify', auth, (req, res) => {
  const user = getUser(req.user.id);
  const code = String(req.body.code || '').replace(/\D/g, '').slice(0, 6);
  const next = String(req.body.newPassword || '');

  if (next.length < 8) {
    return res.status(400).json({
      error: 'New password must be at least 8 characters.'
    });
  }

  const otp = db.prepare(`
    SELECT *
    FROM password_otps
    WHERE user_id = ?
      AND purpose = 'change-password'
      AND used = 0
    ORDER BY id DESC
    LIMIT 1
  `).get(user.id);

  if (
    !otp ||
    otp.expires_at <= Math.floor(Date.now() / 1000) ||
    otp.attempts >= 5 ||
    otp.code_hash !== otpHash(code, user.id, 'change-password')
  ) {
    if (otp) {
      db.prepare(
        'UPDATE password_otps SET attempts = attempts + 1 WHERE id = ?'
      ).run(otp.id);
    }

    return res.status(400).json({
      error: 'Invalid or expired verification code.'
    });
  }

  db.prepare(
    'UPDATE password_otps SET used = 1 WHERE id = ?'
  ).run(otp.id);

  db.prepare(`
    UPDATE users
    SET password_hash = ?, must_change_password = 0
    WHERE id = ?
  `).run(bcrypt.hashSync(next, 10), user.id);

  res.json({
    message: 'Password changed after verification.'
  });
});

// FORGOT PASSWORD: REQUEST OTP
app.post('/api/auth/forgot/request-code', async (req, res) => {
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();

  const channel = 'email';

  const user = db.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).get(email);

  if (!user) {
    return res.status(404).json({
      error: 'No account matches that email address.'
    });
  }

  try {
    res.json({
      message: await issueOtp(user, channel, 'forgot-password')
    });
  } catch (error) {
    res.status(400).json({
      error: error.message || 'Could not send verification code.'
    });
  }
});

// FORGOT PASSWORD: VERIFY OTP
app.post('/api/auth/forgot/verify', (req, res) => {
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();

  const code = String(req.body.code || '').replace(/\D/g, '').slice(0, 6);
  const next = String(req.body.newPassword || '');

  if (next.length < 8) {
    return res.status(400).json({
      error: 'New password must be at least 8 characters.'
    });
  }

  const user = db.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).get(email);

  if (!user) {
    return res.status(400).json({
      error: 'Invalid account or verification code.'
    });
  }

  const otp = db.prepare(`
    SELECT *
    FROM password_otps
    WHERE user_id = ?
      AND purpose = 'forgot-password'
      AND used = 0
    ORDER BY id DESC
    LIMIT 1
  `).get(user.id);

  if (
    !otp ||
    otp.expires_at <= Math.floor(Date.now() / 1000) ||
    otp.attempts >= 5 ||
    otp.code_hash !== otpHash(code, user.id, 'forgot-password')
  ) {
    if (otp) {
      db.prepare(
        'UPDATE password_otps SET attempts = attempts + 1 WHERE id = ?'
      ).run(otp.id);
    }

    return res.status(400).json({
      error: 'Invalid or expired verification code.'
    });
  }

  db.prepare(
    'UPDATE password_otps SET used = 1 WHERE id = ?'
  ).run(otp.id);

  db.prepare(`
    UPDATE users
    SET password_hash = ?, must_change_password = 0
    WHERE id = ?
  `).run(bcrypt.hashSync(next, 10), user.id);

  res.json({
    message: 'Password reset successfully. You can now sign in.'
  });
});

// ADMIN: LIST USERS
app.get('/api/admin/users', auth, role('admin'), (_req, res) => {
  const users = db.prepare(`
    SELECT id, name, email, role, branch, semester, scheme,
           roll_no, phone, must_change_password, created_at
    FROM users
    WHERE role != 'admin'
    ORDER BY role, name
  `).all();

  res.json({ users });
});

// ADMIN: CREATE FACULTY OR STUDENT
app.post('/api/admin/users', auth, role('admin'), (req, res) => {
  const {
    name,
    email,
    password,
    role: rawRole,
    branch = '',
    semester = 1,
    scheme = '2022',
    roll_no = '',
    phone = ''
  } = req.body;
  const newRole = String(rawRole || '').trim().toLowerCase();
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (
    !validText(name, 120) ||
    !validText(cleanEmail, 180) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
    !validText(password, 100) ||
    !['faculty', 'student'].includes(newRole)
  ) {
    return res.status(400).json({
      error: 'Name, email, password and a valid faculty/student role are required.'
    });
  }

  if (String(password).length < 8) {
    return res.status(400).json({
      error: 'Temporary password must contain at least 8 characters.'
    });
  }

  if (
    newRole === 'student' &&
    (
      !validText(branch, 100) ||
      !['2022', '2025'].includes(String(scheme)) ||
      !Number.isInteger(Number(semester)) ||
      Number(semester) < 1 ||
      Number(semester) > 8
    )
  ) {
    return res.status(400).json({
      error: 'For students, enter branch, semester (1-8) and scheme (2022 or 2025).'
    });
  }

  try {
    const info = db.prepare(`
      INSERT INTO users
      (name, email, password_hash, role, branch, semester, scheme,
       roll_no, must_change_password, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      name.trim(),
      cleanEmail,
      bcrypt.hashSync(String(password), 10),
      newRole,
      String(branch),
      Number(semester),
      String(scheme),
      String(roll_no),
      String(phone).trim()
    );

    res.status(201).json({
      message: 'Account created. Share the credentials securely with the user.',
      id: info.lastInsertRowid
    });
  } catch (error) {
    res.status(400).json({
      error: error.message.includes('UNIQUE')
        ? 'An account with this email already exists.'
        : 'Could not create account.'
    });
  }
});

// ADMIN: EDIT STUDENT/FACULTY PROFILE
app.put('/api/admin/users/:id', auth, role('admin'), (req, res) => {
  const target = getUser(Number(req.params.id));
  if (!target || target.role === 'admin') return res.status(404).json({error:'Account not found.'});
  const {name, email, phone='', branch='', semester=1, scheme='2022', roll_no='', password=''} = req.body;
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!validText(name,120) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({error:'Enter a valid name and email address.'});
  if (target.role === 'student' && (!validText(branch,100) || !['2022','2025'].includes(String(scheme)) || !Number.isInteger(Number(semester)) || Number(semester)<1 || Number(semester)>8)) return res.status(400).json({error:'Check branch, semester and scheme.'});
  if (password && String(password).length < 8) return res.status(400).json({error:'New temporary password must contain at least 8 characters.'});
  try {
    if (password) db.prepare(`UPDATE users SET name=?,email=?,phone=?,branch=?,semester=?,scheme=?,roll_no=?,password_hash=?,must_change_password=1 WHERE id=?`).run(name.trim(),cleanEmail,String(phone).trim(),String(branch),Number(semester),String(scheme),String(roll_no),bcrypt.hashSync(String(password),10),target.id);
    else db.prepare(`UPDATE users SET name=?,email=?,phone=?,branch=?,semester=?,scheme=?,roll_no=? WHERE id=?`).run(name.trim(),cleanEmail,String(phone).trim(),String(branch),Number(semester),String(scheme),String(roll_no),target.id);
    res.json({message:'Account details updated successfully.'});
  } catch (error) { res.status(400).json({error:error.message.includes('UNIQUE')?'That email address is already in use.':'Could not update account.'}); }
});

// PERSONAL DRIVE: each student can only access their own items
app.get('/api/student/drive', auth, role('student'), (req,res) => {
 const items = db.prepare('SELECT id,title,item_type,url,file_name,original_name,created_at FROM drive_items WHERE user_id=? ORDER BY id DESC').all(req.user.id);
 res.json({items});
});
app.post('/api/student/drive', auth, role('student'), driveUpload.single('file'), (req,res) => {
 const title=String(req.body.title||'').trim(); let url=String(req.body.url||'').trim(); if(url && !/^https?:\/\//i.test(url)) url='https://'+url; if(url){try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw new Error();url=parsed.toString();}catch{return res.status(400).json({error:'Enter a valid web or YouTube link.'});}}
 if(!title || (!req.file && !url)) return res.status(400).json({error:'Add a title and upload a file or provide a link.'});

 const itemType=req.file ? (/\.(mp4|webm|mov)$/i.test(req.file.originalname)?'video':/\.(png|jpe?g|gif|webp)$/i.test(req.file.originalname)?'image':/\.pdf$/i.test(req.file.originalname)?'pdf':'file') : 'link';
 const info=db.prepare('INSERT INTO drive_items(user_id,title,item_type,url,file_name,original_name) VALUES(?,?,?,?,?,?)').run(req.user.id,title,itemType,url,req.file?.filename||'',req.file?.originalname||'');
 res.status(201).json({message:'Saved to your personal drive.',id:info.lastInsertRowid});
});
app.get('/api/student/drive/:id/file', auth, role('student'), (req,res) => {
 const item=db.prepare('SELECT file_name,original_name FROM drive_items WHERE id=? AND user_id=?').get(Number(req.params.id),req.user.id);
 if(!item || !item.file_name) return res.status(404).json({error:'Drive file not found.'});
 const privatePath=path.join(PRIVATE_DRIVE_DIR,item.file_name);
 const legacyPath=path.join(UPLOADS_DIR,item.file_name);
 const filePath=fs.existsSync(privatePath)?privatePath:legacyPath;
 if(!fs.existsSync(filePath)) return res.status(404).json({error:'Drive file is missing from storage.'});
 const ext=path.extname(item.original_name||item.file_name).toLowerCase(); const mimeMap={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.txt':'text/plain','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.ppt':'application/vnd.ms-powerpoint','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.zip':'application/zip'}; const type=mimeMap[ext]||'application/octet-stream'; const previewable=/^(application\/pdf|image\/|video\/|text\/plain)$/.test(type); const forceDownload=String(req.query.download||'')==='1'; res.setHeader('Content-Type',type); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Cache-Control','private, no-store'); res.setHeader('Content-Disposition',`${previewable&&!forceDownload?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(item.original_name||item.file_name)}`); fs.createReadStream(filePath).pipe(res);
});
app.delete('/api/student/drive/:id', auth, role('student'), (req,res) => {
 const item=db.prepare('SELECT * FROM drive_items WHERE id=? AND user_id=?').get(Number(req.params.id),req.user.id);
 if(!item) return res.status(404).json({error:'Drive item not found.'});
 if(item.file_name){for (const dir of [PRIVATE_DRIVE_DIR, UPLOADS_DIR]) { try { fs.unlinkSync(path.join(dir,item.file_name)); } catch {} }}
 db.prepare('DELETE FROM drive_items WHERE id=?').run(item.id); res.json({message:'Removed from your personal drive.'});
});

// ADMIN: DELETE USER
app.delete('/api/admin/users/:id', auth, role('admin'), (req, res) => {
  const target = getUser(Number(req.params.id));

  if (!target || target.role === 'admin') {
    return res.status(404).json({
      error: 'User not found.'
    });
  }

  db.prepare(
    'DELETE FROM users WHERE id = ?'
  ).run(target.id);

  res.json({ message: 'Account deleted.' });
});

// LIST SUBJECTS
app.get('/api/subjects', auth, (req, res) => {
  let subjects;

  if (req.user.role === 'admin') {
    subjects = db.prepare(`
      SELECT s.*, u.name AS faculty_name
      FROM subjects s
      LEFT JOIN users u ON u.id = s.faculty_id
      ORDER BY s.branch, s.semester, s.name
    `).all();
  } else if (req.user.role === 'faculty') {
    subjects = db.prepare(`
      SELECT s.*, u.name AS faculty_name
      FROM subjects s
      LEFT JOIN users u ON u.id = s.faculty_id
      WHERE s.faculty_id = ?
      ORDER BY s.semester, s.name
    `).all(req.user.id);
  } else {
    const user = getUser(req.user.id);

    subjects = db.prepare(`
      SELECT s.*, f.name AS faculty_name
      FROM subjects s
      LEFT JOIN users f ON f.id = s.faculty_id
      WHERE s.branch = ? AND s.semester = ? AND s.scheme = ?
      ORDER BY s.name
    `).all(user.branch, user.semester, user.scheme);
  }

  res.json({ subjects });
});

// ADMIN: CREATE SUBJECT
app.post('/api/admin/subjects', auth, role('admin'), (req, res) => {
  const {
    code,
    name,
    branch,
    semester,
    scheme = '2022',
    faculty_id = null
  } = req.body;

  if (
    !validText(code, 30) ||
    !validText(name, 150) ||
    !validText(branch, 100) ||
    !['2022', '2025'].includes(String(scheme)) ||
    Number(semester) < 1 ||
    Number(semester) > 8
  ) {
    return res.status(400).json({
      error: 'Enter subject code, name, branch, semester (1-8), and scheme (2022/2025).'
    });
  }

  if (
    faculty_id &&
    (
      !getUser(Number(faculty_id)) ||
      getUser(Number(faculty_id)).role !== 'faculty'
    )
  ) {
    return res.status(400).json({
      error: 'Select a valid faculty account.'
    });
  }

  try {
    const info = db.prepare(`
      INSERT INTO subjects
      (code, name, branch, semester, scheme, faculty_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      code.trim().toUpperCase(),
      name.trim(),
      branch.trim(),
      Number(semester),
      String(scheme),
      faculty_id ? Number(faculty_id) : null
    );

    res.status(201).json({
      message: 'Subject created and faculty assigned.',
      id: info.lastInsertRowid
    });
  } catch (error) {
    res.status(400).json({
      error: error.message.includes('UNIQUE')
        ? 'This subject code already exists for that branch, semester and scheme.'
        : 'Could not create subject.'
    });
  }
});

// ADMIN: ASSIGN FACULTY TO SUBJECT
app.put('/api/admin/subjects/:id/assign', auth, role('admin'), (req, res) => {
  const facultyId = req.body.faculty_id
    ? Number(req.body.faculty_id)
    : null;

  if (
    facultyId &&
    (
      !getUser(facultyId) ||
      getUser(facultyId).role !== 'faculty'
    )
  ) {
    return res.status(400).json({
      error: 'Select a valid faculty account.'
    });
  }

  const result = db.prepare(`
    UPDATE subjects SET faculty_id = ? WHERE id = ?
  `).run(facultyId, Number(req.params.id));

  if (!result.changes) {
    return res.status(404).json({
      error: 'Subject not found.'
    });
  }

  db.prepare(`
    UPDATE class_timetable SET faculty_id = ? WHERE subject_id = ?
  `).run(facultyId, Number(req.params.id));

  res.json({ message: 'Faculty assignment updated.' });
});

// ADMIN: DELETE SUBJECT
app.delete('/api/admin/subjects/:id', auth, role('admin'), (req, res) => {
  db.prepare(
    'DELETE FROM subjects WHERE id = ?'
  ).run(Number(req.params.id));

  res.json({ message: 'Subject deleted.' });
});

// LIST RESOURCES
app.get('/api/resources', auth, (req, res) => {
  const subjectId = req.query.subject_id
    ? Number(req.query.subject_id)
    : null;

  let sql = `
    SELECT r.*, s.code, s.name AS subject_name, u.name AS faculty_name
    FROM resources r
    JOIN subjects s ON s.id = r.subject_id
    JOIN users u ON u.id = r.faculty_id
  `;

  const args = [];
  const where = [];

  if (subjectId) {
    where.push('r.subject_id = ?');
    args.push(subjectId);
  }

  if (req.user.role === 'faculty') {
    where.push('r.faculty_id = ?');
    args.push(req.user.id);
  }

  if (req.user.role === 'student') {
    const user = getUser(req.user.id);

    where.push('s.branch = ? AND s.semester = ? AND s.scheme = ?');
    args.push(user.branch, user.semester, user.scheme);
  }

  if (where.length) {
    sql += ' WHERE ' + where.join(' AND ');
  }

  sql += ' ORDER BY r.created_at DESC';

  res.json({
    resources: db.prepare(sql).all(...args)
  });
});

// PREVIEW PPTX FILE
app.get('/api/resources/:id/pptx-preview', auth, (req, res) => {
  const resource = db.prepare(`
    SELECT r.*, s.branch, s.semester, s.scheme,
           s.faculty_id AS assigned_faculty
    FROM resources r
    JOIN subjects s ON s.id = r.subject_id
    WHERE r.id = ?
  `).get(Number(req.params.id));

  if (!resource || !resource.file_name) {
    return res.status(404).json({
      error: 'Presentation not found.'
    });
  }

  if (req.user.role === 'student') {
    const user = getUser(req.user.id);

    if (
      resource.branch !== user.branch ||
      resource.semester !== user.semester ||
      resource.scheme !== user.scheme
    ) {
      return res.status(403).json({ error: 'Not allowed.' });
    }
  }

  if (
    req.user.role === 'faculty' &&
    resource.faculty_id !== req.user.id &&
    resource.assigned_faculty !== req.user.id
  ) {
    return res.status(403).json({ error: 'Not allowed.' });
  }

  if (!/\.pptx$/i.test(resource.file_name)) {
    return res.status(415).json({
      error: 'In-app text preview supports PPTX files. Download legacy PPT files to read them.'
    });
  }

  try {
    const zip = new AdmZip(
      path.join(DATA_DIR, 'uploads', resource.file_name)
    );

    const slides = zip.getEntries()
      .filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
      .sort((a, b) => {
        const numA = Number(a.entryName.match(/slide(\d+)/)[1]);
        const numB = Number(b.entryName.match(/slide(\d+)/)[1]);
        return numA - numB;
      })
      .map((entry, index) => {
        const xml = entry.getData().toString('utf8');

        const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
          .map(match => match[1]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
          )
          .filter(Boolean);

        return {
          number: index + 1,
          text: texts.join(' ')
        };
      })
      .filter(slide => slide.text);

    res.json({
      title: resource.title,
      slides
    });
  } catch {
    res.status(400).json({
      error: 'Could not read this PPTX file. Try downloading it instead.'
    });
  }
});

// UPLOAD RESOURCE
app.post('/api/resources', auth, role('faculty'), upload.single('file'), (req, res) => {
  const subject = ownedSubject(
    Number(req.body.subject_id),
    req.user.id
  );

  if (!subject) {
    if (req.file) fs.unlinkSync(req.file.path);

    return res.status(403).json({
      error: 'You can upload resources only for subjects assigned to you.'
    });
  }

  const title = String(req.body.title || '').trim();
  const type = String(req.body.type || 'Notes');
  const description = String(req.body.description || '').trim();
  const url = String(req.body.url || '').trim();

  if (!title || (!req.file && !url)) {
    if (req.file) fs.unlinkSync(req.file.path);

    return res.status(400).json({
      error: 'Add a title and either upload a file or provide an external link.'
    });
  }

  const info = db.prepare(`
    INSERT INTO resources
    (subject_id, faculty_id, title, type, description, url, file_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    subject.id,
    req.user.id,
    title,
    type,
    description,
    url,
    req.file ? req.file.filename : ''
  );

  notifySubjectStudents(subject, 'New study material added', `${req.user.name} added “${title}” (${type}) for ${subject.code} — ${subject.name}. Open Study Materials to view it.`, 'resource', `resource:${info.lastInsertRowid}`, '/resources');
  res.status(201).json({
    message: 'Resource published. Students in this subject have been notified.',
    id: info.lastInsertRowid
  });
});

// DELETE RESOURCE
app.delete('/api/resources/:id', auth, (req, res) => {
  const resource = db.prepare(
    'SELECT * FROM resources WHERE id = ?'
  ).get(Number(req.params.id));

  if (!resource) {
    return res.status(404).json({
      error: 'Resource not found.'
    });
  }

  if (
    req.user.role !== 'admin' &&
    !(req.user.role === 'faculty' && resource.faculty_id === req.user.id)
  ) {
    return res.status(403).json({
      error: 'Not allowed.'
    });
  }

  if (resource.file_name) {
    const filePath = path.join(
      DATA_DIR,
      'uploads',
      resource.file_name
    );

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  db.prepare(
    'DELETE FROM resources WHERE id = ?'
  ).run(resource.id);

  res.json({ message: 'Resource deleted.' });
});

// ADMIN: LIST STUDENTS
app.get('/api/admin/students', auth, role('admin'), (_req, res) => {
  const students = db.prepare(`
    SELECT id, name, email, branch, semester, scheme, roll_no
    FROM users
    WHERE role = 'student'
    ORDER BY name
  `).all();

  res.json({ students });
});

// TIMETABLE
app.get('/api/timetable', auth, (req, res) => {
  let sql = `
    SELECT t.*, s.code, s.name AS subject_name,
           s.branch, s.semester, s.scheme, u.name AS faculty_name
    FROM class_timetable t
    JOIN subjects s ON s.id = t.subject_id
    LEFT JOIN users u ON u.id = t.faculty_id
  `;

  const args = [];
  const where = [];

  if (req.user.role === 'faculty') {
    where.push('t.faculty_id = ?');
    args.push(req.user.id);
  }

  if (req.user.role === 'student') {
    const user = getUser(req.user.id);

    where.push('s.branch = ? AND s.semester = ? AND s.scheme = ?');
    args.push(user.branch, user.semester, user.scheme);
  }

  if (where.length) {
    sql += ' WHERE ' + where.join(' AND ');
  }

  sql += ` ORDER BY CASE t.day_of_week
    WHEN 'Monday' THEN 1
    WHEN 'Tuesday' THEN 2
    WHEN 'Wednesday' THEN 3
    WHEN 'Thursday' THEN 4
    WHEN 'Friday' THEN 5
    WHEN 'Saturday' THEN 6
    ELSE 7 END, t.start_time`;

  res.json({
    timetable: db.prepare(sql).all(...args)
  });
});

// ADMIN: ADD TIMETABLE ENTRY
app.post('/api/admin/timetable', auth, role('admin'), (req, res) => {
  const {
    subject_id,
    day_of_week,
    start_time,
    end_time,
    room = ''
  } = req.body;

  const subject = db.prepare(
    'SELECT * FROM subjects WHERE id = ?'
  ).get(Number(subject_id));

  const days = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday',
    'Friday', 'Saturday', 'Sunday'
  ];

  const validTime = value =>
    /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));

  if (
    !subject ||
    !days.includes(day_of_week) ||
    !validTime(start_time) ||
    !validTime(end_time) ||
    start_time >= end_time
  ) {
    return res.status(400).json({
      error: 'Choose a subject, valid day, and a start time before the end time.'
    });
  }

  const faculty = subject.faculty_id;

  const conflict = db.prepare(`
    SELECT t.id
    FROM class_timetable t
    WHERE t.day_of_week = ?
      AND (
        (t.start_time < ? AND t.end_time > ?)
        OR (t.start_time < ? AND t.end_time > ?)
      )
      AND (
        t.subject_id = ?
        OR (? IS NOT NULL AND t.faculty_id = ?)
      )
  `).get(
    day_of_week,
    end_time,
    start_time,
    end_time,
    start_time,
    subject.id,
    faculty,
    faculty
  );

  if (conflict) {
    return res.status(409).json({
      error: 'Timetable conflict: this subject or faculty member already has a class during that time.'
    });
  }

  try {
    db.prepare(`
      INSERT INTO class_timetable
      (subject_id, faculty_id, day_of_week, start_time, end_time, room)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      subject.id,
      faculty,
      day_of_week,
      start_time,
      end_time,
      String(room || '')
    );

    res.status(201).json({
      message: 'Class timetable saved and published.'
    });
  } catch {
    res.status(400).json({
      error: 'Could not save this timetable slot. Check for duplicates.'
    });
  }
});

// ADMIN: DELETE TIMETABLE ENTRY
app.delete('/api/admin/timetable/:id', auth, role('admin'), (req, res) => {
  const info = db.prepare(
    'DELETE FROM class_timetable WHERE id = ?'
  ).run(Number(req.params.id));

  if (!info.changes) {
    return res.status(404).json({
      error: 'Timetable entry not found.'
    });
  }

  res.json({ message: 'Timetable entry removed.' });
});

// ADMIN: ATTENDANCE SUMMARY
app.get('/api/admin/attendance-summary', auth, role('admin'), (req, res) => {
  const requestedMonth = String(req.query.month || '');

  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
    ? requestedMonth
    : new Date().toISOString().slice(0, 7);

  const subjects = db.prepare(`
    SELECT s.id AS subject_id, s.code, s.name AS subject_name,
      COUNT(a.id) AS student_records,
      COALESCE(SUM(a.present_days), 0) AS present_days,
      COALESCE(SUM(a.total_days), 0) AS total_days,
      CASE
        WHEN SUM(a.total_days) > 0
        THEN ROUND(100.0 * SUM(a.present_days) / SUM(a.total_days), 1)
        ELSE 0
      END AS percentage
    FROM subjects s
    LEFT JOIN attendance a
      ON a.subject_id = s.id AND a.month = ?
    GROUP BY s.id
    ORDER BY s.code
  `).all(month);

  const overall = db.prepare(`
    SELECT COUNT(DISTINCT student_id) AS students,
      COALESCE(SUM(present_days), 0) AS present_days,
      COALESCE(SUM(total_days), 0) AS total_days,
      CASE
        WHEN SUM(total_days) > 0
        THEN ROUND(100.0 * SUM(present_days) / SUM(total_days), 1)
        ELSE 0
      END AS percentage
    FROM attendance
    WHERE month = ?
  `).get(month);

  res.json({ month, subjects, overall });
});

// ADMIN: ADD RESULT
app.post('/api/admin/results', auth, role('admin'), (req, res) => {
  const {
    student_id,
    subject_id,
    exam_name,
    marks,
    max_marks = 100
  } = req.body;

  const student = getUser(Number(student_id));

  const subject = db.prepare(
    'SELECT * FROM subjects WHERE id = ?'
  ).get(Number(subject_id));

  if (
    !student ||
    student.role !== 'student' ||
    !subject ||
    !validText(exam_name, 120) ||
    !Number.isFinite(Number(marks)) ||
    !Number.isFinite(Number(max_marks)) ||
    Number(marks) < 0 ||
    Number(max_marks) <= 0 ||
    Number(marks) > Number(max_marks)
  ) {
    return res.status(400).json({
      error: 'Check student, subject, exam name and marks.'
    });
  }

  db.prepare(`
    INSERT INTO results
    (student_id, subject_id, exam_name, marks, max_marks)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    student.id,
    subject.id,
    String(exam_name).trim(),
    Number(marks),
    Number(max_marks)
  );

  res.status(201).json({ message: 'Result uploaded.' });
});

// ADMIN: ADD OR UPDATE ATTENDANCE
app.post('/api/admin/attendance', auth, role('admin'), (req, res) => {
  const {
    student_id,
    subject_id,
    month,
    present_days,
    total_days
  } = req.body;

  const student = getUser(Number(student_id));

  const subject = db.prepare(
    'SELECT * FROM subjects WHERE id = ?'
  ).get(Number(subject_id));

  if (
    !student ||
    student.role !== 'student' ||
    !subject ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)) ||
    !Number.isInteger(Number(present_days)) ||
    !Number.isInteger(Number(total_days)) ||
    Number(total_days) < 1 ||
    Number(present_days) < 0 ||
    Number(present_days) > Number(total_days)
  ) {
    return res.status(400).json({
      error: 'Check student, subject, month (YYYY-MM), present days and total days.'
    });
  }

  db.prepare(`
    INSERT INTO attendance
    (student_id, subject_id, month, present_days, total_days)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(student_id, subject_id, month)
    DO UPDATE SET
      present_days = excluded.present_days,
      total_days = excluded.total_days
  `).run(
    student.id,
    subject.id,
    String(month),
    Number(present_days),
    Number(total_days)
  );

  const percentage = Number(present_days) / Number(total_days) * 100;
  const subjectLabel = `${subject.code} — ${subject.name}`;
  if (percentage < 45) {
    createNotification(student.id, 'Attendance below 45%', `Your attendance for ${subjectLabel} in ${month} is ${percentage.toFixed(1)}% (${present_days}/${total_days} days). Please contact your faculty and improve your attendance.`, 'warning', `attendance:${student.id}:${subject.id}:${month}`, '/attendance');
  } else {
    // If the record was corrected above the threshold, resolve its prior warning.
    db.prepare("UPDATE notifications SET is_read=1 WHERE user_id=? AND dedupe_key=?").run(student.id, `attendance:${student.id}:${subject.id}:${month}`);
  }
  res.json({ message: percentage < 45 ? `Monthly attendance saved. A below-45% notification was sent to the student.` : 'Monthly attendance saved.' });
});

// STUDENT PERFORMANCE
app.get('/api/student/performance', auth, (req, res) => {
  if (!['student', 'admin'].includes(req.user.role)) {
    return res.status(403).json({
      error: 'Students only.'
    });
  }

  const id = req.user.role === 'admin' && req.query.student_id
    ? Number(req.query.student_id)
    : req.user.id;

  const results = db.prepare(`
    SELECT r.*, s.code, s.name AS subject_name
    FROM results r
    JOIN subjects s ON s.id = r.subject_id
    WHERE r.student_id = ?
    ORDER BY r.created_at DESC
  `).all(id);

  const attendance = db.prepare(`
    SELECT a.*, s.code, s.name AS subject_name,
      ROUND(100.0 * a.present_days / a.total_days, 1) AS percentage
    FROM attendance a
    JOIN subjects s ON s.id = a.subject_id
    WHERE a.student_id = ?
    ORDER BY a.month DESC
  `).all(id);

  const submissions = db.prepare(`
    SELECT sub.*, a.title AS assignment_title,
      s.code, s.name AS subject_name
    FROM submissions sub
    JOIN assignments a ON a.id = sub.assignment_id
    JOIN subjects s ON s.id = a.subject_id
    WHERE sub.student_id = ?
    ORDER BY sub.submitted_at DESC
  `).all(id);

  res.json({ results, attendance, submissions });
});

// ADMIN: PERFORMANCE SUMMARY
app.get('/api/admin/performance', auth, role('admin'), (_req, res) => {
  const students = db.prepare(`
    SELECT u.id, u.name, u.roll_no, u.branch, u.semester, u.scheme,
      COUNT(DISTINCT r.id) AS result_count,
      ROUND(AVG(100.0 * r.marks / r.max_marks), 1) AS avg_result
    FROM users u
    LEFT JOIN results r ON r.student_id = u.id
    WHERE u.role = 'student'
    GROUP BY u.id
    ORDER BY u.name
  `).all();

  res.json({ students });
});

// LIST ASSIGNMENTS
app.get('/api/assignments', auth, (req, res) => {
  let sql = `
    SELECT a.*, s.code, s.name AS subject_name, u.name AS faculty_name
    FROM assignments a
    JOIN subjects s ON s.id = a.subject_id
    JOIN users u ON u.id = a.faculty_id
  `;

  const args = [];
  const where = [];

  if (req.user.role === 'faculty') {
    where.push('a.faculty_id = ?');
    args.push(req.user.id);
  }

  if (req.user.role === 'student') {
    const user = getUser(req.user.id);

    where.push('s.branch = ? AND s.semester = ? AND s.scheme = ?');
    args.push(user.branch, user.semester, user.scheme);
  }

  if (where.length) {
    sql += ' WHERE ' + where.join(' AND ');
  }

  sql += ' ORDER BY a.created_at DESC';

  let rows = db.prepare(sql).all(...args);

  if (req.user.role === 'student') {
    const submissions = db.prepare(`
      SELECT assignment_id, submitted_at
      FROM submissions
      WHERE student_id = ?
    `).all(req.user.id);

    const byId = new Map(
      submissions.map(item => [
        item.assignment_id,
        item.submitted_at
      ])
    );

    rows = rows.map(assignment => ({
      ...assignment,
      submitted: byId.has(assignment.id),
      submitted_at: byId.get(assignment.id) || null
    }));
  }

  res.json({ assignments: rows });
});

// FACULTY: CREATE ASSIGNMENT
app.post('/api/assignments', auth, role('faculty'), (req, res) => {
  const {
    subject_id,
    title,
    question,
    due_date = ''
  } = req.body;

  const subject = ownedSubject(
    Number(subject_id),
    req.user.id
  );

  if (!subject) {
    return res.status(403).json({
      error: 'Subject is not assigned to you.'
    });
  }

  if (!validText(title, 150) || !validText(question, 5000)) {
    return res.status(400).json({
      error: 'Enter assignment title and question.'
    });
  }

  const info = db.prepare(`
    INSERT INTO assignments
    (subject_id, faculty_id, title, question, due_date)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    subject.id,
    req.user.id,
    title.trim(),
    question.trim(),
    String(due_date)
  );

  notifySubjectStudents(subject, 'New assignment published', `${req.user.name} added “${title.trim()}” for ${subject.code} — ${subject.name}. Due date: ${String(due_date || 'Not specified')}. Open Assignments to view the instructions.`, 'assignment', `assignment:${info.lastInsertRowid}`, '/assignments');
  res.status(201).json({
    message: 'Assignment published. Students in this subject have been notified.',
    id: info.lastInsertRowid
  });
});

// STUDENT: SUBMIT ASSIGNMENT
app.post(
  '/api/assignments/:id/submit',
  auth,
  role('student'),
  upload.single('file'),
  (req, res) => {
    const assignment = db.prepare(`
      SELECT a.*, s.branch, s.semester, s.scheme
      FROM assignments a
      JOIN subjects s ON s.id = a.subject_id
      WHERE a.id = ?
    `).get(Number(req.params.id));

    const user = getUser(req.user.id);

    if (
      !assignment ||
      assignment.branch !== user.branch ||
      assignment.semester !== user.semester ||
      assignment.scheme !== user.scheme
    ) {
      if (req.file) fs.unlinkSync(req.file.path);

      return res.status(404).json({
        error: 'Assignment not found for your semester.'
      });
    }

    const already = db.prepare(`
      SELECT id
      FROM submissions
      WHERE assignment_id = ? AND student_id = ?
    `).get(assignment.id, user.id);

    if (already) {
      if (req.file) fs.unlinkSync(req.file.path);

      return res.status(409).json({
        error: 'This assignment has already been submitted.'
      });
    }

    const answer = String(req.body.answer || '').trim();

    if (!answer && !req.file) {
      return res.status(400).json({
        error: 'Write an answer or attach a file.'
      });
    }

    try {
      db.prepare(`
        INSERT INTO submissions
        (assignment_id, student_id, answer, file_name)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(assignment_id, student_id)
        DO UPDATE SET
          answer = excluded.answer,
          file_name = excluded.file_name,
          submitted_at = CURRENT_TIMESTAMP
      `).run(
        assignment.id,
        user.id,
        answer,
        req.file ? req.file.filename : ''
      );

      const facultyId = Number(assignment.faculty_id);
      if (facultyId) createNotification(facultyId, 'Assignment submission received', `${user.name} submitted “${assignment.title}”. Open Student submissions to review it.`, 'submission', `submission:${assignment.id}:${user.id}`, '/submissions');
      res.json({ message: 'Assignment submitted.' });
    } catch {
      res.status(400).json({
        error: 'Could not submit assignment.'
      });
    }
  }
);

// LIST SUBMISSIONS
app.get('/api/submissions', auth, (req, res) => {
  if (req.user.role === 'student') {
    const submissions = db.prepare(`
      SELECT sub.*, a.title AS assignment_title, s.code
      FROM submissions sub
      JOIN assignments a ON a.id = sub.assignment_id
      JOIN subjects s ON s.id = a.subject_id
      WHERE sub.student_id = ?
      ORDER BY sub.submitted_at DESC
    `).all(req.user.id);

    return res.json({ submissions });
  }

  if (req.user.role === 'faculty') {
    const submissions = db.prepare(`
      SELECT sub.*, a.title AS assignment_title,
        u.name AS student_name, u.roll_no, s.code
      FROM submissions sub
      JOIN assignments a ON a.id = sub.assignment_id
      JOIN users u ON u.id = sub.student_id
      JOIN subjects s ON s.id = a.subject_id
      WHERE a.faculty_id = ?
      ORDER BY sub.submitted_at DESC
    `).all(req.user.id);

    return res.json({ submissions });
  }

  const submissions = db.prepare(`
    SELECT sub.*, a.title AS assignment_title,
      u.name AS student_name, s.code
    FROM submissions sub
    JOIN assignments a ON a.id = sub.assignment_id
    JOIN users u ON u.id = sub.student_id
    JOIN subjects s ON s.id = a.subject_id
    ORDER BY sub.submitted_at DESC
  `).all();

  res.json({ submissions });
});

// FACULTY: GRADE SUBMISSION
app.post('/api/submissions/:id/grade', auth, role('faculty'), (req, res) => {
  const submission = db.prepare(`
    SELECT sub.*, a.faculty_id
    FROM submissions sub
    JOIN assignments a ON a.id = sub.assignment_id
    WHERE sub.id = ?
  `).get(Number(req.params.id));

  if (!submission || submission.faculty_id !== req.user.id) {
    return res.status(404).json({
      error: 'Submission not found for your subject.'
    });
  }

  const marks = Number(req.body.marks);

  if (!Number.isFinite(marks) || marks < 0 || marks > 100) {
    return res.status(400).json({
      error: 'Marks must be from 0 to 100.'
    });
  }

  db.prepare(`
    UPDATE submissions
    SET marks = ?, feedback = ?
    WHERE id = ?
  `).run(
    marks,
    String(req.body.feedback || ''),
    submission.id
  );

  res.json({ message: 'Assignment graded.' });
});

// LIST QUIZZES
app.get('/api/quizzes', auth, (req, res) => {
  let sql = `
    SELECT q.id, q.subject_id, q.title, q.created_at,
      s.code, s.name AS subject_name
    FROM quizzes q
    JOIN subjects s ON s.id = q.subject_id
  `;

  const args = [];
  const where = [];

  if (req.user.role === 'faculty') {
    where.push('q.faculty_id = ?');
    args.push(req.user.id);
  }

  if (req.user.role === 'student') {
    const user = getUser(req.user.id);

    where.push('s.branch = ? AND s.semester = ? AND s.scheme = ?');
    args.push(user.branch, user.semester, user.scheme);
  }

  if (where.length) {
    sql += ' WHERE ' + where.join(' AND ');
  }

  sql += ' ORDER BY q.created_at DESC';

  res.json({
    quizzes: db.prepare(sql).all(...args)
  });
});

// FACULTY: CREATE QUIZ
app.post('/api/quizzes', auth, role('faculty'), (req, res) => {
  const { subject_id, title, questions } = req.body;

  const subject = ownedSubject(
    Number(subject_id),
    req.user.id
  );

  if (!subject) {
    return res.status(403).json({
      error: 'Subject is not assigned to you.'
    });
  }

  if (
    !validText(title, 150) ||
    !Array.isArray(questions) ||
    questions.length < 1 ||
    questions.length > 30
  ) {
    return res.status(400).json({
      error: 'Provide a title and 1-30 quiz questions.'
    });
  }

  for (const question of questions) {
    if (
      !validText(question.question, 500) ||
      !Array.isArray(question.options) ||
      question.options.length !== 4 ||
      !Number.isInteger(Number(question.answer)) ||
      Number(question.answer) < 0 ||
      Number(question.answer) > 3
    ) {
      return res.status(400).json({
        error: 'Each question needs text, exactly four options, and a correct option index from 0 to 3.'
      });
    }
  }

  const info = db.prepare(`
    INSERT INTO quizzes
    (subject_id, faculty_id, title, questions_json)
    VALUES (?, ?, ?, ?)
  `).run(
    subject.id,
    req.user.id,
    title.trim(),
    JSON.stringify(questions)
  );

  notifySubjectStudents(subject, 'New quiz available', `${req.user.name} published “${title.trim()}” for ${subject.code} — ${subject.name}. Open Quizzes & mock tests to attempt it.`, 'quiz', `quiz:${info.lastInsertRowid}`, '/quizzes');
  res.status(201).json({
    message: 'Quiz published. Students in this subject have been notified.',
    id: info.lastInsertRowid
  });
});

// GET ONE QUIZ
app.get('/api/quizzes/:id', auth, (req, res) => {
  const quiz = db.prepare(`
    SELECT q.*, s.branch, s.semester, s.scheme,
      s.code, s.name AS subject_name
    FROM quizzes q
    JOIN subjects s ON s.id = q.subject_id
    WHERE q.id = ?
  `).get(Number(req.params.id));

  if (!quiz) {
    return res.status(404).json({
      error: 'Quiz not found.'
    });
  }

  if (
    req.user.role === 'faculty' &&
    quiz.faculty_id !== req.user.id
  ) {
    return res.status(403).json({ error: 'Not allowed.' });
  }

  if (req.user.role === 'student') {
    const user = getUser(req.user.id);

    if (
      quiz.branch !== user.branch ||
      quiz.semester !== user.semester ||
      quiz.scheme !== user.scheme
    ) {
      return res.status(403).json({
        error: 'Quiz is not for your semester.'
      });
    }
  }

  const questions = JSON.parse(quiz.questions_json)
    .map(({ question, options }) => ({ question, options }));

  res.json({
    quiz: {
      id: quiz.id,
      title: quiz.title,
      subject_name: quiz.subject_name,
      code: quiz.code,
      questions
    }
  });
});

// STUDENT: ATTEMPT QUIZ
app.post('/api/quizzes/:id/attempt', auth, role('student'), (req, res) => {
  const quiz = db.prepare(`
    SELECT q.*, s.branch, s.semester, s.scheme
    FROM quizzes q
    JOIN subjects s ON s.id = q.subject_id
    WHERE q.id = ?
  `).get(Number(req.params.id));

  const user = getUser(req.user.id);

  if (
    !quiz ||
    quiz.branch !== user.branch ||
    quiz.semester !== user.semester ||
    quiz.scheme !== user.scheme
  ) {
    return res.status(404).json({
      error: 'Quiz not found for your semester.'
    });
  }

  const questions = JSON.parse(quiz.questions_json);
  const answers = Array.isArray(req.body.answers)
    ? req.body.answers
    : [];

  let score = 0;

  questions.forEach((question, index) => {
    if (Number(answers[index]) === Number(question.answer)) {
      score++;
    }
  });

  db.prepare(`
    INSERT INTO quiz_attempts
    (quiz_id, student_id, score, total, answers_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    quiz.id,
    user.id,
    score,
    questions.length,
    JSON.stringify(answers)
  );

  if (quiz.faculty_id) createNotification(quiz.faculty_id, 'Quiz attempt submitted', `${user.name} submitted “${quiz.title}”. Score: ${score}/${questions.length}. Open Student submissions to review attempts.`, 'submission', `quiz-attempt:${quiz.id}:${user.id}:${Date.now()}`, '/submissions');
  res.json({
    score,
    total: questions.length,
    message: `Quiz submitted successfully! You scored ${score} out of ${questions.length}.`
  });
});

// GOOGLE GEMINI STUDY ASSISTANT
// Requires an internet connection and GEMINI_API_KEY in .env.
function localAnswer(question, user) {
  const q = String(question || '').toLowerCase();

  const subjectRows = user.role === 'student'
    ? db.prepare(`
        SELECT *
        FROM subjects
        WHERE branch = ? AND semester = ? AND scheme = ?
      `).all(user.branch, user.semester, user.scheme)
    : db.prepare('SELECT * FROM subjects').all();

  const matched = subjectRows.filter(subject =>
    q.includes(subject.code.toLowerCase()) ||
    q.includes(subject.name.toLowerCase()) ||
    subject.name.toLowerCase()
      .split(/\s+/)
      .some(word => word.length > 3 && q.includes(word))
  );

  const chosen = (
    matched.length
      ? matched
      : subjectRows.filter(subject =>
          !q.trim() ||
          q.includes('exam') ||
          q.includes('study') ||
          q.includes('roadmap')
        )
  ).slice(0, 5);

  const material = [];

  for (const subject of chosen) {
    const resources = db.prepare(`
      SELECT title, type, description, url, file_name
      FROM resources
      WHERE subject_id = ?
      ORDER BY created_at DESC
      LIMIT 8
    `).all(subject.id);

    material.push({
      subject: subject.name,
      code: subject.code,
      resources
    });
  }

  return {
    answer: '',
    mode: 'online-ai',
    matchedSubjects: chosen.map(subject => ({
      id: subject.id,
      code: subject.code,
      name: subject.name
    })),
    context: material
  };
}

// GEMINI STATUS
app.get('/api/assistant/status', auth, (_req, res) => {
  res.json({
    provider: 'Google Gemini',
    configured: Boolean(
      process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY.trim()
    ),
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  });
});

// ASK GEMINI
app.post('/api/assistant/ask', auth, async (req, res) => {
  const question = String(req.body.question || '').trim();

  if (!question || question.length > 4000) {
    return res.status(400).json({
      error: 'Enter a question (up to 4000 characters).'
    });
  }

  if (
    !process.env.GEMINI_API_KEY ||
    !process.env.GEMINI_API_KEY.trim()
  ) {
    return res.status(503).json({
      error: 'Gemini API key is missing. Add GEMINI_API_KEY=your_key to the project .env file, save it, and restart the server.'
    });
  }

  const user = getUser(req.user.id);

  if (!user) {
    return res.status(401).json({
      error: 'Your account could not be found. Please sign in again.'
    });
  }

  const local = localAnswer(question, user);
  const context = JSON.stringify({
    matchedSubjects: local.matchedSubjects,
    resources: local.context
  });

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY.trim())}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text:
                'You are a friendly college study assistant. Explain in simple student-friendly language, use clear examples, formulas and step-by-step working when useful, and give exam-preparation roadmaps when requested. Use supplied academic database context where relevant. Never claim that syllabus or resources exist unless the context says so. You may answer general academic questions even when no subject matches. If a topic is not in the database context, answer from general knowledge and advise checking the official syllabus for exam-specific requirements.'
            }]
          },

          contents: [{
            role: 'user',
            parts: [{
              text:
                `Student/account context: role=${user.role}, branch=${user.branch || 'not set'}, semester=${user.semester || 'not set'}, scheme=${user.scheme || 'not set'}\n` +
                `Academic database context: ${context}\n` +
                `Question: ${question}`
            }]
          }],

          generationConfig: {
            temperature: 0.4
          }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const providerMessage = data?.error?.message;

      if (
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403
      ) {
        return res.status(502).json({
          error: 'Gemini rejected the request. Check that GEMINI_API_KEY is valid and the selected model is available.'
        });
      }

      if (response.status === 429) {
        return res.status(502).json({
          error: 'Gemini rate limit or quota reached. Check usage and quota in Google AI Studio.'
        });
      }

      return res.status(502).json({
        error: `Gemini API request failed (${response.status})${providerMessage ? ': ' + providerMessage : ''}. Check the model name and API access.`
      });
    }

    const answer = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('\n')
      .trim();

    if (typeof answer !== 'string' || !answer) {
      return res.status(502).json({
        error: 'Gemini returned an empty answer. Please try again.'
      });
    }

    return res.json({
      answer,
      mode: 'online-ai',
      matchedSubjects: local.matchedSubjects,
      model
    });
  } catch (error) {
    const timeout =
      error?.name === 'TimeoutError' ||
      error?.name === 'AbortError';

    console.error(
      'Gemini assistant request failed:',
      error?.message || error
    );

    return res.status(502).json({
      error: timeout
        ? 'Gemini took too long to respond. Please try again.'
        : 'Could not connect to Google Gemini. Check your internet connection and try again.'
    });
  }
});

// SERVE THE FRONTEND
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ERROR HANDLER
app.use((error, _req, res, _next) => {
  console.error(error.message);

  res.status(400).json({
    error: error.message || 'Request failed.'
  });
});

// START SERVER
app.listen(PORT, '0.0.0.0', () => {
  console.log(`CampusLearn listening on 0.0.0.0:${PORT}`);
  console.log(`Persistent data directory: ${DATA_DIR}`);
});