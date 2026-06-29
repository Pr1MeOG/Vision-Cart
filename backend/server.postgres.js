const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const hpp = require("hpp");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const DiscordStrategy = require("passport-discord").Strategy;
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const { Pool } = require("pg");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
require("dotenv").config();

const app = express();
const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.CLIENT_URL || "http://localhost:5173";
const FRONTEND_ORIGINS = [process.env.FRONTEND_URL, process.env.CLIENT_URL, "http://localhost:5173"]
  .filter(Boolean)
  .flatMap((value) => value.split(","))
  .map((origin) => origin.trim())
  .filter(Boolean);
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET;
const ORDER_STATUSES = ["pending", "confirmed", "packed", "shipped", "delivered", "cancelled"];
const RECEIPT_STATUSES = ["pending", "confirmed", "rejected"];
const DEFAULT_PERMISSIONS = ["view_orders", "update_orders", "view_receipts"];
const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD"];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key] || !process.env[key].trim());
if (missingEnv.length) {
  console.error(`Missing required env vars: ${missingEnv.join(", ")}`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32 || !SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error("JWT_SECRET and SESSION_SECRET/JWT_SECRET fallback must be at least 32 characters long.");
  process.exit(1);
}

app.disable("x-powered-by");
app.set("trust proxy", 1);

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : undefined,
});

const spacesReady = Boolean(
  process.env.DO_SPACES_KEY &&
  process.env.DO_SPACES_SECRET &&
  process.env.DO_SPACES_ENDPOINT &&
  process.env.DO_SPACES_BUCKET &&
  process.env.DO_SPACES_REGION
);

const spacesClient = spacesReady ? new S3Client({
  region: process.env.DO_SPACES_REGION,
  endpoint: process.env.DO_SPACES_ENDPOINT,
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
}) : null;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype) || /^video\/(mp4|webm)$/.test(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error("Only JPG, PNG, GIF, WebP, MP4, and WebM uploads are allowed."));
  },
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "no-referrer" },
  frameguard: { action: "deny" },
  hsts: isProd ? { maxAge: 15552000, includeSubDomains: true, preload: true } : false,
}));
app.use(hpp());

const corsOrigins = [...new Set(FRONTEND_ORIGINS)];
app.use(cors({
  origin(origin, cb) {
    if (!origin || corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("CORS not allowed"), false);
  },
  credentials: true,
}));

app.use(morgan(isProd ? "combined" : "dev"));
app.use(cookieParser());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests." } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many auth attempts." } });
const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many order requests." } });
const receiptLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: { error: "Too many receipt requests." } });
const botLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many bot requests." } });
app.use("/api/", limiter);
app.use("/api/auth/", authLimiter);
app.use("/api/bot/", botLimiter);

app.use(session({
  name: "vc_sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new PgSession({
    pool: db,
    tableName: "session",
    createTableIfMissing: true,
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  },
}));
app.use(passport.initialize());
app.use(passport.session());

const normalizeEmail = (email = "") => email.trim().toLowerCase();
const nowIso = () => new Date().toISOString();
const toNumber = (value) => Number(value || 0);
const parsePagination = (query = {}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const rawLimit = Number(query.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
  return { page, limit, offset: (page - 1) * limit };
};
const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ""));
const publicUser = (u) => u ? ({
  _id: u.id,
  id: u.id,
  name: u.name,
  email: u.email,
  avatar: u.avatar,
  provider: u.provider,
  role: u.role,
  isAdmin: Boolean(u.is_admin),
  permissions: u.permissions || [],
  createdAt: u.created_at,
  updatedAt: u.updated_at,
}) : null;
const productOut = (p) => p ? ({
  _id: p.id,
  id: p.id,
  name: p.name,
  description: p.description,
  price: toNumber(p.price),
  imageUrl: p.image_url,
  mediaUrl: p.media_url,
  mediaType: p.media_type,
  stock: Number(p.stock || 0),
  category: p.category,
  views: Number(p.views || 0),
  salesCount: Number(p.sales_count || 0),
  createdAt: p.created_at,
  updatedAt: p.updated_at,
}) : null;
const categoryOut = (c) => c ? ({ _id: c.id, id: c.id, name: c.name, description: c.description, slug: c.slug, createdAt: c.created_at, updatedAt: c.updated_at }) : null;
const couponOut = (c) => c ? ({ _id: c.id, id: c.id, code: c.code, discountPercent: Number(c.discount_percent), isActive: c.is_active, expiresAt: c.expires_at, createdAt: c.created_at }) : null;
const announcementOut = (a) => a ? ({ _id: a.id, id: a.id, title: a.title, content: a.content, isActive: a.is_active, createdAt: a.created_at, updatedAt: a.updated_at }) : null;
const upiOut = (u) => u ? ({ upiId: u.upi_id, upiName: u.upi_name, qrImage: u.qr_image || "" }) : {};
const itemProductOut = (item) => item?.product ? { ...item, product: { ...item.product, _id: item.product._id || item.product.id } } : item;
const orderOut = (o) => o ? ({
  _id: o.id,
  id: o.id,
  user: o.user ? publicUser(o.user) : undefined,
  items: Array.isArray(o.items) ? o.items.map(itemProductOut) : [],
  total: toNumber(o.total),
  status: o.status,
  receipt: o.receipt || undefined,
  messages: o.messages || [],
  createdAt: o.created_at,
  updatedAt: o.updated_at,
}) : null;
const receiptOut = (r) => r ? ({
  _id: r.id,
  id: r.id,
  receiptId: r.receipt_id,
  order: r.order_id,
  user: r.user ? publicUser(r.user) : r.user_id,
  items: r.items || [],
  total: toNumber(r.total),
  status: r.status,
  confirmedAt: r.confirmed_at,
  discordSent: r.discord_sent,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
}) : null;

async function initDb() {
  await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      password_hash text,
      avatar text,
      provider text DEFAULT 'local',
      role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','staff','admin')),
      is_admin boolean NOT NULL DEFAULT false,
      permissions jsonb NOT NULL DEFAULT '["view_orders","update_orders","view_receipts"]',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      description text DEFAULT '',
      price numeric(12,2) NOT NULL CHECK (price > 0),
      image_url text,
      media_url text,
      media_type text NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video')),
      stock integer NOT NULL DEFAULT 10 CHECK (stock >= 0),
      category text NOT NULL DEFAULT 'Uncategorized',
      views integer NOT NULL DEFAULT 0,
      sales_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS categories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL UNIQUE,
      description text DEFAULT '',
      slug text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL,
      content text DEFAULT '',
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS coupons (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text NOT NULL UNIQUE,
      discount_percent integer NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
      is_active boolean NOT NULL DEFAULT true,
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      items jsonb NOT NULL DEFAULT '[]',
      total numeric(12,2) NOT NULL CHECK (total >= 0),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','packed','shipped','delivered','cancelled')),
      receipt_id uuid,
      messages jsonb NOT NULL DEFAULT '[]',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS carts (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      items jsonb NOT NULL DEFAULT '[]',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS receipts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      receipt_id text NOT NULL UNIQUE,
      order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      items jsonb NOT NULL DEFAULT '[]',
      total numeric(12,2) NOT NULL CHECK (total >= 0),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
      confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
      confirmed_at timestamptz,
      discord_sent boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS upi_settings (
      id integer PRIMARY KEY DEFAULT 1,
      upi_id text NOT NULL,
      upi_name text NOT NULL,
      qr_image text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT one_upi_row CHECK (id = 1)
    );
    CREATE TABLE IF NOT EXISTS activity_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      action text NOT NULL,
      details text,
      ip text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
  `);
}

async function one(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

async function logActivity(userId, action, details, req) {
  try {
    await db.query(
      `INSERT INTO activity_logs (user_id, action, details, ip) VALUES ($1,$2,$3,$4)`,
      [userId || null, action, details || "", req ? (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "") : ""]
    );
  } catch (e) {
    console.error("Failed to log activity:", e.message);
  }
}

async function seedAdmin() {
  const existing = await one(`SELECT id FROM users WHERE role='admin' OR is_admin=true LIMIT 1`);
  if (existing) return;
  const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  await db.query(
    `INSERT INTO users (name,email,password_hash,role,is_admin,permissions) VALUES ($1,$2,$3,'admin',true,$4::jsonb)`,
    ["Admin", normalizeEmail(process.env.ADMIN_EMAIL), hashed, JSON.stringify([])]
  );
}

async function seedUpiSettings() {
  await db.query(
    `INSERT INTO upi_settings (id, upi_id, upi_name, qr_image) VALUES (1,$1,$2,$3)
     ON CONFLICT (id) DO NOTHING`,
    [process.env.UPI_ID || "visioncart@upi", process.env.UPI_NAME || "VisionCart Store", ""]
  );
}

function signToken(user) {
  return jwt.sign({ id: user.id, isAdmin: user.is_admin || user.role === "admin" }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function setTokenCookie(res, user) {
  const token = signToken(user);
  res.cookie("vc_token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return token;
}

async function authMiddleware(req, res, next) {
  try {
    let token = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) token = auth.split(" ")[1];
    else if (req.cookies?.vc_token) token = req.cookies.vc_token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await one(`SELECT * FROM users WHERE id=$1`, [decoded.id]);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    req.user = publicUser(user);
    req.userRow = user;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user?.isAdmin && req.user?.role !== "admin") return res.status(403).json({ message: "Admin only" });
  next();
}

function authorize(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    if (req.user.isAdmin || req.user.role === "admin") return next();
    if (req.user.role === "staff" && (!permission || req.user.permissions?.includes(permission))) return next();
    return res.status(403).json({ message: "Forbidden: Insufficient permissions" });
  };
}

function secureCompare(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function botAuthMiddleware(req, res, next) {
  if (!secureCompare(req.headers["x-bot-secret"], process.env.DISCORD_BOT_SECRET)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

function generateReceiptId() {
  return "VC-" + crypto.randomBytes(5).toString("hex").toUpperCase();
}

function slugify(value = "") {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "category";
}

function validateProductBody(body) {
  const name = String(body.name || "").trim();
  const price = Number(body.price);
  const stock = body.stock === undefined ? 10 : Number(body.stock);
  if (!name) return "Name is required";
  if (!Number.isFinite(price) || price <= 0) return "Invalid price";
  if (!Number.isInteger(stock) || stock < 0) return "Invalid stock";
  if (body.mediaType && !["image", "video"].includes(body.mediaType)) return "Invalid media type";
  return null;
}

function spacesPublicUrl(key) {
  const endpoint = process.env.DO_SPACES_ENDPOINT.replace(/\/$/, "");
  return `${endpoint}/${process.env.DO_SPACES_BUCKET}/${key}`;
}

async function uploadToSpaces(file) {
  if (!spacesClient) throw new Error("DigitalOcean Spaces is not configured.");
  const ext = (file.originalname.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = `products/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  await spacesClient.send(new PutObjectCommand({
    Bucket: process.env.DO_SPACES_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: "public-read",
  }));
  return {
    url: spacesPublicUrl(key),
    mediaType: file.mimetype.startsWith("video") ? "video" : "image",
    key,
  };
}

async function sendDiscordWebhook(payload) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("Discord webhook error:", e.message);
  }
}

async function getOrderWithUser(id) {
  const row = await one(
    `SELECT o.*, row_to_json(u.*) AS user
     FROM orders o LEFT JOIN users u ON u.id=o.user_id
     WHERE o.id=$1`,
    [id]
  );
  if (!row) return null;
  if (row.receipt_id) {
    const receipt = await one(`SELECT receipt_id, status FROM receipts WHERE id=$1`, [row.receipt_id]);
    if (receipt) row.receipt = receipt;
  }
  return row;
}

async function completeOrder(orderId) {
  const order = await one(`SELECT * FROM orders WHERE id=$1`, [orderId]);
  if (!order || ["confirmed", "packed", "shipped", "delivered"].includes(order.status)) return;
  await db.query(`UPDATE orders SET status='confirmed', updated_at=now() WHERE id=$1`, [orderId]);
  for (const item of order.items || []) {
    if (item.product?._id || item.product?.id) {
      await db.query(`UPDATE products SET sales_count=sales_count+$1, updated_at=now() WHERE id=$2`, [Number(item.qty) || 0, item.product._id || item.product.id]);
    }
  }
}

async function cancelOrder(orderId) {
  const order = await one(`SELECT * FROM orders WHERE id=$1`, [orderId]);
  if (!order || order.status === "cancelled") return;
  await db.query(`UPDATE orders SET status='cancelled', updated_at=now() WHERE id=$1`, [orderId]);
  for (const item of order.items || []) {
    if (item.product?._id || item.product?.id) {
      await db.query(`UPDATE products SET stock=stock+$1, updated_at=now() WHERE id=$2`, [Number(item.qty) || 0, item.product._id || item.product.id]);
    }
  }
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try { done(null, await one(`SELECT * FROM users WHERE id=$1`, [id])); }
  catch (e) { done(e); }
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${SERVER_URL}/api/auth/google/callback`,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = normalizeEmail(profile.emails?.[0]?.value);
      if (!email) return done(null, false);
      let user = await one(`SELECT * FROM users WHERE email=$1`, [email]);
      if (!user) {
        user = await one(
          `INSERT INTO users (name,email,password_hash,avatar,provider) VALUES ($1,$2,$3,$4,'google') RETURNING *`,
          [profile.displayName || "Google User", email, await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10), profile.photos?.[0]?.value || null]
        );
      }
      done(null, user);
    } catch (e) { done(e); }
  }));
}

if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: `${SERVER_URL}/api/auth/discord/callback`,
    scope: ["identify", "email"],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = normalizeEmail(profile.email);
      if (!email) return done(null, false);
      let user = await one(`SELECT * FROM users WHERE email=$1`, [email]);
      const avatar = profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null;
      if (!user) {
        user = await one(
          `INSERT INTO users (name,email,password_hash,avatar,provider) VALUES ($1,$2,$3,$4,'discord') RETURNING *`,
          [profile.username || "Discord User", email, await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10), avatar]
        );
      }
      done(null, user);
    } catch (e) { done(e); }
  }));
}

app.get("/", (req, res) => res.json({ status: "VisionCart API" }));
app.get(["/health", "/api/health"], (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ status: "OK", timestamp: nowIso() });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    if (!name || !email || !password) return res.status(400).json({ message: "All fields required" });
    if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters" });
    const existing = await one(`SELECT id FROM users WHERE email=$1`, [email]);
    if (existing) return res.status(400).json({ message: "Email already registered" });
    const user = await one(
      `INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING *`,
      [name, email, await bcrypt.hash(password, 12)]
    );
    const token = setTokenCookie(res, user);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const user = await one(`SELECT * FROM users WHERE email=$1`, [normalizeEmail(req.body.email)]);
    if (!user || !user.password_hash) return res.status(400).json({ message: "Invalid credentials" });
    if (!await bcrypt.compare(String(req.body.password || ""), user.password_hash)) return res.status(400).json({ message: "Invalid credentials" });
    const token = setTokenCookie(res, user);
    res.json({ token, user: publicUser(user) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/auth/me", authMiddleware, (req, res) => res.json({ user: req.user }));
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("vc_token");
  res.json({ message: "Logged out" });
});
app.post("/api/auth/verify-admin", authMiddleware, adminMiddleware, async (req, res) => {
  const user = await one(`SELECT * FROM users WHERE id=$1`, [req.user._id]);
  const ok = user?.password_hash && await bcrypt.compare(String(req.body.password || ""), user.password_hash);
  if (!ok) return res.status(403).json({ message: "Wrong admin password!" });
  res.json({ ok: true });
});

app.get("/api/auth/google", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ message: "Google OAuth is not configured" });
  req.session.oauthState = crypto.randomBytes(16).toString("hex");
  passport.authenticate("google", { scope: ["profile", "email"], state: req.session.oauthState })(req, res, next);
});
app.get("/api/auth/google/callback", (req, res, next) => {
  if (req.query.state !== req.session.oauthState) return res.redirect(FRONTEND_URL.split(",")[0]);
  passport.authenticate("google", { failureRedirect: FRONTEND_URL.split(",")[0] }, (err, user) => {
    if (err || !user) return res.redirect(FRONTEND_URL.split(",")[0]);
    setTokenCookie(res, user);
    res.redirect(FRONTEND_URL.split(",")[0]);
  })(req, res, next);
});
app.get("/api/auth/discord", (req, res, next) => {
  if (!process.env.DISCORD_CLIENT_ID) return res.status(503).json({ message: "Discord OAuth is not configured" });
  req.session.oauthState = crypto.randomBytes(16).toString("hex");
  passport.authenticate("discord", { state: req.session.oauthState })(req, res, next);
});
app.get("/api/auth/discord/callback", (req, res, next) => {
  if (req.query.state !== req.session.oauthState) return res.redirect(FRONTEND_URL.split(",")[0]);
  passport.authenticate("discord", { failureRedirect: FRONTEND_URL.split(",")[0] }, (err, user) => {
    if (err || !user) return res.redirect(FRONTEND_URL.split(",")[0]);
    setTokenCookie(res, user);
    res.redirect(FRONTEND_URL.split(",")[0]);
  })(req, res, next);
});

app.get("/api/products", async (req, res) => {
  try {
    const { limit, offset, page } = parsePagination(req.query);
    const params = [];
    let where = "";
    if (req.query.category) {
      params.push(String(req.query.category));
      where = `WHERE category=$${params.length}`;
    }
    params.push(limit, offset);
    const products = await db.query(`SELECT * FROM products ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    const count = await one(`SELECT count(*)::int AS total FROM products ${where}`, params.slice(0, -2));
    res.json({ products: products.rows.map(productOut), total: count?.total || 0, page, limit });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/products/:id", async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
  const product = await one(`UPDATE products SET views=views+1 WHERE id=$1 RETURNING *`, [req.params.id]);
  if (!product) return res.status(404).json({ message: "Not found" });
  res.json({ product: productOut(product) });
});

app.post("/api/upload", authMiddleware, authorize("manage_products"), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const uploaded = await uploadToSpaces(req.file);
    res.json(uploaded);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post("/api/products", authMiddleware, authorize("manage_products"), async (req, res) => {
  try {
    const error = validateProductBody(req.body);
    if (error) return res.status(400).json({ message: error });
    const product = await one(
      `INSERT INTO products (name,description,price,image_url,media_url,media_type,stock,category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.body.name.trim(),
        req.body.description || "",
        Number(req.body.price),
        req.body.imageUrl || "",
        req.body.mediaUrl || "",
        req.body.mediaType || "image",
        Number(req.body.stock ?? 10),
        req.body.category || "Uncategorized",
      ]
    );
    await logActivity(req.user._id, "PRODUCT_ADD", `Added product ${product.name}`, req);
    res.status(201).json({ product: productOut(product) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put("/api/products/:id", authMiddleware, authorize("manage_products"), async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
    const current = await one(`SELECT * FROM products WHERE id=$1`, [req.params.id]);
    if (!current) return res.status(404).json({ message: "Product not found" });
    const next = {
      name: req.body.name ?? current.name,
      description: req.body.description ?? current.description,
      price: req.body.price ?? current.price,
      imageUrl: req.body.imageUrl ?? current.image_url,
      mediaUrl: req.body.mediaUrl ?? current.media_url,
      mediaType: req.body.mediaType ?? current.media_type,
      stock: req.body.stock ?? current.stock,
      category: req.body.category ?? current.category,
    };
    const error = validateProductBody(next);
    if (error) return res.status(400).json({ message: error });
    const product = await one(
      `UPDATE products SET name=$1,description=$2,price=$3,image_url=$4,media_url=$5,media_type=$6,stock=$7,category=$8,updated_at=now()
       WHERE id=$9 RETURNING *`,
      [next.name, next.description, Number(next.price), next.imageUrl, next.mediaUrl, next.mediaType, Number(next.stock), next.category, req.params.id]
    );
    await logActivity(req.user._id, "PRODUCT_UPDATE", `Updated product ${product.name}`, req);
    res.json({ product: productOut(product) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete("/api/products/:id", authMiddleware, authorize("manage_products"), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
  const product = await one(`DELETE FROM products WHERE id=$1 RETURNING *`, [req.params.id]);
  if (!product) return res.status(404).json({ message: "Product not found" });
  await logActivity(req.user._id, "PRODUCT_DELETE", `Deleted product ${product.name}`, req);
  res.json({ message: "Deleted" });
});

app.get("/api/cart", authMiddleware, async (req, res) => {
  const cart = await one(`SELECT * FROM carts WHERE user_id=$1`, [req.user._id]);
  res.json({ items: cart?.items || [] });
});
app.put("/api/cart", authMiddleware, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
  const cleaned = [];
  for (const item of items) {
    const productId = item.product || item.productId || item._id;
    const qty = Number(item.qty);
    if (!isUuid(productId) || !Number.isInteger(qty) || qty < 1 || qty > 20) {
      return res.status(400).json({ message: "Invalid cart item" });
    }
    const product = await one(`SELECT * FROM products WHERE id=$1`, [productId]);
    if (product) cleaned.push({ product: productOut(product), qty });
  }
  const cart = await one(
    `INSERT INTO carts (user_id,items) VALUES ($1,$2::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET items=$2::jsonb, updated_at=now()
     RETURNING *`,
    [req.user._id, JSON.stringify(cleaned)]
  );
  res.json({ items: cart.items });
});
app.post("/api/cart/items", authMiddleware, async (req, res) => {
  const productId = req.body.product || req.body.productId;
  const qty = Number(req.body.qty || 1);
  if (!isUuid(productId) || !Number.isInteger(qty) || qty < 1 || qty > 20) return res.status(400).json({ message: "Invalid cart item" });
  const product = await one(`SELECT * FROM products WHERE id=$1`, [productId]);
  if (!product) return res.status(404).json({ message: "Product not found" });
  const cart = await one(`SELECT * FROM carts WHERE user_id=$1`, [req.user._id]);
  const items = Array.isArray(cart?.items) ? cart.items : [];
  const existing = items.find((item) => String(item.product?._id || item.product?.id) === productId);
  if (existing) existing.qty = Math.min(20, Number(existing.qty || 0) + qty);
  else items.push({ product: productOut(product), qty });
  const saved = await one(
    `INSERT INTO carts (user_id,items) VALUES ($1,$2::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET items=$2::jsonb, updated_at=now()
     RETURNING *`,
    [req.user._id, JSON.stringify(items)]
  );
  res.json({ items: saved.items });
});
app.delete("/api/cart/items/:productId", authMiddleware, async (req, res) => {
  if (!isUuid(req.params.productId)) return res.status(400).json({ message: "Invalid product id" });
  const cart = await one(`SELECT * FROM carts WHERE user_id=$1`, [req.user._id]);
  const items = (cart?.items || []).filter((item) => String(item.product?._id || item.product?.id) !== req.params.productId);
  const saved = await one(
    `INSERT INTO carts (user_id,items) VALUES ($1,$2::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET items=$2::jsonb, updated_at=now()
     RETURNING *`,
    [req.user._id, JSON.stringify(items)]
  );
  res.json({ items: saved.items });
});

app.get("/api/categories", async (req, res) => {
  const rows = await db.query(`SELECT * FROM categories ORDER BY name ASC`);
  res.json({ categories: rows.rows.map(categoryOut) });
});
app.post("/api/categories", authMiddleware, authorize("manage_categories"), async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Category name is required" });
    const category = await one(
      `INSERT INTO categories (name,description,slug) VALUES ($1,$2,$3) RETURNING *`,
      [name, req.body.description || "", slugify(name)]
    );
    res.status(201).json({ category: categoryOut(category) });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ message: "Category already exists" });
    res.status(500).json({ message: e.message });
  }
});
app.put("/api/categories/:id", authMiddleware, authorize("manage_categories"), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid category id" });
  const name = req.body.name ? String(req.body.name).trim() : null;
  const category = await one(
    `UPDATE categories SET name=COALESCE($1,name), description=COALESCE($2,description), slug=COALESCE($3,slug), updated_at=now() WHERE id=$4 RETURNING *`,
    [name, req.body.description ?? null, name ? slugify(name) : null, req.params.id]
  );
  if (!category) return res.status(404).json({ message: "Category not found" });
  res.json({ category: categoryOut(category) });
});
app.delete("/api/categories/:id", authMiddleware, authorize("manage_categories"), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid category id" });
  const category = await one(`DELETE FROM categories WHERE id=$1 RETURNING *`, [req.params.id]);
  if (!category) return res.status(404).json({ message: "Category not found" });
  res.json({ message: "Category deleted" });
});

app.get("/api/announcements", async (req, res) => {
  const rows = await db.query(`SELECT * FROM announcements WHERE is_active=true ORDER BY created_at DESC`);
  res.json({ announcements: rows.rows.map(announcementOut) });
});
app.get("/api/announcements/all", authMiddleware, authorize("manage_announcements"), async (req, res) => {
  const rows = await db.query(`SELECT * FROM announcements ORDER BY created_at DESC`);
  res.json({ announcements: rows.rows.map(announcementOut) });
});
app.post("/api/announcements", authMiddleware, authorize("manage_announcements"), async (req, res) => {
  const title = String(req.body.title || "").trim();
  if (!title) return res.status(400).json({ message: "Title required" });
  const ann = await one(`INSERT INTO announcements (title,content,is_active) VALUES ($1,$2,$3) RETURNING *`, [title, req.body.content || "", req.body.isActive !== false]);
  res.status(201).json({ announcement: announcementOut(ann) });
});
app.put("/api/announcements/:id", authMiddleware, authorize("manage_announcements"), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid announcement id" });
  const ann = await one(`UPDATE announcements SET title=COALESCE($1,title),content=COALESCE($2,content),is_active=COALESCE($3,is_active),updated_at=now() WHERE id=$4 RETURNING *`, [req.body.title ?? null, req.body.content ?? null, req.body.isActive ?? null, req.params.id]);
  if (!ann) return res.status(404).json({ message: "Announcement not found" });
  res.json({ announcement: announcementOut(ann) });
});
app.delete("/api/announcements/:id", authMiddleware, authorize("manage_announcements"), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid announcement id" });
  await db.query(`DELETE FROM announcements WHERE id=$1`, [req.params.id]);
  res.json({ message: "Announcement deleted" });
});

app.get("/api/coupons", authMiddleware, async (req, res) => {
  const rows = await db.query(`SELECT * FROM coupons WHERE is_active=true AND (expires_at IS NULL OR expires_at > now())`);
  res.json({ coupons: rows.rows.map(couponOut) });
});
app.get("/api/coupons/all", authMiddleware, authorize("manage_coupons"), async (req, res) => {
  const rows = await db.query(`SELECT * FROM coupons ORDER BY created_at DESC`);
  res.json({ coupons: rows.rows.map(couponOut) });
});
app.post("/api/coupons", authMiddleware, authorize("manage_coupons"), async (req, res) => {
  try {
    const code = String(req.body.code || "").trim().toUpperCase();
    const discount = Number(req.body.discountPercent);
    if (!code || !Number.isInteger(discount) || discount < 1 || discount > 100) return res.status(400).json({ message: "Invalid coupon" });
    const coupon = await one(`INSERT INTO coupons (code,discount_percent,is_active,expires_at) VALUES ($1,$2,$3,$4) RETURNING *`, [code, discount, req.body.isActive !== false, req.body.expiresAt || null]);
    res.status(201).json({ coupon: couponOut(coupon) });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ message: "Coupon code already exists" });
    res.status(500).json({ message: e.message });
  }
});
app.put("/api/coupons/:id", authMiddleware, authorize("manage_coupons"), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid coupon id" });
  const coupon = await one(`UPDATE coupons SET code=COALESCE($1,code), discount_percent=COALESCE($2,discount_percent), is_active=COALESCE($3,is_active), expires_at=COALESCE($4,expires_at), updated_at=now() WHERE id=$5 RETURNING *`, [req.body.code?.toUpperCase() || null, req.body.discountPercent ?? null, req.body.isActive ?? null, req.body.expiresAt ?? null, req.params.id]);
  if (!coupon) return res.status(404).json({ message: "Coupon not found" });
  res.json({ coupon: couponOut(coupon) });
});
app.delete("/api/coupons/:id", authMiddleware, authorize("manage_coupons"), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid coupon id" });
  await db.query(`DELETE FROM coupons WHERE id=$1`, [req.params.id]);
  res.json({ message: "Coupon deleted" });
});

app.get("/api/admins", authMiddleware, adminMiddleware, async (req, res) => {
  const rows = await db.query(`SELECT * FROM users WHERE role='admin' OR is_admin=true ORDER BY created_at DESC`);
  res.json({ admins: rows.rows.map(publicUser) });
});
app.post("/api/admins", authMiddleware, adminMiddleware, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  if (!name || !email || password.length < 8) return res.status(400).json({ message: "Name, email and password required" });
  const existing = await one(`SELECT * FROM users WHERE email=$1`, [email]);
  let user;
  if (existing) user = await one(`UPDATE users SET role='admin', is_admin=true, updated_at=now() WHERE id=$1 RETURNING *`, [existing.id]);
  else user = await one(`INSERT INTO users (name,email,password_hash,role,is_admin,permissions) VALUES ($1,$2,$3,'admin',true,'[]') RETURNING *`, [name, email, await bcrypt.hash(password, 12)]);
  res.status(201).json({ user: publicUser(user), message: "Admin saved" });
});
app.delete("/api/admins/:id", authMiddleware, adminMiddleware, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid user id" });
  const user = await one(`SELECT * FROM users WHERE id=$1`, [req.params.id]);
  if (!user) return res.status(404).json({ message: "User not found" });
  if (user.email === normalizeEmail(process.env.ADMIN_EMAIL)) return res.status(403).json({ message: "Cannot remove root admin" });
  await db.query(`UPDATE users SET role='user', is_admin=false, permissions='[]', updated_at=now() WHERE id=$1`, [req.params.id]);
  res.json({ message: "Admin removed" });
});

app.get("/api/staff", authMiddleware, adminMiddleware, async (req, res) => {
  const rows = await db.query(`SELECT * FROM users WHERE role='staff' ORDER BY created_at DESC`);
  res.json({ staff: rows.rows.map(publicUser) });
});
app.post("/api/staff", authMiddleware, adminMiddleware, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = normalizeEmail(req.body.email);
  const perms = Array.isArray(req.body.permissions) ? req.body.permissions : DEFAULT_PERMISSIONS;
  const password = String(req.body.password || "");
  if (!name || !email) return res.status(400).json({ message: "Name and email are required" });
  const existing = await one(`SELECT * FROM users WHERE email=$1`, [email]);
  let user;
  if (existing) user = await one(`UPDATE users SET role='staff', permissions=$1::jsonb, updated_at=now() WHERE id=$2 RETURNING *`, [JSON.stringify(perms), existing.id]);
  else {
    if (password.length < 8) return res.status(400).json({ message: "Password is required and must be at least 8 characters" });
    user = await one(`INSERT INTO users (name,email,password_hash,role,permissions) VALUES ($1,$2,$3,'staff',$4::jsonb) RETURNING *`, [name, email, await bcrypt.hash(password, 12), JSON.stringify(perms)]);
  }
  res.status(201).json({ user: publicUser(user), message: "Staff saved" });
});
app.put("/api/staff/:id", authMiddleware, adminMiddleware, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid user id" });
  const role = ["user", "staff", "admin"].includes(req.body.role) ? req.body.role : null;
  const perms = Array.isArray(req.body.permissions) ? JSON.stringify(req.body.permissions) : null;
  const user = await one(`UPDATE users SET role=COALESCE($1,role), permissions=COALESCE($2::jsonb,permissions), is_admin=CASE WHEN $1='admin' THEN true WHEN $1='user' THEN false ELSE is_admin END, updated_at=now() WHERE id=$3 RETURNING *`, [role, perms, req.params.id]);
  if (!user) return res.status(404).json({ message: "Staff member not found" });
  res.json({ user: publicUser(user) });
});
app.delete("/api/staff/:id", authMiddleware, adminMiddleware, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid user id" });
  await db.query(`UPDATE users SET role='user', is_admin=false, permissions='[]', updated_at=now() WHERE id=$1`, [req.params.id]);
  res.json({ message: "Staff demoted to user" });
});

app.post("/api/orders", authMiddleware, orderLimiter, async (req, res) => {
  const client = await db.connect();
  try {
    const items = req.body.items;
    if (!Array.isArray(items) || !items.length || items.length > 50) return res.status(400).json({ message: "Order items required" });
    await client.query("BEGIN");
    const normalized = [];
    let total = 0;
    for (const item of items) {
      const productId = item.product || item.productId;
      const qty = Number(item.qty);
      if (!isUuid(productId) || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error("Invalid order item");
      const product = (await client.query(`SELECT * FROM products WHERE id=$1 FOR UPDATE`, [productId])).rows[0];
      if (!product) throw new Error("Product not found");
      if (product.stock < qty) throw new Error(`Insufficient stock for "${product.name}". Available: ${product.stock}, requested: ${qty}`);
      await client.query(`UPDATE products SET stock=stock-$1, updated_at=now() WHERE id=$2`, [qty, productId]);
      const price = toNumber(product.price);
      total += price * qty;
      normalized.push({ product: productOut(product), qty, price });
    }
    const order = (await client.query(`INSERT INTO orders (user_id,items,total,status) VALUES ($1,$2::jsonb,$3,'pending') RETURNING *`, [req.user._id, JSON.stringify(normalized), total])).rows[0];
    await client.query("COMMIT");
    res.status(201).json({ order: orderOut(order) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(400).json({ message: e.message });
  } finally {
    client.release();
  }
});

app.get("/api/orders/my", authMiddleware, async (req, res) => {
  const rows = await db.query(`SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC`, [req.user._id]);
  const orders = [];
  for (const row of rows.rows) {
    if (row.receipt_id) row.receipt = await one(`SELECT receipt_id, status FROM receipts WHERE id=$1`, [row.receipt_id]);
    orders.push(orderOut(row));
  }
  res.json({ orders });
});
app.get("/api/orders/all", authMiddleware, authorize("view_orders"), async (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);
  const params = [];
  let where = "";
  if (req.query.status && ORDER_STATUSES.includes(req.query.status)) {
    params.push(req.query.status);
    where = `WHERE o.status=$${params.length}`;
  }
  params.push(limit, offset);
  const rows = await db.query(`SELECT o.*, row_to_json(u.*) AS user FROM orders o LEFT JOIN users u ON u.id=o.user_id ${where} ORDER BY o.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const count = await one(`SELECT count(*)::int AS total FROM orders o ${where}`, params.slice(0, -2));
  res.json({ orders: rows.rows.map(orderOut), total: count?.total || 0, page, limit });
});
app.put("/api/orders/:id/status", authMiddleware, authorize("update_orders"), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid order id" });
  if (!ORDER_STATUSES.includes(req.body.status)) return res.status(400).json({ message: "Invalid status" });
  const order = await one(`UPDATE orders SET status=$1, updated_at=now() WHERE id=$2 RETURNING *`, [req.body.status, req.params.id]);
  if (!order) return res.status(404).json({ message: "Order not found" });
  res.json({ order: orderOut(order) });
});

app.post("/api/receipts", authMiddleware, receiptLimiter, async (req, res) => {
  try {
    if (!isUuid(req.body.orderId)) return res.status(400).json({ message: "Invalid order id" });
    const order = await getOrderWithUser(req.body.orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.user_id !== req.user._id) return res.status(403).json({ message: "Forbidden" });
    if (order.receipt_id) {
      const existing = await one(`SELECT * FROM receipts WHERE id=$1`, [order.receipt_id]);
      return res.json({ receipt: receiptOut(existing) });
    }
    const receiptId = generateReceiptId();
    const receipt = await one(
      `INSERT INTO receipts (receipt_id,order_id,user_id,items,total,status) VALUES ($1,$2,$3,$4::jsonb,$5,'pending') RETURNING *`,
      [receiptId, order.id, req.user._id, JSON.stringify((order.items || []).map((i) => ({ name: i.product?.name || "Product", qty: i.qty, price: i.price }))), order.total]
    );
    await db.query(`UPDATE orders SET receipt_id=$1, updated_at=now() WHERE id=$2`, [receipt.id, order.id]);
    await sendDiscordWebhook({ content: `New VisionCart receipt ${receiptId} for Rs. ${toNumber(order.total).toLocaleString("en-IN")}` });
    res.status(201).json({ receipt: receiptOut(receipt) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/receipts/:receiptId", authMiddleware, async (req, res) => {
  const receipt = await one(`SELECT r.*, row_to_json(u.*) AS user FROM receipts r LEFT JOIN users u ON u.id=r.user_id WHERE r.receipt_id=$1`, [req.params.receiptId]);
  if (!receipt) return res.status(404).json({ message: "Receipt not found" });
  if (receipt.user_id !== req.user._id && !req.user.isAdmin && req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  res.json({ receipt: receiptOut(receipt) });
});
app.get("/api/receipts", authMiddleware, authorize("view_receipts"), async (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);
  const rows = await db.query(`SELECT r.*, row_to_json(u.*) AS user FROM receipts r LEFT JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  const count = await one(`SELECT count(*)::int AS total FROM receipts`);
  res.json({ receipts: rows.rows.map(receiptOut), total: count?.total || 0, page, limit });
});

async function updateReceiptStatus(receiptId, status, userId) {
  if (!RECEIPT_STATUSES.includes(status) || status === "pending") throw new Error("Invalid status");
  const receipt = await one(`UPDATE receipts SET status=$1, confirmed_by=$2, confirmed_at=now(), updated_at=now() WHERE receipt_id=$3 RETURNING *`, [status, userId || null, receiptId]);
  if (!receipt) return null;
  if (status === "confirmed") await completeOrder(receipt.order_id);
  if (status === "rejected") await cancelOrder(receipt.order_id);
  return receipt;
}
app.put("/api/receipts/:receiptId/status", authMiddleware, authorize("confirm_receipts"), async (req, res) => {
  try {
    const receipt = await updateReceiptStatus(req.params.receiptId, req.body.status, req.user._id);
    if (!receipt) return res.status(404).json({ message: "Receipt not found" });
    res.json({ receipt: receiptOut(receipt) });
  } catch (e) { res.status(400).json({ message: e.message }); }
});
app.get("/api/bot/receipt/:receiptId", botAuthMiddleware, async (req, res) => {
  const receipt = await one(`SELECT r.*, row_to_json(u.*) AS user FROM receipts r LEFT JOIN users u ON u.id=r.user_id WHERE r.receipt_id=$1`, [req.params.receiptId]);
  if (!receipt) return res.status(404).json({ message: "Receipt not found" });
  res.json({ receipt: receiptOut(receipt) });
});
app.put("/api/bot/receipt/:receiptId", botAuthMiddleware, async (req, res) => {
  try {
    const receipt = await updateReceiptStatus(req.params.receiptId, req.body.status, null);
    if (!receipt) return res.status(404).json({ message: "Receipt not found" });
    res.json({ receipt: receiptOut(receipt), message: `Receipt ${req.body.status}` });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

app.post("/api/orders/:id/messages", authMiddleware, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid order id" });
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ message: "Empty message" });
  if (text.length > 1000) return res.status(400).json({ message: "Message too long" });
  const order = await one(`SELECT * FROM orders WHERE id=$1`, [req.params.id]);
  if (!order) return res.status(404).json({ message: "Order not found" });
  if (order.user_id !== req.user._id && !req.user.isAdmin && req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  const msg = { from: req.user.isAdmin || req.user.role === "admin" ? "admin" : "user", text, createdAt: nowIso() };
  const messages = [...(order.messages || []), msg];
  await db.query(`UPDATE orders SET messages=$1::jsonb, updated_at=now() WHERE id=$2`, [JSON.stringify(messages), req.params.id]);
  res.json({ message: msg });
});
app.get("/api/orders/:id/messages", authMiddleware, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ message: "Invalid order id" });
  const order = await getOrderWithUser(req.params.id);
  if (!order) return res.status(404).json({ message: "Order not found" });
  if (order.user_id !== req.user._id && !req.user.isAdmin && req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  res.json({ messages: order.messages || [], order: orderOut(order) });
});

app.get("/api/upi", async (req, res) => {
  const upi = await one(`SELECT * FROM upi_settings WHERE id=1`);
  res.json(upiOut(upi));
});
app.put("/api/upi", authMiddleware, adminMiddleware, async (req, res) => {
  const upiId = String(req.body.upiId || "").trim();
  const upiName = String(req.body.upiName || "").trim();
  if (!upiId || !upiName) return res.status(400).json({ message: "UPI ID and name required" });
  const upi = await one(
    `INSERT INTO upi_settings (id,upi_id,upi_name,qr_image) VALUES (1,$1,$2,$3)
     ON CONFLICT (id) DO UPDATE SET upi_id=$1, upi_name=$2, qr_image=$3, updated_at=now()
     RETURNING *`,
    [upiId, upiName, req.body.qrImage || ""]
  );
  res.json(upiOut(upi));
});

app.get("/api/logs", authMiddleware, adminMiddleware, async (req, res) => {
  const rows = await db.query(`SELECT l.*, row_to_json(u.*) AS user FROM activity_logs l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 100`);
  res.json({ logs: rows.rows.map((l) => ({ _id: l.id, action: l.action, details: l.details, ip: l.ip, user: publicUser(l.user), createdAt: l.created_at })) });
});

app.get("/api/analytics/dashboard", authMiddleware, authorize("view_analytics"), async (req, res) => {
  const totalProducts = (await one(`SELECT count(*)::int AS total FROM products`)).total;
  const totalOrders = (await one(`SELECT count(*)::int AS total FROM orders`)).total;
  const pendingOrders = (await one(`SELECT count(*)::int AS total FROM orders WHERE status='pending'`)).total;
  const completedOrders = (await one(`SELECT count(*)::int AS total FROM orders WHERE status IN ('confirmed','packed','shipped','delivered')`)).total;
  const failedOrders = (await one(`SELECT count(*)::int AS total FROM orders WHERE status='cancelled'`)).total;
  const totalRevenue = toNumber((await one(`SELECT COALESCE(sum(total),0) AS total FROM receipts WHERE status='confirmed'`)).total);
  const bestSellers = await db.query(`SELECT * FROM products ORDER BY sales_count DESC LIMIT 5`);
  const lowPerformers = await db.query(`SELECT * FROM products ORDER BY sales_count ASC LIMIT 5`);
  const mostViewed = await db.query(`SELECT * FROM products ORDER BY views DESC LIMIT 5`);
  const categoryStats = await db.query(`SELECT category AS _id, COALESCE(sum(sales_count),0)::int AS "totalSales", count(*)::int AS count FROM products GROUP BY category`);
  res.json({
    revenue: { total: totalRevenue, today: 0, week: 0, month: 0 },
    orders: { total: totalOrders, pending: pendingOrders, completed: completedOrders, failed: failedOrders },
    products: { total: totalProducts, bestSellers: bestSellers.rows.map(productOut), lowPerformers: lowPerformers.rows.map(productOut), mostViewed: mostViewed.rows.map(productOut) },
    users: { total: (await one(`SELECT count(*)::int AS total FROM users WHERE role='user'`)).total, new: 0, returning: 0 },
    conversionRate: totalOrders ? Number(((completedOrders / totalOrders) * 100).toFixed(1)) : 0,
    categoryStats: categoryStats.rows,
    graphData: [],
  });
});

app.post("/api/ai/chat", authMiddleware, authorize(), async (req, res) => {
  res.json({ reply: "VisionCart AI is disabled on this DigitalOcean-ready backend until an AI provider key is configured." });
});

app.use((err, req, res, next) => {
  if (err?.message === "CORS not allowed") return res.status(403).json({ error: "Origin not allowed" });
  console.error(err);
  res.status(500).json({ error: isProd ? "Internal server error" : err.message });
});

async function start() {
  await initDb();
  await seedAdmin();
  await seedUpiSettings();
  app.listen(PORT, () => console.log(`VisionCart API listening on ${PORT}`));
}

start().catch((e) => {
  console.error("Startup failed:", e);
  process.exit(1);
});

process.on("SIGTERM", () => db.end().finally(() => process.exit(0)));
process.on("SIGINT", () => db.end().finally(() => process.exit(0)));
