const express = require("express");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const hpp = require("hpp");
const mongoSanitize = require("express-mongo-sanitize");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const DiscordStrategy = require("passport-discord").Strategy;
const session = require("express-session");
const MongoStore = require("connect-mongo");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const CloudinaryStorage = require("multer-storage-cloudinary");
const Sentry = require("@sentry/node");
require("dotenv").config();

const isProd = process.env.NODE_ENV === "production";
Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
  tracesSampleRate: isProd ? 0.15 : 1.0,
});

const app = express();
app.disable("x-powered-by");
const DEFAULT_FRONTEND_URL = "https://vision-cart-ivory.vercel.app";
const DEFAULT_SERVER_URL = "https://vision-cart.onrender.com";
const FRONTEND_ORIGIN = (process.env.FRONTEND_URL || process.env.CLIENT_URL || DEFAULT_FRONTEND_URL).replace(/\/$/, "");
const SERVER_ORIGIN = (process.env.SERVER_URL || DEFAULT_SERVER_URL).replace(/\/$/, "");
const REQUIRED_ENV = ["MONGO_URI", "JWT_SECRET", "SESSION_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD"];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key] || !process.env[key].trim());
if (missingEnv.length) {
  console.error(`❌ Missing required env vars: ${missingEnv.join(", ")}`);
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32 || process.env.SESSION_SECRET.length < 32) {
  console.error("❌ JWT_SECRET and SESSION_SECRET must be at least 32 characters long.");
  process.exit(1);
}

const PORT = process.env.PORT || 5000;
const cloudinaryEnabled = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);
const ORDER_STATUSES = ["pending", "confirmed", "packed", "shipped", "delivered", "cancelled"];
const DELIVERY_UNLOCKED_STATUSES = new Set(["confirmed", "packed", "shipped", "delivered"]);
const DELIVERY_STORAGE_DIR = path.resolve(process.env.DELIVERY_STORAGE_DIR || path.join(__dirname, "storage", "delivery-assets"));
const DELIVERY_MAX_FILE_SIZE_MB = Math.max(5, Number(process.env.DELIVERY_MAX_FILE_SIZE_MB) || 250);
app.set("trust proxy", 1);
fs.mkdirSync(DELIVERY_STORAGE_DIR, { recursive: true });

// ─── CLOUDINARY CONFIG ────────────────────────────────────
if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "visioncart",
    resource_type: file.mimetype.startsWith("video") ? "video" : "image",
    allowed_formats: ["jpg","jpeg","png","gif","webp","mp4","webm"],
  }),
});
const upload = cloudinaryEnabled
  ? multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } })
  : multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const deliveryStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DELIVERY_STORAGE_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(0, 12);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const deliveryUpload = multer({
  storage: deliveryStorage,
  limits: { fileSize: DELIVERY_MAX_FILE_SIZE_MB * 1024 * 1024, files: 10 },
});

// ─── MIDDLEWARE ───────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "no-referrer" },
  frameguard: { action: "deny" },
  hsts: isProd ? { maxAge: 15552000, includeSubDomains: true, preload: true } : false,
}));
app.use(hpp());
app.use(mongoSanitize());
const corsOrigins = Array.from(new Set([
  FRONTEND_ORIGIN,
  ...(process.env.CLIENT_URL || "").split(","),
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
]))
  .map((o) => (o || "").trim())
  .filter(Boolean);
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
app.use("/api/", limiter);
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many auth attempts." } });
app.use("/api/auth/", authLimiter);
const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many order requests." } });
const receiptLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: { error: "Too many receipt requests." } });
const botLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many bot requests." } });
app.use("/api/bot/", botLimiter);

// ─── MONGODB ──────────────────────────────────────────────
let server;
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB Connected");
    await seedAdmin();
    await seedUpiSettings();
    await seedCatalogCategories();
    server = app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
  })
  .catch(err => { console.error("❌ MongoDB error:", err.message); process.exit(1); });

function gracefulShutdown(signal) {
  return () => {
    console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
    if (server) {
      server.close(() => {
        mongoose.connection.close(false).then(() => {
          console.log("👋 MongoDB disconnected. Goodbye.");
          process.exit(0);
        }).catch((e) => {
          console.error("❌ Error closing MongoDB:", e.message);
          process.exit(1);
        });
      });
      setTimeout(() => { console.error("⏱️ Force shutdown after timeout"); process.exit(1); }, 10000);
    } else {
      process.exit(0);
    }
  };
}
process.on("SIGTERM", gracefulShutdown("SIGTERM"));
process.on("SIGINT", gracefulShutdown("SIGINT"));
process.on("unhandledRejection", (error) => {
  Sentry.captureException(error);
  console.error("Unhandled rejection:", error);
});
process.on("uncaughtException", (error) => {
  Sentry.captureException(error);
  console.error("Uncaught exception:", error);
});

app.use(session({
  name: "vc_sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// ─── SCHEMAS ──────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  email:       { type: String, required: true, unique: true },
  password:    { type: String },
  avatar:      { type: String },
  provider:    { type: String, default: "local" },
  role:        { type: String, enum: ["user", "staff", "admin"], default: "user" },
  isAdmin:     { type: Boolean, default: false },
  permissions: { type: [String], default: ["view_orders", "update_orders", "view_receipts"] },
}, { timestamps: true });

const deliveryFileSchema = new mongoose.Schema({
  originalName: { type: String, required: true },
  storedName:   { type: String, required: true },
  mimeType:     { type: String, default: "application/octet-stream" },
  size:         { type: Number, default: 0 },
}, { _id: true, timestamps: true });

const productSchema = new mongoose.Schema({
  name:               { type: String, required: true },
  description:        { type: String },
  price:              { type: Number, required: true },
  imageUrl:           { type: String },
  mediaUrl:           { type: String },
  mediaType:          { type: String, enum: ["image", "video"], default: "image" },
  stock:              { type: Number, default: 10 },
  category:           { type: String, default: "Uncategorized" },
  views:              { type: Number, default: 0 },
  salesCount:         { type: Number, default: 0 },
  deliveryMode:       { type: String, enum: ["manual", "download", "external"], default: "manual", select: false },
  deliveryNotes:      { type: String, select: false },
  externalDeliveryUrl:{ type: String, select: false },
  deliveryFiles:      { type: [deliveryFileSchema], default: [], select: false },
}, { timestamps: true });

const receiptSchema = new mongoose.Schema({
  receiptId:  { type: String, required: true, unique: true },
  order:      { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
  user:       { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  items:      [{ name: String, qty: Number, price: Number }],
  total:      { type: Number, required: true },
  status:     { type: String, enum: ["pending", "confirmed", "rejected"], default: "pending" },
  confirmedBy:{ type: mongoose.Schema.Types.ObjectId, ref: "User" },
  confirmedAt:{ type: Date },
  discordSent:{ type: Boolean, default: false },
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  user:          { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  items:         [{ product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" }, qty: Number, price: Number }],
  total:         { type: Number, required: true },
  status:        { type: String, enum: ORDER_STATUSES, default: "pending" },
  receipt:       { type: mongoose.Schema.Types.ObjectId, ref: "Receipt" },
  messages:      [{ from: { type: String, enum: ["user", "admin"] }, text: String, createdAt: { type: Date, default: Date.now } }],
  statusHistory: [{
    status:    { type: String, enum: ORDER_STATUSES, required: true },
    note:      { type: String },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

const upiSettingsSchema = new mongoose.Schema({
  upiId:   { type: String, required: true },
  upiName: { type: String, required: true },
  qrImage: { type: String },
}, { timestamps: true });

const categorySchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true },
  description: { type: String },
  slug:        { type: String, unique: true },
}, { timestamps: true });

const announcementSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  content:  { type: String },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const couponSchema = new mongoose.Schema({
  code:            { type: String, required: true, unique: true },
  discountPercent: { type: Number, required: true, min: 1, max: 100 },
  isActive:        { type: Boolean, default: true },
  expiresAt:       { type: Date },
}, { timestamps: true });

const activityLogSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action:  { type: String, required: true },
  details: { type: String },
  ip:      { type: String },
}, { timestamps: true });

const User         = mongoose.model("User",         userSchema);
const Product      = mongoose.model("Product",      productSchema);
const Order        = mongoose.model("Order",        orderSchema);
const Receipt      = mongoose.model("Receipt",      receiptSchema);
const UpiSettings  = mongoose.model("UpiSettings",  upiSettingsSchema);
const Category     = mongoose.model("Category",     categorySchema);
const Announcement = mongoose.model("Announcement", announcementSchema);
const Coupon       = mongoose.model("Coupon",       couponSchema);
const ActivityLog  = mongoose.model("ActivityLog",  activityLogSchema);

// ─── INDEXES ───────────────────────────────────────────────
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ name: 1 });
productSchema.index({ category: 1 });
productSchema.index({ stock: 1 });
orderSchema.index({ user: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: -1 });
receiptSchema.index({ receiptId: 1 });
receiptSchema.index({ user: 1 });
receiptSchema.index({ status: 1 });
receiptSchema.index({ createdAt: -1 });

// ─── HELPERS ──────────────────────────────────────────────
function generateReceiptId() {
  return "VC-" + crypto.randomBytes(5).toString("hex").toUpperCase();
}

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeEmail = (email = "") => email.trim().toLowerCase();
const sanitizeLimit = (val) => {
  const n = Number(val);
  if (!Number.isInteger(n) || n < 1) return 50;
  return Math.min(n, 100);
};
const parsePagination = (query = {}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = sanitizeLimit(query.limit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};
const sanitizeText = (value = "", max = 2000) => String(value || "").trim().slice(0, max);
const isValidHttpUrl = (value = "") => /^https?:\/\/[^\s]+$/i.test(String(value).trim());
const normalizeDeliveryMode = (value) => {
  if (!value) return undefined;
  return ["manual", "download", "external"].includes(value) ? value : undefined;
};
const sanitizeDeliveryPayload = (payload = {}) => {
  const update = {};
  const deliveryMode = normalizeDeliveryMode(payload.deliveryMode);
  if (deliveryMode) update.deliveryMode = deliveryMode;
  if (payload.deliveryNotes !== undefined) update.deliveryNotes = sanitizeText(payload.deliveryNotes, 4000);
  if (payload.externalDeliveryUrl !== undefined) {
    const trimmed = String(payload.externalDeliveryUrl || "").trim();
    if (trimmed && !isValidHttpUrl(trimmed)) {
      throw new Error("Invalid external delivery URL");
    }
    update.externalDeliveryUrl = trimmed;
  }
  return update;
};
const canAccessOrderDeliveries = (order) => DELIVERY_UNLOCKED_STATUSES.has(order?.status);
const getDeliveryFilePath = (storedName) => path.join(DELIVERY_STORAGE_DIR, storedName);
const removeStoredDeliveryFile = (storedName) => {
  if (!storedName) return;
  const filePath = getDeliveryFilePath(storedName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};
const toPlainObject = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);
const serializeProductForCatalog = (product) => {
  const plain = toPlainObject(product);
  if (!plain) return plain;
  delete plain.deliveryFiles;
  delete plain.deliveryMode;
  delete plain.deliveryNotes;
  delete plain.externalDeliveryUrl;
  return plain;
};
const serializeProductForAdmin = (product) => {
  const plain = serializeProductForCatalog(product);
  const source = toPlainObject(product);
  return {
    ...plain,
    deliveryMode: source?.deliveryMode || "manual",
    deliveryNotes: source?.deliveryNotes || "",
    externalDeliveryUrl: source?.externalDeliveryUrl || "",
    deliveryFiles: Array.isArray(source?.deliveryFiles) ? source.deliveryFiles.map((file) => ({
      _id: file._id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
    })) : [],
  };
};
const serializeOrderDeliveryPayload = (order) => {
  const seen = new Set();
  const items = [];
  for (const item of order.items || []) {
    const product = item.product;
    if (!product || seen.has(String(product._id))) continue;
    seen.add(String(product._id));
    items.push({
      productId: product._id,
      productName: product.name,
      deliveryMode: product.deliveryMode || "manual",
      deliveryNotes: product.deliveryNotes || "",
      externalDeliveryUrl: product.externalDeliveryUrl || "",
      files: Array.isArray(product.deliveryFiles) ? product.deliveryFiles.map((file) => ({
        fileId: file._id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        downloadUrl: `/api/orders/${order._id}/delivery-files/${product._id}/${file._id}`,
      })) : [],
    });
  }
  return items;
};
const appendStatusHistory = (order, status, changedBy, note) => {
  const last = Array.isArray(order.statusHistory) ? order.statusHistory[order.statusHistory.length - 1] : null;
  if (last?.status === status) return;
  if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
  order.statusHistory.push({
    status,
    note: note ? sanitizeText(note, 500) : undefined,
    changedBy: changedBy || undefined,
    changedAt: new Date(),
  });
};

const secureCompare = (a, b) => {
  if (!a || !b) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

const botAuthMiddleware = (req, res, next) => {
  if (!secureCompare(req.headers["x-bot-secret"], process.env.DISCORD_BOT_SECRET)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
};

async function sendDiscordWebhook(payload) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) { console.error("Discord webhook error:", e.message); }
}

async function completeOrder(orderId, changedBy = null) {
  const order = await Order.findById(orderId);
  if (!order || order.status === "confirmed") return;
  order.status = "confirmed";
  appendStatusHistory(order, "confirmed", changedBy, "Payment confirmed");
  await order.save();

  // Increment salesCount for each product
  for (const item of order.items) {
    if (item.product) {
      await Product.findByIdAndUpdate(item.product, { $inc: { salesCount: item.qty } });
    }
  }
}

async function cancelOrder(orderId, changedBy = null) {
  const order = await Order.findById(orderId);
  if (!order || order.status === "cancelled") return;
  order.status = "cancelled";
  appendStatusHistory(order, "cancelled", changedBy, "Payment rejected");
  await order.save();

  // Restore stock!
  for (const item of order.items) {
    if (item.product) {
      await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.qty } });
    }
  }
}

async function seedAdmin() {
  const existing = await User.findOne({ role: "admin" });
  if (!existing) {
    const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD || "admin123", 12);
    await User.create({ name: "Admin", email: process.env.ADMIN_EMAIL, password: hashed, role: "admin", isAdmin: true });
    console.log("👤 Admin seeded");
  }
}

async function seedUpiSettings() {
  const existing = await UpiSettings.findOne();
  if (!existing) {
    await UpiSettings.create({ upiId: process.env.UPI_ID || "visioncart@upi", upiName: process.env.UPI_NAME || "VisionCart Store" });
    console.log("💳 UPI settings seeded");
  }
}

async function seedCatalogCategories() {
  const rootCategories = [
    {
      name: "All Digital Goods",
      description: "Primary catalog bucket for digital goods, including games accounts and future products.",
      slug: "all-digital-goods"
    },
    {
      name: "Goods",
      description: "General-purpose digital goods bucket for future game accounts and related items.",
      slug: "goods"
    }
  ];

  for (const category of rootCategories) {
    await Category.updateOne(
      { slug: category.slug },
      { $setOnInsert: category },
      { upsert: true }
    );
  }

  console.log("📦 Catalog categories seeded");
}

// ─── JWT ──────────────────────────────────────────────────
const signToken = (user) => jwt.sign(
  { id: user._id, isAdmin: user.isAdmin || user.role === "admin" },
  process.env.JWT_SECRET, { expiresIn: "7d" }
);

const authMiddleware = async (req, res, next) => {
  try {
    let token = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      token = auth.split(" ")[1];
    } else if (req.cookies?.vc_token) {
      token = req.cookies.vc_token;
    }
    if (!token) return res.status(401).json({ message: "Unauthorized" });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    next();
  } catch { res.status(401).json({ message: "Invalid token" }); }
};

const setTokenCookie = (res, user) => {
  const token = signToken(user);
  res.cookie("vc_token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return token;
};

const adminMiddleware = (req, res, next) => {
  if (!req.user?.isAdmin && req.user?.role !== "admin") return res.status(403).json({ message: "Admin only" });
  next();
};

const authorize = (permission) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const isUserAdmin = req.user.isAdmin || req.user.role === "admin";
    if (isUserAdmin) return next();
    if (req.user.role === "staff") {
      if (!permission || req.user.permissions.includes(permission)) {
        return next();
      }
    }
    return res.status(403).json({ message: "Forbidden: Insufficient permissions" });
  };
};

async function logActivity(userId, action, details, req) {
  try {
    const ip = req ? (req.headers["x-forwarded-for"] || req.socket.remoteAddress) : "";
    await ActivityLog.create({ user: userId, action, details, ip });
  } catch (e) {
    console.error("Failed to log activity:", e.message);
  }
}

// ─── PASSPORT ─────────────────────────────────────────────
passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => { const user = await User.findById(id); done(null, user); });

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && SERVER_ORIGIN) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${SERVER_ORIGIN}/api/auth/google/callback`,
  }, async (at, rt, profile, done) => {
    let user = await User.findOne({ email: profile.emails[0].value });
    if (!user) user = await User.create({ name: profile.displayName, email: profile.emails[0].value, avatar: profile.photos[0]?.value, provider: "google", password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10) });
    done(null, user);
  }));
}

if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && SERVER_ORIGIN) {
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID, clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: `${SERVER_ORIGIN}/api/auth/discord/callback`, scope: ["identify", "email"],
  }, async (at, rt, profile, done) => {
    let user = await User.findOne({ email: profile.email });
    if (!user) user = await User.create({ name: profile.username, email: profile.email, avatar: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null, provider: "discord", password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10) });
    done(null, user);
  }));
}

// ─── AUTH ROUTES ──────────────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "All fields required" });
    const normalizedEmail = normalizeEmail(email);
    if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters" });
    if (await User.findOne({ email: normalizedEmail })) return res.status(400).json({ message: "Email already registered" });
    const user = await User.create({ name: name.trim(), email: normalizedEmail, password: await bcrypt.hash(password, 12) });
    const token = setTokenCookie(res, user);
    res.json({ token, user: { _id: user._id, name: user.name, email: user.email, isAdmin: false } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: normalizeEmail(email) });
    if (!user || !user.password) return res.status(400).json({ message: "Invalid credentials" });
    if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ message: "Invalid credentials" });
    const token = setTokenCookie(res, user);
    res.json({ token, user: { _id: user._id, name: user.name, email: user.email, avatar: user.avatar, isAdmin: user.isAdmin || user.role === "admin" } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/auth/me", authMiddleware, (req, res) => res.json({ user: req.user }));

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("vc_token", { httpOnly: true, secure: isProd, sameSite: isProd ? "none" : "lax" });
  res.json({ message: "Logged out" });
});

// ✅ Secure admin verify
app.post("/api/auth/verify-admin", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!req.body?.password) return res.status(400).json({ message: "Password required" });
    const userWithPass = await User.findById(req.user._id);
    const valid = await bcrypt.compare(req.body.password, userWithPass.password);
    if (!valid) return res.status(403).json({ message: "Wrong admin password!" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/auth/google", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !SERVER_ORIGIN) {
    return res.status(503).json({ message: "Google OAuth is not configured" });
  }
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  passport.authenticate("google", { scope: ["profile", "email"], state })(req, res, next);
});
app.get("/api/auth/google/callback", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !SERVER_ORIGIN) {
    return res.redirect(FRONTEND_ORIGIN);
  }
  if (req.query.state !== req.session.oauthState) return res.redirect(FRONTEND_ORIGIN);
  passport.authenticate("google", { failureRedirect: FRONTEND_ORIGIN }, (err, user) => {
    if (err || !user) return res.redirect(FRONTEND_ORIGIN);
    req.logIn(user, (err) => {
      if (err) return res.redirect(FRONTEND_ORIGIN);
      setTokenCookie(res, user);
      res.redirect(FRONTEND_ORIGIN);
    });
  })(req, res, next);
});
app.get("/api/auth/discord/callback", (req, res, next) => {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !SERVER_ORIGIN) {
    return res.redirect(FRONTEND_ORIGIN);
  }
  if (req.query.state !== req.session.oauthState) return res.redirect(FRONTEND_ORIGIN);
  passport.authenticate("discord", { failureRedirect: FRONTEND_ORIGIN }, (err, user) => {
    if (err || !user) return res.redirect(FRONTEND_ORIGIN);
    req.logIn(user, (err) => {
      if (err) return res.redirect(FRONTEND_ORIGIN);
      setTokenCookie(res, user);
      res.redirect(FRONTEND_ORIGIN);
    });
  })(req, res, next);
});
app.get("/api/auth/discord", (req, res, next) => {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !SERVER_ORIGIN) {
    return res.status(503).json({ message: "Discord OAuth is not configured" });
  }
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  passport.authenticate("discord", { state })(req, res, next);
});

// ─── ADMIN MANAGEMENT ─────────────────────────────────────
// Get all admins
app.get("/api/admins", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const admins = await User.find({ $or: [{ role: "admin" }, { isAdmin: true }] }).select("-password");
    res.json({ admins });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Add new admin by email
app.post("/api/admins", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !password || !name) return res.status(400).json({ message: "Name, email and password required" });
    const normalizedEmail = normalizeEmail(email);
    if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters" });
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      // Promote existing user to admin
      existing.role = "admin"; existing.isAdmin = true;
      await existing.save();
      return res.json({ message: "User promoted to admin", user: existing });
    }
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({ name: name.trim(), email: normalizedEmail, password: hashed, role: "admin", isAdmin: true });
    res.status(201).json({ message: "Admin created", user });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Remove admin (demote to user)
app.delete("/api/admins/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.email === process.env.ADMIN_EMAIL) return res.status(403).json({ message: "Cannot remove root admin" });
    user.role = "user"; user.isAdmin = false;
    await user.save();
    res.json({ message: "Admin removed" });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── STAFF MANAGEMENT ─────────────────────────────────────
// Get all staff members
app.get("/api/staff", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const staff = await User.find({ role: "staff" }).select("-password");
    res.json({ staff });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Add/Promote a staff member
app.post("/api/staff", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { email, name, password, permissions } = req.body;
    if (!email || !name) return res.status(400).json({ message: "Name and email are required" });
    const normalizedEmail = normalizeEmail(email);
    const existing = await User.findOne({ email: normalizedEmail });
    const perms = Array.isArray(permissions) ? permissions : ["view_orders", "update_orders", "view_receipts"];
    
    if (existing) {
      existing.role = "staff";
      existing.permissions = perms;
      await existing.save();
      await logActivity(req.user._id, "STAFF_PROMOTE", `Promoted ${existing.email} to staff`, req);
      return res.json({ message: "User promoted to staff", user: existing });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ message: "Password is required and must be at least 8 characters for a new account" });
    }
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashed,
      role: "staff",
      permissions: perms
    });
    await logActivity(req.user._id, "STAFF_CREATE", `Created staff account for ${user.email}`, req);
    res.status(201).json({ message: "Staff account created", user });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Update staff permissions/role
app.put("/api/staff/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { permissions, role } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "Staff member not found" });
    
    if (permissions !== undefined && Array.isArray(permissions)) {
      user.permissions = permissions;
    }
    if (role !== undefined && ["user", "staff", "admin"].includes(role)) {
      user.role = role;
      if (role === "admin") user.isAdmin = true;
      if (role === "user") { user.isAdmin = false; user.permissions = []; }
    }
    await user.save();
    await logActivity(req.user._id, "STAFF_UPDATE", `Updated role/permissions for ${user.email}`, req);
    res.json({ message: "Staff updated successfully", user });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Demote staff to user
app.delete("/api/staff/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.role = "user";
    user.permissions = [];
    await user.save();
    await logActivity(req.user._id, "STAFF_DEMOTE", `Demoted staff member ${user.email} to user`, req);
    res.json({ message: "Staff demoted to user" });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/users", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const search = sanitizeText(req.query.search || "", 100);
    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: escapeRegex(search), $options: "i" } },
        { email: { $regex: escapeRegex(search), $options: "i" } },
      ];
    }
    const [users, total] = await Promise.all([
      User.find(filter).select("-password").sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    res.json({ users, page, totalPages: Math.ceil(total / limit), total });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put("/api/users/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid user id" });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (req.body.name !== undefined) user.name = sanitizeText(req.body.name, 120);
    if (req.body.role !== undefined && ["user", "staff", "admin"].includes(req.body.role)) {
      user.role = req.body.role;
      user.isAdmin = req.body.role === "admin";
      if (req.body.role === "user") user.permissions = [];
    }
    if (req.body.permissions !== undefined && Array.isArray(req.body.permissions)) {
      user.permissions = req.body.permissions.map((permission) => sanitizeText(permission, 60)).filter(Boolean);
    }
    await user.save();
    await logActivity(req.user._id, "USER_UPDATE", `Updated user ${user.email}`, req);
    res.json({ user: await User.findById(req.params.id).select("-password") });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── CATEGORY MANAGEMENT ──────────────────────────────────
app.get("/api/categories", async (req, res) => {
  try {
    const categories = await Category.find().sort({ name: 1 });
    res.json({ categories });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post("/api/categories", authMiddleware, authorize("manage_categories"), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Category name is required" });
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const category = await Category.create({ name: name.trim(), description, slug });
    await logActivity(req.user._id, "CATEGORY_ADD", `Created category ${name}`, req);
    res.status(201).json({ category });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ message: "Category already exists" });
    res.status(500).json({ message: e.message });
  }
});

app.put("/api/categories/:id", authMiddleware, authorize("manage_categories"), async (req, res) => {
  try {
    const { name, description } = req.body;
    const update = {};
    if (name !== undefined) {
      update.name = name.trim();
      update.slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }
    if (description !== undefined) update.description = description;
    const category = await Category.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!category) return res.status(404).json({ message: "Category not found" });
    await logActivity(req.user._id, "CATEGORY_UPDATE", `Updated category ${category.name}`, req);
    res.json({ category });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete("/api/categories/:id", authMiddleware, authorize("manage_categories"), async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    await logActivity(req.user._id, "CATEGORY_DELETE", `Deleted category ${category.name}`, req);
    res.json({ message: "Category deleted" });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── ANNOUNCEMENTS ────────────────────────────────────────
app.get("/api/announcements", async (req, res) => {
  try {
    const announcements = await Announcement.find({ isActive: true }).sort({ createdAt: -1 });
    res.json({ announcements });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/announcements/all", authMiddleware, authorize("manage_announcements"), async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 });
    res.json({ announcements });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post("/api/announcements", authMiddleware, authorize("manage_announcements"), async (req, res) => {
  try {
    const { title, content, isActive } = req.body;
    if (!title?.trim()) return res.status(400).json({ message: "Title is required" });
    const ann = await Announcement.create({ title: title.trim(), content, isActive });
    await logActivity(req.user._id, "ANNOUNCEMENT_ADD", `Created announcement: ${title}`, req);
    res.status(201).json({ announcement: ann });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put("/api/announcements/:id", authMiddleware, authorize("manage_announcements"), async (req, res) => {
  try {
    const { title, content, isActive } = req.body;
    const update = {};
    if (title !== undefined) update.title = title.trim();
    if (content !== undefined) update.content = content;
    if (isActive !== undefined) update.isActive = isActive;
    const ann = await Announcement.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!ann) return res.status(404).json({ message: "Announcement not found" });
    await logActivity(req.user._id, "ANNOUNCEMENT_UPDATE", `Updated announcement: ${ann.title}`, req);
    res.json({ announcement: ann });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete("/api/announcements/:id", authMiddleware, authorize("manage_announcements"), async (req, res) => {
  try {
    const ann = await Announcement.findByIdAndDelete(req.params.id);
    if (!ann) return res.status(404).json({ message: "Announcement not found" });
    await logActivity(req.user._id, "ANNOUNCEMENT_DELETE", `Deleted announcement: ${ann.title}`, req);
    res.json({ message: "Announcement deleted" });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── COUPONS ──────────────────────────────────────────────
app.get("/api/coupons", authMiddleware, async (req, res) => {
  try {
    const coupons = await Coupon.find({ isActive: true });
    res.json({ coupons });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/coupons/all", authMiddleware, authorize("manage_coupons"), async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.json({ coupons });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post("/api/coupons", authMiddleware, authorize("manage_coupons"), async (req, res) => {
  try {
    const { code, discountPercent, isActive, expiresAt } = req.body;
    if (!code?.trim() || !discountPercent) return res.status(400).json({ message: "Code and discount percent are required" });
    const coupon = await Coupon.create({
      code: code.trim().toUpperCase(),
      discountPercent: Number(discountPercent),
      isActive: isActive !== false,
      expiresAt: expiresAt ? new Date(expiresAt) : null
    });
    await logActivity(req.user._id, "COUPON_ADD", `Created coupon code ${coupon.code}`, req);
    res.status(201).json({ coupon });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ message: "Coupon code already exists" });
    res.status(500).json({ message: e.message });
  }
});

app.put("/api/coupons/:id", authMiddleware, authorize("manage_coupons"), async (req, res) => {
  try {
    const { code, discountPercent, isActive, expiresAt } = req.body;
    const update = {};
    if (code !== undefined) update.code = code.trim().toUpperCase();
    if (discountPercent !== undefined) update.discountPercent = Number(discountPercent);
    if (isActive !== undefined) update.isActive = isActive;
    if (expiresAt !== undefined) update.expiresAt = expiresAt ? new Date(expiresAt) : null;
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!coupon) return res.status(404).json({ message: "Coupon not found" });
    await logActivity(req.user._id, "COUPON_UPDATE", `Updated coupon ${coupon.code}`, req);
    res.json({ coupon });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete("/api/coupons/:id", authMiddleware, authorize("manage_coupons"), async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json({ message: "Coupon not found" });
    await logActivity(req.user._id, "COUPON_DELETE", `Deleted coupon ${coupon.code}`, req);
    res.json({ message: "Coupon deleted" });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── LOGS AND ACTIONS ─────────────────────────────────────
app.get("/api/logs", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const logs = await ActivityLog.find()
      .populate("user", "name email role")
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ logs });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── DEEP ANALYTICS ───────────────────────────────────────
app.get("/api/analytics/dashboard", authMiddleware, authorize("view_analytics"), async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 1. Revenue calculations
    const [allConfirmed, todayConfirmed, weekConfirmed, monthConfirmed] = await Promise.all([
      Receipt.aggregate([{ $match: { status: "confirmed" } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
      Receipt.aggregate([{ $match: { status: "confirmed", createdAt: { $gte: startOfToday } } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
      Receipt.aggregate([{ $match: { status: "confirmed", createdAt: { $gte: sevenDaysAgo } } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
      Receipt.aggregate([{ $match: { status: "confirmed", createdAt: { $gte: thirtyDaysAgo } } }, { $group: { _id: null, total: { $sum: "$total" } } }])
    ]);

    const totalRevenue = allConfirmed[0]?.total || 0;
    const todayRevenue = todayConfirmed[0]?.total || 0;
    const weeklyRevenue = weekConfirmed[0]?.total || 0;
    const monthlyRevenue = monthConfirmed[0]?.total || 0;

    // 2. Orders calculations
    const [totalOrders, pendingOrders, completedOrders, failedOrders] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: "pending" }),
      Order.countDocuments({ status: { $in: ["confirmed", "packed", "shipped", "delivered"] } }),
      Order.countDocuments({ status: "cancelled" })
    ]);

    // 3. Products metrics
    const totalProducts = await Product.countDocuments();
    const bestSellers = await Product.find().sort({ salesCount: -1 }).limit(5);
    const lowPerformers = await Product.find().sort({ salesCount: 1 }).limit(5);
    const mostViewed = await Product.find().sort({ views: -1 }).limit(5);

    // 4. Users growth
    const totalUsers = await User.countDocuments({ role: "user" });
    const newUsers = await User.countDocuments({ role: "user", createdAt: { $gte: sevenDaysAgo } });
    const returningUsers = Math.max(0, totalUsers - newUsers);

    // 5. Conversion Rate
    const conversionRate = totalOrders > 0 ? Number(((completedOrders / totalOrders) * 100).toFixed(1)) : 0;

    // 6. Category-wise performance
    const categoryStats = await Product.aggregate([
      { $group: { _id: "$category", count: { $sum: 1 }, totalSales: { $sum: "$salesCount" }, totalViews: { $sum: "$views" } } },
      { $sort: { totalSales: -1 } }
    ]);

    // 7. Graph data (last 7 days daily stats)
    const dailyStats = await Receipt.aggregate([
      { $match: { status: "confirmed", createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: "$total" },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const dailyOrders = await Order.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Fill missing dates for graphs
    const graphData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const revEntry = dailyStats.find(s => s._id === dateStr);
      const ordEntry = dailyOrders.find(s => s._id === dateStr);
      graphData.push({
        date: dateStr,
        revenue: revEntry ? revEntry.revenue : 0,
        orders: ordEntry ? ordEntry.count : 0
      });
    }

    res.json({
      revenue: { total: totalRevenue, today: todayRevenue, weekly: weeklyRevenue, monthly: monthlyRevenue },
      orders: { total: totalOrders, pending: pendingOrders, completed: completedOrders, failed: failedOrders },
      products: { total: totalProducts, bestSellers, lowPerformers, mostViewed },
      users: { total: totalUsers, new: newUsers, returning: returningUsers },
      conversionRate,
      categoryStats,
      graphData
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ─── VISION AI (GEMINI) ───────────────────────────────────
app.post("/api/ai/chat", authMiddleware, authorize(), async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(200).json({
        reply: "⚠️ **Gemini API key is not configured.** Please add the `GEMINI_API_KEY` to your backend `.env` file to enable the Vision AI assistant features."
      });
    }

    const { message, chatHistory } = req.body;
    if (!message?.trim()) return res.status(400).json({ message: "Message is required" });

    // Fetch brief stats for context grounding
    const [totalProducts, totalOrders, pendingOrders, completedOrders, failedOrders, allConfirmed] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      Order.countDocuments({ status: "pending" }),
      Order.countDocuments({ status: { $in: ["confirmed", "packed", "shipped", "delivered"] } }),
      Order.countDocuments({ status: "cancelled" }),
      Receipt.aggregate([{ $match: { status: "confirmed" } }, { $group: { _id: null, total: { $sum: "$total" } } }])
    ]);
    const totalRevenue = allConfirmed[0]?.total || 0;
    const bestSellers = await Product.find().sort({ salesCount: -1 }).limit(3);
    const lowPerformers = await Product.find().sort({ salesCount: 1 }).limit(3);
    const categoryStats = await Product.aggregate([
      { $group: { _id: "$category", count: { $sum: 1 }, totalSales: { $sum: "$salesCount" } } }
    ]);

    const systemPrompt = `You are Vision AI, the intelligent virtual store manager and assistant for VisionCart.
You have access to the store's current live metrics and data:
- Total products: ${totalProducts}
- Total orders: ${totalOrders} (Pending: ${pendingOrders}, Completed: ${completedOrders}, Cancelled: ${failedOrders})
- Total revenue: ₹${totalRevenue.toLocaleString("en-IN")}
- Best-selling products: ${bestSellers.map(p => `${p.name} (Sales: ${p.salesCount || 0})`).join(", ")}
- Low-performing products: ${lowPerformers.map(p => `${p.name} (Sales: ${p.salesCount || 0})`).join(", ")}
- Category performance: ${categoryStats.map(c => `${c._id || "Uncategorized"}: ${c.totalSales || 0} sales`).join(", ")}

Your goal is to assist the admin or staff user with running the store:
1. Explain analytics and store performance trends in simple, business-oriented terms.
2. Suggest actionable marketing, pricing, or product page copy updates.
3. Help write announcement banners, product descriptions, or reply templates for customer support chats.
4. Diagnose errors or issues related to failed orders or receipts.
Always respond in a professional, helpful, store-manager tone. Use clean markdown format (bolding, lists, bullet points, headers) for clarity.
Keep your answer relatively concise but thorough.`;

    const contents = [];
    contents.push({ role: "user", parts: [{ text: systemPrompt }] });
    contents.push({ role: "model", parts: [{ text: "Understood. I am ready to assist with VisionCart management." }] });
    
    if (Array.isArray(chatHistory)) {
      chatHistory.forEach(h => {
        contents.push({
          role: h.sender === "ai" ? "model" : "user",
          parts: [{ text: h.text }]
        });
      });
    }
    
    contents.push({ role: "user", parts: [{ text: message }] });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(200).json({
        reply: `❌ **Gemini API Error:** ${err?.error?.message || "Failed to communicate with Gemini API."}`
      });
    }

    const result = await response.json();
    const replyText = result?.candidates?.[0]?.content?.parts?.[0]?.text || "No response received from AI assistant.";

    res.json({ reply: replyText });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ─── IMAGE UPLOAD ─────────────────────────────────────────
app.post("/api/upload", authMiddleware, authorize("manage_products"), upload.single("file"), async (req, res) => {
  try {
    if (!cloudinaryEnabled) {
      return res.status(503).json({ message: "Cloudinary is not configured for media uploads" });
    }
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    res.json({
      url: req.file.path,
      mediaType: req.file.mimetype.startsWith("video") ? "video" : "image",
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── PRODUCT ROUTES ───────────────────────────────────────
app.get("/api/products", async (req, res) => {
  try {
    const { search } = req.query;
    const { page, limit, skip } = parsePagination(req.query);
    const safeSearch = typeof search === "string" ? search.trim().slice(0, 100) : "";
    const filter = safeSearch ? { name: { $regex: escapeRegex(safeSearch), $options: "i" } } : {};
    const [products, total] = await Promise.all([
      Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Product.countDocuments(filter),
    ]);
    res.json({ products: products.map(serializeProductForCatalog), page, totalPages: Math.ceil(total / limit), total });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Not found" });
    res.json({ product: serializeProductForCatalog(product) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post("/api/products", authMiddleware, authorize("manage_products"), async (req, res) => {
  try {
    const { name, description, price, imageUrl, mediaUrl, mediaType, stock, category } = req.body;
    if (!name || !price) return res.status(400).json({ message: "Name and price required" });
    const numericPrice = Number(price);
    const numericStock = stock === undefined ? 10 : Number(stock);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) return res.status(400).json({ message: "Invalid price" });
    if (!Number.isInteger(numericStock) || numericStock < 0) return res.status(400).json({ message: "Invalid stock" });
    const deliveryUpdate = sanitizeDeliveryPayload(req.body);
    const product = await Product.create({
      name: name.trim(),
      description: (description || "").trim().slice(0, 2000),
      price: numericPrice,
      imageUrl,
      mediaUrl,
      mediaType,
      stock: numericStock,
      category: category || "Uncategorized",
      ...deliveryUpdate,
    });
    await logActivity(req.user._id, "PRODUCT_ADD", `Added product ${product.name}`, req);
    res.status(201).json({ product: serializeProductForCatalog(product) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put("/api/products/:id", authMiddleware, authorize("manage_products"), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
    const allowed = ["name", "description", "price", "imageUrl", "mediaUrl", "mediaType", "stock", "category"];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (update.name !== undefined) update.name = String(update.name).trim();
    if (update.description !== undefined) update.description = String(update.description).trim().slice(0, 2000);
    if (update.price !== undefined) { const p = Number(update.price); if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ message: "Invalid price" }); update.price = p; }
    if (update.stock !== undefined) { const s = Number(update.stock); if (!Number.isInteger(s) || s < 0) return res.status(400).json({ message: "Invalid stock" }); update.stock = s; }
    Object.assign(update, sanitizeDeliveryPayload(req.body));
    const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (product) {
      await logActivity(req.user._id, "PRODUCT_UPDATE", `Updated product ${product.name}`, req);
    }
    res.json({ product: serializeProductForCatalog(product) });
  }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete("/api/products/:id", authMiddleware, authorize("manage_products"), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
    const product = await Product.findById(req.params.id).select("+deliveryFiles");
    if (!product) return res.status(404).json({ message: "Product not found" });
    for (const file of product.deliveryFiles || []) {
      removeStoredDeliveryFile(file.storedName);
    }
    await product.deleteOne();
    if (product) {
      await logActivity(req.user._id, "PRODUCT_DELETE", `Deleted product ${product.name}`, req);
    }
    res.json({ message: "Deleted" });
  }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/admin/products/:id/delivery", authMiddleware, authorize("manage_products"), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
    const product = await Product.findById(req.params.id).select("+deliveryMode +deliveryNotes +externalDeliveryUrl +deliveryFiles");
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json({ product: serializeProductForAdmin(product) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post("/api/admin/products/:id/delivery-files", authMiddleware, authorize("manage_products"), deliveryUpload.array("files", 10), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
    const product = await Product.findById(req.params.id).select("+deliveryMode +deliveryNotes +externalDeliveryUrl +deliveryFiles");
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (!Array.isArray(req.files) || req.files.length === 0) return res.status(400).json({ message: "No delivery files uploaded" });

    const incomingFiles = req.files.map((file) => ({
      originalName: sanitizeText(file.originalname, 255),
      storedName: file.filename,
      mimeType: file.mimetype || "application/octet-stream",
      size: file.size || 0,
    }));
    product.deliveryFiles = [...(product.deliveryFiles || []), ...incomingFiles];
    product.deliveryMode = "download";
    await product.save();
    await logActivity(req.user._id, "PRODUCT_DELIVERY_UPLOAD", `Uploaded delivery files for ${product.name}`, req);
    res.status(201).json({ product: serializeProductForAdmin(product) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put("/api/admin/products/:id/delivery", authMiddleware, authorize("manage_products"), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
    const product = await Product.findById(req.params.id).select("+deliveryMode +deliveryNotes +externalDeliveryUrl +deliveryFiles");
    if (!product) return res.status(404).json({ message: "Product not found" });
    Object.assign(product, sanitizeDeliveryPayload(req.body));
    await product.save();
    await logActivity(req.user._id, "PRODUCT_DELIVERY_UPDATE", `Updated delivery settings for ${product.name}`, req);
    res.json({ product: serializeProductForAdmin(product) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete("/api/admin/products/:id/delivery-files/:fileId", authMiddleware, authorize("manage_products"), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
    const product = await Product.findById(req.params.id).select("+deliveryMode +deliveryNotes +externalDeliveryUrl +deliveryFiles");
    if (!product) return res.status(404).json({ message: "Product not found" });
    const file = (product.deliveryFiles || []).find((entry) => String(entry._id) === String(req.params.fileId));
    if (!file) return res.status(404).json({ message: "Delivery file not found" });
    product.deliveryFiles = product.deliveryFiles.filter((entry) => String(entry._id) !== String(req.params.fileId));
    if (product.deliveryFiles.length === 0 && product.deliveryMode === "download") {
      product.deliveryMode = "manual";
    }
    await product.save();
    removeStoredDeliveryFile(file.storedName);
    await logActivity(req.user._id, "PRODUCT_DELIVERY_DELETE", `Removed delivery file from ${product.name}`, req);
    res.json({ product: serializeProductForAdmin(product) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── ORDER ROUTES ─────────────────────────────────────────
app.post("/api/cart/quote", async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: "Cart items required" });
    if (items.length > 50) return res.status(400).json({ message: "Too many items" });

    const productIds = items.map((item) => item.product);
    if (productIds.some((id) => !isValidObjectId(id))) return res.status(400).json({ message: "Invalid product id" });

    const products = await Product.find({ _id: { $in: productIds } });
    const productMap = new Map(products.map((product) => [String(product._id), product]));
    const quoteItems = [];
    let total = 0;

    for (const rawItem of items) {
      const product = productMap.get(String(rawItem.product));
      if (!product) return res.status(400).json({ message: "Product not found" });
      const qty = Number(rawItem.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) return res.status(400).json({ message: "Invalid quantity" });
      quoteItems.push({
        product: product._id,
        name: product.name,
        qty,
        price: product.price,
        stock: product.stock,
        available: product.stock >= qty,
      });
      total += product.price * qty;
    }

    res.json({ items: quoteItems, total, currency: "INR" });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post("/api/orders", authMiddleware, orderLimiter, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: "Order items required" });
    if (items.length > 50) return res.status(400).json({ message: "Too many items" });

    const productIds = items.map((item) => item.product);
    if (productIds.some((id) => !isValidObjectId(id))) return res.status(400).json({ message: "Invalid product id" });

    const products = await Product.find({ _id: { $in: productIds } });
    const productMap = new Map(products.map((p) => [String(p._id), p]));
    const normalizedItems = [];
    let computedTotal = 0;

    for (const rawItem of items) {
      const product = productMap.get(String(rawItem.product));
      if (!product) return res.status(400).json({ message: "Product not found" });
      const qty = Number(rawItem.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) return res.status(400).json({ message: "Invalid quantity" });
      if (product.stock < qty) return res.status(400).json({ message: `Insufficient stock for "${product.name}". Available: ${product.stock}, requested: ${qty}` });
      if (product.stock === 0) return res.status(400).json({ message: `"${product.name}" is out of stock` });
      normalizedItems.push({ product: product._id, qty, price: product.price });
      computedTotal += product.price * qty;
    }

    for (const item of normalizedItems) {
      const updated = await Product.findOneAndUpdate(
        { _id: item.product, stock: { $gte: item.qty } },
        { $inc: { stock: -item.qty } },
        { new: true }
      );
      if (!updated) return res.status(400).json({ message: "Stock changed, please retry" });
    }

    const order = await Order.create({
      user: req.user._id,
      items: normalizedItems,
      total: computedTotal,
      statusHistory: [{ status: "pending", note: "Order created", changedAt: new Date() }],
    });
    res.status(201).json({ order });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/orders/my", authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).populate("items.product").populate("receipt").sort({ createdAt: -1 });
    res.json({ orders });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/orders/all", authMiddleware, authorize("view_orders"), async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.status && ORDER_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const [orders, total] = await Promise.all([
      Order.find(filter).populate("user", "name email").populate("items.product").populate("receipt").sort({ createdAt: -1 }).skip(skip).limit(limit),
      Order.countDocuments(filter),
    ]);
    res.json({ orders, page, totalPages: Math.ceil(total / limit), total });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put("/api/orders/:id/status", authMiddleware, authorize("update_orders"), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid order id" });
    if (!ORDER_STATUSES.includes(req.body.status)) return res.status(400).json({ message: "Invalid status" });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    order.status = req.body.status;
    appendStatusHistory(order, req.body.status, req.user._id, req.body.note || "Order status updated");
    await order.save();
    res.json({ order });
  }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/orders/:id/deliveries", authMiddleware, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid order id" });
    const order = await Order.findById(req.params.id)
      .populate("user", "name email")
      .populate({
        path: "items.product",
        select: "+deliveryMode +deliveryNotes +externalDeliveryUrl +deliveryFiles name",
      });
    if (!order) return res.status(404).json({ message: "Order not found" });
    const isOwner = String(order.user._id) === String(req.user._id);
    const isAdmin = req.user.isAdmin || req.user.role === "admin" || req.user.role === "staff";
    if (!isOwner && !isAdmin) return res.status(403).json({ message: "Forbidden" });
    if (!canAccessOrderDeliveries(order)) {
      return res.status(409).json({ message: "Delivery becomes available after payment confirmation" });
    }
    res.json({
      orderId: order._id,
      status: order.status,
      deliveries: serializeOrderDeliveryPayload(order),
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/orders/:id/delivery-files/:productId/:fileId", authMiddleware, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id) || !isValidObjectId(req.params.productId) || !isValidObjectId(req.params.fileId)) {
      return res.status(400).json({ message: "Invalid identifier" });
    }
    const order = await Order.findById(req.params.id)
      .populate("user", "name email")
      .populate({
        path: "items.product",
        select: "+deliveryMode +deliveryNotes +externalDeliveryUrl +deliveryFiles name",
      });
    if (!order) return res.status(404).json({ message: "Order not found" });
    const isOwner = String(order.user._id) === String(req.user._id);
    const isAdmin = req.user.isAdmin || req.user.role === "admin" || req.user.role === "staff";
    if (!isOwner && !isAdmin) return res.status(403).json({ message: "Forbidden" });
    if (!canAccessOrderDeliveries(order)) {
      return res.status(409).json({ message: "Delivery becomes available after payment confirmation" });
    }

    const product = (order.items || [])
      .map((item) => item.product)
      .find((entry) => entry && String(entry._id) === String(req.params.productId));
    if (!product) return res.status(404).json({ message: "Product delivery not found" });

    const file = (product.deliveryFiles || []).find((entry) => String(entry._id) === String(req.params.fileId));
    if (!file) return res.status(404).json({ message: "Delivery file not found" });

    const filePath = getDeliveryFilePath(file.storedName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Stored file missing" });
    res.download(filePath, file.originalName);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── RECEIPT ROUTES ───────────────────────────────────────
// Generate receipt after payment — called from frontend after UPI payment
app.post("/api/receipts", authMiddleware, receiptLimiter, async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!isValidObjectId(orderId)) return res.status(400).json({ message: "Invalid order id" });
    const order = await Order.findById(orderId).populate("items.product").populate("user", "name email");
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.user._id.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });

    // Check if receipt already exists
    if (order.receipt) {
      const existing = await Receipt.findById(order.receipt);
      if (existing) return res.json({ receipt: existing });
    }

    const receiptId = generateReceiptId();
    const items = order.items.map(i => ({
      name: i.product?.name || "Product",
      qty: i.qty,
      price: i.price,
    }));

    const receipt = await Receipt.create({
      receiptId, order: order._id, user: req.user._id, items, total: order.total,
    });

    order.receipt = receipt._id;
    await order.save();

    // Send to Discord webhook
    const discordPayload = {
      embeds: [{
        title: `🧾 New Payment — Receipt ${receiptId}`,
        color: 0x9333ea,
        fields: [
          { name: "Customer", value: `${order.user.name} (${order.user.email})`, inline: true },
          { name: "Total", value: `₹${order.total.toLocaleString("en-IN")}`, inline: true },
          { name: "Status", value: "⏳ Pending Confirmation", inline: true },
          { name: "Items", value: items.map(i => `• ${i.name} × ${i.qty} — ₹${(i.price * i.qty).toLocaleString("en-IN")}`).join("\n") },
          { name: "Receipt ID", value: `\`${receiptId}\`` },
        ],
        footer: { text: `Use /receipt ${receiptId} to confirm or reject` },
        timestamp: new Date().toISOString(),
      }],
    };
    await sendDiscordWebhook(discordPayload);
    receipt.discordSent = true;
    await receipt.save();

    res.status(201).json({ receipt });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Get receipt by ID (user or admin)
app.get("/api/receipts/:receiptId", authMiddleware, async (req, res) => {
  try {
    const receipt = await Receipt.findOne({ receiptId: req.params.receiptId })
      .populate("user", "name email")
      .populate("order");
    if (!receipt) return res.status(404).json({ message: "Receipt not found" });
    const isOwner = receipt.user._id.toString() === req.user._id.toString();
    const isAdmin = req.user.isAdmin || req.user.role === "admin";
    if (!isOwner && !isAdmin) return res.status(403).json({ message: "Forbidden" });
    res.json({ receipt });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Admin/Staff — get all receipts
app.get("/api/receipts", authMiddleware, authorize("view_receipts"), async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.status && ["pending", "confirmed", "rejected"].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const [receipts, total] = await Promise.all([
      Receipt.find(filter).populate("user", "name email").populate("order").sort({ createdAt: -1 }).skip(skip).limit(limit),
      Receipt.countDocuments(filter),
    ]);
    res.json({ receipts, page, totalPages: Math.ceil(total / limit), total });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Admin/Staff — confirm or reject receipt (also called by Discord bot via this endpoint)
app.put("/api/receipts/:receiptId/status", authMiddleware, authorize("confirm_receipts"), async (req, res) => {
  try {
    const { status } = req.body; // "confirmed" or "rejected"
    if (!["confirmed", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    const receipt = await Receipt.findOne({ receiptId: req.params.receiptId });
    if (!receipt) return res.status(404).json({ message: "Receipt not found" });
    receipt.status = status;
    receipt.confirmedBy = req.user._id;
    receipt.confirmedAt = new Date();
    await receipt.save();

    // Update order status too (via helpers to adjust salesCount and stock)
    if (status === "confirmed") {
      await completeOrder(receipt.order, req.user._id);
    } else if (status === "rejected") {
      await cancelOrder(receipt.order, req.user._id);
    }

    // Notify Discord
    const emoji = status === "confirmed" ? "✅" : "❌";
    await sendDiscordWebhook({
      embeds: [{
        title: `${emoji} Receipt ${receipt.receiptId} — ${status.toUpperCase()}`,
        color: status === "confirmed" ? 0x22c55e : 0xef4444,
        fields: [{ name: "Total", value: `₹${receipt.total.toLocaleString("en-IN")}`, inline: true }],
        timestamp: new Date().toISOString(),
      }],
    });

    await logActivity(req.user._id, "RECEIPT_CONFIRM", `Receipt ${receipt.receiptId} status set to ${status}`, req);
    res.json({ receipt });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Discord bot endpoint — lookup receipt by ID (bot uses this with bot secret header)
app.get("/api/bot/receipt/:receiptId", botAuthMiddleware, async (req, res) => {
  try {
    const receipt = await Receipt.findOne({ receiptId: req.params.receiptId }).populate("user", "name email").populate("order");
    if (!receipt) return res.status(404).json({ message: "Receipt not found" });
    res.json({ receipt });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Discord bot endpoint — confirm/reject receipt
app.put("/api/bot/receipt/:receiptId", botAuthMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["confirmed", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    const receipt = await Receipt.findOne({ receiptId: req.params.receiptId });
    if (!receipt) return res.status(404).json({ message: "Receipt not found" });
    receipt.status = status; receipt.confirmedAt = new Date();
    await receipt.save();
    
    if (status === "confirmed") {
      await completeOrder(receipt.order);
    } else {
      await cancelOrder(receipt.order);
    }
    res.json({ receipt, message: `Receipt ${status}` });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── CHAT ROUTES ──────────────────────────────────────────
app.post("/api/orders/:id/messages", authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ message: "Empty message" });
    if (text.trim().length > 1000) return res.status(400).json({ message: "Message too long" });
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid order id" });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    const isOwner = order.user.toString() === req.user._id.toString();
    const isAdmin = req.user.isAdmin || req.user.role === "admin";
    if (!isOwner && !isAdmin) return res.status(403).json({ message: "Forbidden" });
    const msg = { from: isAdmin ? "admin" : "user", text: text.trim(), createdAt: new Date() };
    order.messages.push(msg);
    await order.save();
    res.json({ message: msg });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/orders/:id/messages", authMiddleware, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid order id" });
    const order = await Order.findById(req.params.id).populate("user", "name email");
    if (!order) return res.status(404).json({ message: "Order not found" });
    const isOwner = order.user._id.toString() === req.user._id.toString();
    const isAdmin = req.user.isAdmin || req.user.role === "admin";
    if (!isOwner && !isAdmin) return res.status(403).json({ message: "Forbidden" });
    res.json({ messages: order.messages, order: { _id: order._id, total: order.total, status: order.status, user: order.user } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── UPI ROUTES ───────────────────────────────────────────
app.get("/api/upi", async (req, res) => {
  try {
    const s = await UpiSettings.findOne();
    res.json({ upiId: s?.upiId, upiName: s?.upiName, qrImage: s?.qrImage });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put("/api/upi", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { upiId, upiName, qrImage } = req.body;
    if (!upiId || !upiName) return res.status(400).json({ message: "UPI ID and name required" });
    const settings = await UpiSettings.findOneAndUpdate({}, { upiId, upiName, ...(qrImage !== undefined && { qrImage }) }, { new: true, upsert: true });
    res.json({ settings });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── HEALTH & ROOT ────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "VisionCart API 🚀" }));
app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    status: "OK",
    service: "visioncart-backend",
    database: mongoose.connection.readyState === 1 ? "connected" : "connecting",
    timestamp: new Date().toISOString(),
  });
});
app.get("/api/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    status: "OK",
    service: "visioncart-backend",
    database: mongoose.connection.readyState === 1 ? "connected" : "connecting",
    timestamp: new Date().toISOString(),
  });
});
Sentry.setupExpressErrorHandler(app);
app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.use((err, req, res, next) => {
  if (err?.message === "CORS not allowed") return res.status(403).json({ error: "Origin not allowed" });
  Sentry.captureException(err);
  console.error("❌", err.stack);
  res.status(500).json({ error: isProd ? "Internal server error" : err.message });
});
