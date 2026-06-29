const express = require("express");

const router = express.Router();
const deps = global.__visioncartAuthDeps || {};

const {
  User,
  passport,
  bcrypt,
  crypto,
  authMiddleware,
  setTokenCookie,
  normalizeEmail,
  FRONTEND_ORIGIN,
  SERVER_ORIGIN,
  isProd,
  adminMiddleware,
} = deps;

if (!User || !passport || !bcrypt || !crypto || !authMiddleware || !setTokenCookie || !normalizeEmail) {
  throw new Error("Auth router dependencies were not initialized.");
}

router.post("/register", async (req, res) => {
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

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: normalizeEmail(email) });
    if (!user || !user.password) return res.status(400).json({ message: "Invalid credentials" });
    if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ message: "Invalid credentials" });
    const token = setTokenCookie(res, user);
    res.json({ token, user: { _id: user._id, name: user.name, email: user.email, avatar: user.avatar, isAdmin: user.isAdmin || user.role === "admin" } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.get("/me", authMiddleware, (req, res) => res.json({ user: req.user }));

router.post("/logout", (req, res) => {
  res.clearCookie("vc_token", { httpOnly: true, secure: isProd, sameSite: isProd ? "none" : "lax" });
  res.json({ message: "Logged out" });
});

router.post("/verify-admin", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!req.body?.password) return res.status(400).json({ message: "Password required" });
    const userWithPass = await User.findById(req.user._id);
    const valid = await bcrypt.compare(req.body.password, userWithPass.password);
    if (!valid) return res.status(403).json({ message: "Wrong admin password!" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.get("/google", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !SERVER_ORIGIN) {
    return res.status(503).json({ message: "Google OAuth is not configured" });
  }
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  passport.authenticate("google", { scope: ["profile", "email"], state })(req, res, next);
});

router.get("/google/callback", (req, res, next) => {
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

router.get("/discord", (req, res, next) => {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !SERVER_ORIGIN) {
    return res.status(503).json({ message: "Discord OAuth is not configured" });
  }
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  passport.authenticate("discord", { state })(req, res, next);
});

router.get("/discord/callback", (req, res, next) => {
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

module.exports = router;