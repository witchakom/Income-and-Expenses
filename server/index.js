import express from "express";
import Database from "better-sqlite3";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const scryptAsync = promisify(scrypt);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dbPath = process.env.DB_PATH || join(root, "data", "finance.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    title TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS transactions_user_date_idx ON transactions(user_id, date DESC);
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    name TEXT NOT NULL,
    UNIQUE(user_id, type, name)
  );
`);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const makeId = () => randomBytes(16).toString("hex");
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const emailClean = (email) => String(email || "").trim().toLowerCase();
const passwordHash = async (password, salt) =>
  Buffer.from(await scryptAsync(password, salt, 64)).toString("hex");
const cookieOptions = {
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MS,
};
const sessionCleanup = setInterval(() => {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}, 60 * 60 * 1000);
sessionCleanup.unref();

const authAttempts = new Map();
app.use("/api/auth", (req, res, next) => {
  if (req.method !== "POST" || !["/signup", "/login"].includes(req.path)) return next();
  const key = req.ip || req.socket.remoteAddress || "local";
  const now = Date.now();
  const item = authAttempts.get(key);
  if (!item || now - item.start > 15 * 60 * 1000) {
    authAttempts.set(key, { start: now, count: 1 });
    return next();
  }
  item.count += 1;
  if (item.count > 20) return res.status(429).json({ error: "ลองใหม่ภายหลังเพื่อความปลอดภัย" });
  next();
});

function cookieToken(req) {
  return (req.headers.cookie || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith("finance_session="))?.slice("finance_session=".length);
}
function readSession(req) {
  const token = cookieToken(req);
  if (!token) return null;
  const session = db.prepare(`SELECT users.id, users.email, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?`).get(hashToken(token));
  if (!session || session.expires_at < Date.now()) {
    if (session) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    return null;
  }
  return { user: { id: session.id, email: session.email }, expiresAt: session.expires_at };
}
function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบอีกครั้ง" });
  req.user = session.user;
  next();
}
function setSession(res, user) {
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashToken(token), user.id, Date.now() + SESSION_MS);
  res.cookie("finance_session", token, cookieOptions);
}
const publicUser = (user) => ({ id: user.id, email: user.email });
const userByEmail = db.prepare("SELECT * FROM users WHERE email = ?");

app.post("/api/auth/signup", async (req, res, next) => {
  try {
    const email = emailClean(req.body.email);
    const password = String(req.body.password || "");
    const initialCategories = req.body.categories || {};
    if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "กรุณากรอกอีเมลให้ถูกต้อง" });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "รหัสผ่านต้องมี 8 ถึง 128 ตัวอักษร" });
    for (const type of ["income", "expense"]) {
      if (!Array.isArray(initialCategories[type]) || initialCategories[type].length > 50 || initialCategories[type].some((name) => typeof name !== "string" || !name.trim() || name.trim().length > 80)) {
        return res.status(400).json({ error: "รายการหมวดหมู่เริ่มต้นไม่ถูกต้อง" });
      }
    }
    if (userByEmail.get(email)) return res.status(409).json({ error: "อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ" });
    const id = makeId();
    const salt = randomBytes(16).toString("hex");
    const hash = await passwordHash(password, salt);
    const createUser = db.transaction(() => {
      db.prepare("INSERT INTO users (id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)").run(id, email, hash, salt);
      const insert = db.prepare("INSERT INTO categories (id, user_id, type, name) VALUES (?, ?, ?, ?)");
      for (const type of ["income", "expense"]) {
        for (const name of initialCategories[type]) {
          if (typeof name === "string" && name.trim()) insert.run(makeId(), id, type, name.trim());
        }
      }
    });
    createUser();
    const user = { id, email };
    setSession(res, user);
    res.status(201).json({ user });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const user = userByEmail.get(emailClean(req.body.email));
    const supplied = String(req.body.password || "");
    if (supplied.length > 128) return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    if (!user) return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    const hash = await passwordHash(supplied, user.password_salt);
    if (!timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.password_hash, "hex"))) {
      return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    }
    const safe = publicUser(user);
    setSession(res, safe);
    res.json({ user: safe });
  } catch (error) { next(error); }
});
app.get("/api/auth/session", (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "ยังไม่ได้เข้าสู่ระบบ" });
  res.json({ user: session.user });
});
app.post("/api/auth/logout", (req, res) => {
  const token = cookieToken(req);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  res.clearCookie("finance_session", { ...cookieOptions, maxAge: undefined });
  res.status(204).end();
});

app.get("/api/transactions", requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, type, title, amount, category, date, note, created_at
    FROM transactions WHERE user_id = ? ORDER BY date DESC, created_at DESC`).all(req.user.id);
  res.json({ transactions: rows });
});
function validateTransaction(body) {
  if (!body || typeof body !== "object") return null;
  const type = body.type;
  const title = String(body.title || "").trim();
  const category = String(body.category || "").trim();
  const date = String(body.date || "");
  const amount = Number(body.amount);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const validDate = parts && (() => {
    const parsed = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
    return parsed.getUTCFullYear() === Number(parts[1]) && parsed.getUTCMonth() === Number(parts[2]) - 1 && parsed.getUTCDate() === Number(parts[3]);
  })();
  if (!['income', 'expense'].includes(type) || !title || title.length > 160 || !category || category.length > 80 || !validDate || !Number.isFinite(amount) || amount <= 0 || amount > 999999999999 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) return null;
  return { type, title, amount, category, date, note: String(body.note || "").trim().slice(0, 2000) };
}
app.post("/api/transactions", requireAuth, (req, res) => {
  const row = validateTransaction(req.body);
  if (!row) return res.status(400).json({ error: "ข้อมูลรายการไม่ถูกต้อง" });
  const id = makeId();
  db.prepare(`INSERT INTO transactions (id, user_id, type, title, amount, category, date, note)
    VALUES (@id, @user_id, @type, @title, @amount, @category, @date, @note)`)
    .run({ id, user_id: req.user.id, ...row });
  const saved = db.prepare("SELECT id, type, title, amount, category, date, note, created_at FROM transactions WHERE id = ? AND user_id = ?").get(id, req.user.id);
  res.status(201).json({ transaction: saved });
});
app.put("/api/transactions/:id", requireAuth, (req, res) => {
  const row = validateTransaction(req.body);
  if (!row) return res.status(400).json({ error: "ข้อมูลรายการไม่ถูกต้อง" });
  const result = db.prepare(`UPDATE transactions SET type=@type, title=@title, amount=@amount,
    category=@category, date=@date, note=@note WHERE id=@id AND user_id=@user_id`)
    .run({ ...row, id: req.params.id, user_id: req.user.id });
  if (!result.changes) return res.status(404).json({ error: "ไม่พบรายการนี้" });
  const saved = db.prepare("SELECT id, type, title, amount, category, date, note, created_at FROM transactions WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  res.json({ transaction: saved });
});
app.delete("/api/transactions/:id", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: "ไม่พบรายการนี้" });
  res.status(204).end();
});
app.post("/api/transactions/import", requireAuth, (req, res) => {
  const list = req.body.transactions;
  if (!Array.isArray(list) || list.length > 5000) return res.status(400).json({ error: "ไฟล์สำรองไม่ถูกต้อง" });
  const insert = db.prepare(`INSERT INTO transactions (id, user_id, type, title, amount, category, date, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const transaction = db.transaction((items) => {
    for (const item of items) {
      const row = validateTransaction(item);
      if (!row) throw new Error("ข้อมูลในไฟล์สำรองไม่ถูกต้อง");
      insert.run(makeId(), req.user.id, row.type, row.title, row.amount, row.category, row.date, row.note);
    }
  });
  try { transaction(list); res.status(201).json({ imported: list.length }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

app.get("/api/categories", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT type, name FROM categories WHERE user_id = ? ORDER BY type, name").all(req.user.id);
  res.json({ categories: rows });
});
app.post("/api/categories", requireAuth, (req, res) => {
  const type = req.body.type;
  const name = String(req.body.name || "").trim();
  if (!['income', 'expense'].includes(type) || !name || name.length > 80) return res.status(400).json({ error: "หมวดหมู่ไม่ถูกต้อง" });
  try {
    db.prepare("INSERT INTO categories (id, user_id, type, name) VALUES (?, ?, ?, ?)").run(makeId(), req.user.id, type, name);
    res.status(201).json({ category: { type, name } });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "มีหมวดหมู่นี้แล้ว" });
    throw error;
  }
});
app.delete("/api/categories", requireAuth, (req, res) => {
  const { type, name } = req.body;
  if (!['income', 'expense'].includes(type) || typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "หมวดหมู่ไม่ถูกต้อง" });
  const count = db.prepare("SELECT COUNT(*) AS count FROM categories WHERE user_id = ? AND type = ?").get(req.user.id, type).count;
  if (count <= 1) return res.status(409).json({ error: "ต้องเหลืออย่างน้อยหนึ่งหมวดหมู่" });
  const used = db.prepare("SELECT 1 FROM transactions WHERE user_id = ? AND type = ? AND category = ? LIMIT 1").get(req.user.id, type, name);
  if (used) return res.status(409).json({ error: "หมวดหมู่นี้มีรายการใช้อยู่ ลบไม่ได้" });
  const result = db.prepare("DELETE FROM categories WHERE user_id = ? AND type = ? AND name = ?").run(req.user.id, type, name);
  if (!result.changes) return res.status(404).json({ error: "ไม่พบหมวดหมู่นี้" });
  res.status(204).end();
});

app.use("/api", (_req, res) => res.status(404).json({ error: "ไม่พบ API นี้" }));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "ระบบเกิดข้อผิดพลาด กรุณาลองใหม่" });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(join(root, "dist")));
  app.use((_req, res) => res.sendFile(join(root, "dist", "index.html")));
}

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => console.log(`Finance API running at http://${host}:${port}`));
