import express from "express";
import pg from "pg";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const { Pool } = pg;
const scryptAsync = promisify(scrypt);
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Set it to your Neon PostgreSQL connection string.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon connection strings normally include sslmode=require. This also supports
  // deployments where the provider expects TLS without an sslmode query option.
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  max: process.env.VERCEL ? 3 : 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

let schemaPromise;
function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
        CREATE TABLE IF NOT EXISTS transactions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
          title TEXT NOT NULL,
          amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
          category TEXT NOT NULL,
          date DATE NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use("/api", async (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  try { await ensureSchema(); next(); } catch (error) { next(error); }
});
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const makeId = () => randomBytes(16).toString("hex");
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const emailClean = (email) => String(email || "").trim().toLowerCase();
const passwordHash = async (password, salt) => Buffer.from(await scryptAsync(password, salt, 64)).toString("hex");
const cookieOptions = {
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MS,
};

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
async function readSession(req) {
  const token = cookieToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const { rows } = await pool.query(`SELECT users.id, users.email, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = $1`, [tokenHash]);
  const session = rows[0];
  if (!session || Number(session.expires_at) < Date.now()) {
    if (session) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
    return null;
  }
  return { user: { id: session.id, email: session.email }, expiresAt: Number(session.expires_at) };
}
async function requireAuth(req, res, next) {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบอีกครั้ง" });
    req.user = session.user;
    next();
  } catch (error) { next(error); }
}
async function setSession(res, user) {
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [hashToken(token), user.id, Date.now() + SESSION_MS]);
  res.cookie("finance_session", token, cookieOptions);
}
const publicUser = (user) => ({ id: user.id, email: user.email });

app.post("/api/auth/signup", async (req, res, next) => {
  const client = await pool.connect().catch(next);
  if (!client) return;
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
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rowCount) return res.status(409).json({ error: "อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ" });
    const id = makeId();
    const salt = randomBytes(16).toString("hex");
    const hash = await passwordHash(password, salt);
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id, email, password_hash, password_salt) VALUES ($1, $2, $3, $4)", [id, email, hash, salt]);
    for (const type of ["income", "expense"]) {
      for (const rawName of initialCategories[type]) {
        const name = rawName.trim();
        if (name) await client.query("INSERT INTO categories (id, user_id, type, name) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, type, name) DO NOTHING", [makeId(), id, type, name]);
      }
    }
    await client.query("COMMIT");
    const user = { id, email };
    await setSession(res, user);
    res.status(201).json({ user });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return res.status(409).json({ error: "อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ" });
    next(error);
  } finally { client.release(); }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [emailClean(req.body.email)]);
    const user = result.rows[0];
    const supplied = String(req.body.password || "");
    if (supplied.length > 128 || !user) return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    const hash = await passwordHash(supplied, user.password_salt);
    if (!timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.password_hash, "hex"))) return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    const safe = publicUser(user);
    await setSession(res, safe);
    res.json({ user: safe });
  } catch (error) { next(error); }
});
app.get("/api/auth/session", async (req, res, next) => {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: "ยังไม่ได้เข้าสู่ระบบ" });
    res.json({ user: session.user });
  } catch (error) { next(error); }
});
app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = cookieToken(req);
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
    res.clearCookie("finance_session", { ...cookieOptions, maxAge: undefined });
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get("/api/transactions", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT id, type, title, amount, category, to_char(date, 'YYYY-MM-DD') AS date, note, created_at
      FROM transactions WHERE user_id = $1 ORDER BY date DESC, created_at DESC`, [req.user.id]);
    res.json({ transactions: rows.map((row) => ({ ...row, amount: Number(row.amount) })) });
  } catch (error) { next(error); }
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
  if (!["income", "expense"].includes(type) || !title || title.length > 160 || !category || category.length > 80 || !validDate || !Number.isFinite(amount) || amount <= 0 || amount > 999999999999 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) return null;
  return { type, title, amount, category, date, note: String(body.note || "").trim().slice(0, 2000) };
}
app.post("/api/transactions", requireAuth, async (req, res, next) => {
  try {
    const row = validateTransaction(req.body);
    if (!row) return res.status(400).json({ error: "ข้อมูลรายการไม่ถูกต้อง" });
    const id = makeId();
    const { rows } = await pool.query(`INSERT INTO transactions (id, user_id, type, title, amount, category, date, note)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, type, title, amount, category, to_char(date, 'YYYY-MM-DD') AS date, note, created_at`,
      [id, req.user.id, row.type, row.title, row.amount, row.category, row.date, row.note]);
    res.status(201).json({ transaction: { ...rows[0], amount: Number(rows[0].amount) } });
  } catch (error) { next(error); }
});
app.put("/api/transactions/:id", requireAuth, async (req, res, next) => {
  try {
    const row = validateTransaction(req.body);
    if (!row) return res.status(400).json({ error: "ข้อมูลรายการไม่ถูกต้อง" });
    const { rows } = await pool.query(`UPDATE transactions SET type=$1, title=$2, amount=$3, category=$4, date=$5, note=$6
      WHERE id=$7 AND user_id=$8
      RETURNING id, type, title, amount, category, to_char(date, 'YYYY-MM-DD') AS date, note, created_at`,
      [row.type, row.title, row.amount, row.category, row.date, row.note, req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: "ไม่พบรายการนี้" });
    res.json({ transaction: { ...rows[0], amount: Number(rows[0].amount) } });
  } catch (error) { next(error); }
});
app.delete("/api/transactions/:id", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM transactions WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "ไม่พบรายการนี้" });
    res.status(204).end();
  } catch (error) { next(error); }
});
app.post("/api/transactions/import", requireAuth, async (req, res, next) => {
  const list = req.body.transactions;
  if (!Array.isArray(list) || list.length > 5000) return res.status(400).json({ error: "ไฟล์สำรองไม่ถูกต้อง" });
  const client = await pool.connect().catch(next);
  if (!client) return;
  try {
    const valid = list.map(validateTransaction);
    if (valid.some((row) => !row)) return res.status(400).json({ error: "ข้อมูลในไฟล์สำรองไม่ถูกต้อง" });
    await client.query("BEGIN");
    for (const row of valid) {
      await client.query(`INSERT INTO transactions (id, user_id, type, title, amount, category, date, note)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [makeId(), req.user.id, row.type, row.title, row.amount, row.category, row.date, row.note]);
    }
    await client.query("COMMIT");
    res.status(201).json({ imported: list.length });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally { client.release(); }
});
app.get("/api/categories", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT type, name FROM categories WHERE user_id=$1 ORDER BY type, name", [req.user.id]);
    res.json({ categories: rows });
  } catch (error) { next(error); }
});
app.post("/api/categories", requireAuth, async (req, res, next) => {
  const type = req.body.type;
  const name = String(req.body.name || "").trim();
  if (!["income", "expense"].includes(type) || !name || name.length > 80) return res.status(400).json({ error: "หมวดหมู่ไม่ถูกต้อง" });
  try {
    await pool.query("INSERT INTO categories (id, user_id, type, name) VALUES ($1,$2,$3,$4)", [makeId(), req.user.id, type, name]);
    res.status(201).json({ category: { type, name } });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "มีหมวดหมู่นี้แล้ว" });
    next(error);
  }
});
app.delete("/api/categories", requireAuth, async (req, res, next) => {
  const { type, name } = req.body;
  if (!["income", "expense"].includes(type) || typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "หมวดหมู่ไม่ถูกต้อง" });
  try {
    const countResult = await pool.query("SELECT COUNT(*)::int AS count FROM categories WHERE user_id=$1 AND type=$2", [req.user.id, type]);
    if (countResult.rows[0].count <= 1) return res.status(409).json({ error: "ต้องเหลืออย่างน้อยหนึ่งหมวดหมู่" });
    const used = await pool.query("SELECT 1 FROM transactions WHERE user_id=$1 AND type=$2 AND category=$3 LIMIT 1", [req.user.id, type, name]);
    if (used.rowCount) return res.status(409).json({ error: "หมวดหมู่นี้มีรายการใช้อยู่ ลบไม่ได้" });
    const result = await pool.query("DELETE FROM categories WHERE user_id=$1 AND type=$2 AND name=$3", [req.user.id, type, name]);
    if (!result.rowCount) return res.status(404).json({ error: "ไม่พบหมวดหมู่นี้" });
    res.status(204).end();
  } catch (error) { next(error); }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "ไม่พบ API นี้" }));
app.use((error, _req, res, _next) => {
  console.error("API error:", error);
  res.status(500).json({ error: "ระบบเกิดข้อผิดพลาด กรุณาลองใหม่" });
});

// Local server entry point. Vercel imports `app` from api/index.js instead.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || "127.0.0.1";
  app.listen(port, host, () => console.log(`Finance API running at http://${host}:${port}`));
}
export { app };
