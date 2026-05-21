const express = require("express");
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
require("dotenv").config();

const app = express();
const isProd = process.env.NODE_ENV === "production";
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
app.set("trust proxy", 1);

// ─── CLOUDINARY CONFIG ────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "visioncart",
    resource_type: file.mimetype.startsWith("video") ? "video" : "image",
    allowed_formats: ["jpg","jpeg","png","gif","webp","mp4","webm"],
  }),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── MIDDLEWARE ───────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(hpp());
app.use(mongoSanitize());
const corsOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
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

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: { error: "Too many requests." } });
app.use("/api/", limiter);
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: "Too many auth attempts." } });
app.use("/api/auth/", authLimiter);
const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: "Too many order requests." } });
const receiptLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: "Too many receipt requests." } });

// ─── MONGODB ──────────────────────────────────────────────
let server;
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB Connected");
    await seedAdmin();
    await seedUpiSettings();
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

app.use(session({
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
  name:     { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String },
  avatar:   { type: String },
  provider: { type: String, default: "local" },
  role:     { type: String, enum: ["user", "admin"], default: "user" },
  isAdmin:  { type: Boolean, default: false },
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  description: { type: String },
  price:       { type: Number, required: true },
  imageUrl:    { type: String },
  mediaUrl:    { type: String },
  mediaType:   { type: String, enum: ["image", "video"], default: "image" },
  stock:       { type: Number, default: 10 },
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
  user:       { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  items:      [{ product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" }, qty: Number, price: Number }],
  total:      { type: Number, required: true },
  status:     { type: String, enum: ["pending", "paid", "cancelled"], default: "pending" },
  receipt:    { type: mongoose.Schema.Types.ObjectId, ref: "Receipt" },
  messages:   [{ from: { type: String, enum: ["user", "admin"] }, text: String, createdAt: { type: Date, default: Date.now } }],
}, { timestamps: true });

const upiSettingsSchema = new mongoose.Schema({
  upiId:   { type: String, required: true },
  upiName: { type: String, required: true },
  qrImage: { type: String },
}, { timestamps: true });

const User        = mongoose.model("User",        userSchema);
const Product     = mongoose.model("Product",     productSchema);
const Order       = mongoose.model("Order",       orderSchema);
const Receipt     = mongoose.model("Receipt",     receiptSchema);
const UpiSettings = mongoose.model("UpiSettings", upiSettingsSchema);

// ─── INDEXES ───────────────────────────────────────────────
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ name: 1 });
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

// ─── PASSPORT ─────────────────────────────────────────────
passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => { const user = await User.findById(id); done(null, user); });

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${process.env.SERVER_URL}/api/auth/google/callback`,
}, async (at, rt, profile, done) => {
  let user = await User.findOne({ email: profile.emails[0].value });
  if (!user) user = await User.create({ name: profile.displayName, email: profile.emails[0].value, avatar: profile.photos[0]?.value, provider: "google", password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10) });
  done(null, user);
}));

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID, clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: `${process.env.SERVER_URL}/api/auth/discord/callback`, scope: ["identify", "email"],
}, async (at, rt, profile, done) => {
  let user = await User.findOne({ email: profile.email });
  if (!user) user = await User.create({ name: profile.username, email: profile.email, avatar: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null, provider: "discord", password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10) });
  done(null, user);
}));

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
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  passport.authenticate("google", { scope: ["profile", "email"], state })(req, res, next);
});
app.get("/api/auth/google/callback", (req, res, next) => {
  if (req.query.state !== req.session.oauthState) return res.redirect(process.env.CLIENT_URL);
  passport.authenticate("google", { failureRedirect: process.env.CLIENT_URL }, (err, user) => {
    if (err || !user) return res.redirect(process.env.CLIENT_URL);
    req.logIn(user, (err) => {
      if (err) return res.redirect(process.env.CLIENT_URL);
      setTokenCookie(res, user);
      res.redirect(process.env.CLIENT_URL);
    });
  })(req, res, next);
});
app.get("/api/auth/discord/callback", (req, res, next) => {
  if (req.query.state !== req.session.oauthState) return res.redirect(process.env.CLIENT_URL);
  passport.authenticate("discord", { failureRedirect: process.env.CLIENT_URL }, (err, user) => {
    if (err || !user) return res.redirect(process.env.CLIENT_URL);
    req.logIn(user, (err) => {
      if (err) return res.redirect(process.env.CLIENT_URL);
      setTokenCookie(res, user);
      res.redirect(process.env.CLIENT_URL);
    });
  })(req, res, next);
});
app.get("/api/auth/discord", (req, res, next) => {
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

// ─── IMAGE UPLOAD ─────────────────────────────────────────
app.post("/api/upload", authMiddleware, adminMiddleware, upload.single("file"), async (req, res) => {
  try {
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
    res.json({ products, page, totalPages: Math.ceil(total / limit), total });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Not found" });
    res.json({ product });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post("/api/products", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, description, price, imageUrl, mediaUrl, mediaType, stock } = req.body;
    if (!name || !price) return res.status(400).json({ message: "Name and price required" });
    const numericPrice = Number(price);
    const numericStock = stock === undefined ? 10 : Number(stock);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) return res.status(400).json({ message: "Invalid price" });
    if (!Number.isInteger(numericStock) || numericStock < 0) return res.status(400).json({ message: "Invalid stock" });
    res.status(201).json({
      product: await Product.create({
        name: name.trim(),
        description: (description || "").trim().slice(0, 2000),
        price: numericPrice,
        imageUrl,
        mediaUrl,
        mediaType,
        stock: numericStock,
      }),
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put("/api/products/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
    const allowed = ["name", "description", "price", "imageUrl", "mediaUrl", "mediaType", "stock"];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (update.name !== undefined) update.name = String(update.name).trim();
    if (update.description !== undefined) update.description = String(update.description).trim().slice(0, 2000);
    if (update.price !== undefined) { const p = Number(update.price); if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ message: "Invalid price" }); update.price = p; }
    if (update.stock !== undefined) { const s = Number(update.stock); if (!Number.isInteger(s) || s < 0) return res.status(400).json({ message: "Invalid stock" }); update.stock = s; }
    res.json({ product: await Product.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }) });
  }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete("/api/products/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid product id" });
    await Product.findByIdAndDelete(req.params.id); res.json({ message: "Deleted" });
  }
  catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── ORDER ROUTES ─────────────────────────────────────────
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

    const order = await Order.create({ user: req.user._id, items: normalizedItems, total: computedTotal });
    res.status(201).json({ order });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/orders/my", authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).populate("items.product").populate("receipt").sort({ createdAt: -1 });
    res.json({ orders });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/orders/all", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.status && ["pending", "paid", "cancelled"].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const [orders, total] = await Promise.all([
      Order.find(filter).populate("user", "name email").populate("items.product").populate("receipt").sort({ createdAt: -1 }).skip(skip).limit(limit),
      Order.countDocuments(filter),
    ]);
    res.json({ orders, page, totalPages: Math.ceil(total / limit), total });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put("/api/orders/:id/status", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid order id" });
    if (!["pending", "paid", "cancelled"].includes(req.body.status)) return res.status(400).json({ message: "Invalid status" });
    res.json({ order: await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }) });
  }
  catch (e) { res.status(500).json({ message: e.message }); }
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

// Admin — get all receipts
app.get("/api/receipts", authMiddleware, adminMiddleware, async (req, res) => {
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

// Admin — confirm or reject receipt (also called by Discord bot via this endpoint)
app.put("/api/receipts/:receiptId/status", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body; // "confirmed" or "rejected"
    if (!["confirmed", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    const receipt = await Receipt.findOne({ receiptId: req.params.receiptId });
    if (!receipt) return res.status(404).json({ message: "Receipt not found" });
    receipt.status = status;
    receipt.confirmedBy = req.user._id;
    receipt.confirmedAt = new Date();
    await receipt.save();

    // Update order status too
    if (status === "confirmed") {
      await Order.findByIdAndUpdate(receipt.order, { status: "paid" });
    } else if (status === "rejected") {
      await Order.findByIdAndUpdate(receipt.order, { status: "cancelled" });
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

    res.json({ receipt });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Discord bot endpoint — lookup receipt by ID (bot uses this with bot secret header)
app.get("/api/bot/receipt/:receiptId", async (req, res) => {
  try {
    const botSecret = req.headers["x-bot-secret"];
    if (botSecret !== process.env.DISCORD_BOT_SECRET) return res.status(401).json({ message: "Unauthorized" });
    const receipt = await Receipt.findOne({ receiptId: req.params.receiptId }).populate("user", "name email").populate("order");
    if (!receipt) return res.status(404).json({ message: "Receipt not found" });
    res.json({ receipt });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Discord bot endpoint — confirm/reject receipt
app.put("/api/bot/receipt/:receiptId", async (req, res) => {
  try {
    const botSecret = req.headers["x-bot-secret"];
    if (botSecret !== process.env.DISCORD_BOT_SECRET) return res.status(401).json({ message: "Unauthorized" });
    const { status } = req.body;
    if (!["confirmed", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    const receipt = await Receipt.findOne({ receiptId: req.params.receiptId });
    if (!receipt) return res.status(404).json({ message: "Receipt not found" });
    receipt.status = status; receipt.confirmedAt = new Date();
    await receipt.save();
    if (status === "confirmed") await Order.findByIdAndUpdate(receipt.order, { status: "paid" });
    else await Order.findByIdAndUpdate(receipt.order, { status: "cancelled" });
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
app.get("/api/health", (req, res) => res.json({ status: "OK", timestamp: new Date().toISOString() }));
app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.use((err, req, res, next) => {
  if (err?.message === "CORS not allowed") return res.status(403).json({ error: "Origin not allowed" });
  console.error("❌", err.stack);
  res.status(500).json({ error: isProd ? "Internal server error" : err.message });
});
