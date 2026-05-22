import { useState, useEffect, useRef, useCallback, Component } from "react";
import { AnimatePresence, motion } from "framer-motion";

const safeArr = (v) => Array.isArray(v) ? v : [];

class AdminErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(e, info) { console.error("AdminPanel crash:", e, info); }
  render() {
    if (this.state.error) return (
      <div className="app" style={{ padding: 40, textAlign: "center" }}>
        <div style={{ color: "#f87171", fontSize: "1.2rem", marginBottom: 16 }}>⚠️ Admin Panel crashed</div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 20 }}>{this.state.error.message}</div>
        <button className="btn-primary" onClick={() => { this.setState({ error: null }); window.location.reload(); }}>Reload Page</button>
      </div>
    );
    return this.props.children;
  }
}

// ─── SVG ICONS ─────────────────────────────────────────────
const Icon = ({ name, size = 20, ...props }) => {
  const icons = {
    search: <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" {...props}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>,
    close: <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" {...props}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>,
    bag: <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" {...props}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>,
    package: <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" {...props}><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg>,
    check: <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#22c55e" strokeWidth="2.5" {...props}><path d="M20 6 9 17l-5-5"/></svg>,
    cross: <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#ef4444" strokeWidth="2.5" {...props}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>,
    lightning: <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" {...props}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
    receipt: <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" {...props}><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/></svg>,
    chat: <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" {...props}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    crown: <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" {...props}><path d="M2 19h20v3H2v-3zM3.3 5.5l5.1 5.1L12 4l3.6 6.6L20.7 5.5 22 14H2l1.3-8.5z"/></svg>,
    arrowUp: <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.5" {...props}><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>,
    shop: <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" {...props}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>,
  };
  return icons[name] || null;
};

// ─── RIPPLE HANDLER ────────────────────────────────────────
const useRipple = (ref) => {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => {
      const btn = e.target.closest('.btn-primary, .btn-buynow, .overlay-cart-btn, .btn-chat, .btn-outline, .btn-delete');
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const d = Math.max(btn.offsetWidth, btn.offsetHeight);
      const ripple = document.createElement('span');
      ripple.className = 'ripple-effect';
      ripple.style.width = ripple.style.height = d + 'px';
      ripple.style.left = (e.clientX - rect.left - d / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - d / 2) + 'px';
      btn.style.position = btn.style.position || 'relative';
      btn.style.overflow = btn.style.overflow || 'hidden';
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [ref]);
};

// ─── BACK TO TOP ───────────────────────────────────────────
const BackToTop = () => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const f = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  if (!visible) return null;
  return (
    <motion.button
      className="back-to-top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      aria-label="Back to top"
    >
      <Icon name="arrowUp" size={20} />
    </motion.button>
  );
};

const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const UPI_ID = import.meta.env.VITE_UPI_ID || "visioncart@upi";
const UPI_NAME = import.meta.env.VITE_UPI_NAME || "VisionCart Store";

const api = async (path, opts = {}) => {
  const token = localStorage.getItem("vc_token");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: "include",
      signal: controller.signal, ...opts,
    });
    clearTimeout(timeout);
    if (!res.ok) { const err = await res.json().catch(() => ({})); return { error: true, message: err.message || `Error ${res.status}` }; }
    return res.json();
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === "AbortError") return { error: true, message: "Request timed out." };
    return { error: true, message: "Cannot reach server." };
  }
};

const uploadFile = async (file) => {
  const token = localStorage.getItem("vc_token");
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API}/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, credentials: "include", body: formData });
  return res.json();
};

// ─── PARTICLE BG ──────────────────────────────────────────
const ParticleBackground = () => {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let animId;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    const particles = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 2 + 0.5, alpha: Math.random() * 0.5 + 0.1,
      color: Math.random() > 0.5 ? "#c084fc" : "#f472b6",
    }));
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color + Math.floor(p.alpha * 255).toString(16).padStart(2, "0");
        ctx.fill();
      });
      for (let i = 0; i < particles.length; i++) for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x, dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 100) { ctx.beginPath(); ctx.moveTo(particles[i].x, particles[i].y); ctx.lineTo(particles[j].x, particles[j].y); ctx.strokeStyle = `rgba(192,132,252,${0.12 * (1 - dist / 100)})`; ctx.lineWidth = 0.5; ctx.stroke(); }
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={canvasRef} className="particle-canvas" />;
};

const AnimatedText = ({ text, className, delay = 0 }) => (
  <span className={className}>
    {text.split(" ").map((word, wi) => (
      <span key={wi} style={{ display: "inline-block", overflow: "hidden", marginRight: "0.3em" }}>
        <motion.span style={{ display: "inline-block" }} initial={{ y: "100%" }} animate={{ y: 0 }} transition={{ duration: 0.7, delay: delay + wi * 0.1, ease: [0.22, 1, 0.36, 1] }}>{word}</motion.span>
      </span>
    ))}
  </span>
);

const Typewriter = ({ texts }) => {
  const [idx, setIdx] = useState(0); const [displayed, setDisplayed] = useState(""); const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const current = texts[idx];
    const timeout = setTimeout(() => {
      if (!deleting) { if (displayed.length < current.length) setDisplayed(current.slice(0, displayed.length + 1)); else setTimeout(() => setDeleting(true), 1500); }
      else { if (displayed.length > 0) setDisplayed(displayed.slice(0, -1)); else { setDeleting(false); setIdx((idx + 1) % texts.length); } }
    }, deleting ? 40 : 80);
    return () => clearTimeout(timeout);
  }, [displayed, deleting, idx, texts]);
  return <span className="typewriter">{displayed}<span className="cursor">|</span></span>;
};

// ─── NAVBAR ───────────────────────────────────────────────
const Navbar = ({ user, onLogin, onLogout, onAdmin, page, setPage, cartCount, cart, setCart, miniCartOpen, setMiniCartOpen, addToast }) => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const f = () => setScrolled(window.scrollY > 20); window.addEventListener("scroll", f); return () => window.removeEventListener("scroll", f); }, []);
  return (
    <motion.nav className={`navbar ${scrolled ? "scrolled" : ""}`} initial={{ y: -80 }} animate={{ y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
      <div className="nav-left" onClick={() => setPage("shop")} style={{ cursor: "pointer" }}>
        <div className="nav-logo-wrap"><img src="/banner.gif" alt="VC" className="nav-logo-gif" /></div>
        <span className="nav-brand">VISION<span>CART</span></span>
      </div>
      <div className="nav-links">
        <button key="shop" className={`nav-link ${page === "shop" ? "active" : ""}`} onClick={() => setPage("shop")}>Shop</button>
        {user && <button className={`nav-link ${page === "orders" ? "active" : ""}`} onClick={() => setPage("orders")}>Orders</button>}
      </div>
      <div className="nav-right">
        <div style={{ position: "relative" }}>
          <button className="nav-cart-btn" onClick={() => setMiniCartOpen(o => !o)}>
            <Icon name="bag" size={20} />
            {cartCount > 0 && <span className="nav-cart-badge">{cartCount > 99 ? "99+" : cartCount}</span>}
          </button>
          {miniCartOpen && <MiniCart cart={cart} setCart={setCart} setPage={setPage} onClose={() => setMiniCartOpen(false)} addToast={addToast} />}
        </div>
        {user ? (
          <>
            <div className="nav-avatar" title={user.name}>{user.avatar ? <img src={user.avatar} alt="" /> : user.name?.[0]?.toUpperCase()}</div>
            {user.isAdmin && <button className="btn-admin-pill" onClick={onAdmin}><Icon name="lightning" size={14} /> Admin</button>}
            <button className="btn-outline" onClick={onLogout}>Logout</button>
          </>
        ) : <button className="btn-primary" onClick={onLogin}>Login</button>}
      </div>
    </motion.nav>
  );
};

// ─── AUTH MODAL ───────────────────────────────────────────
const AuthModal = ({ onClose, onSuccess }) => {
  const [tab, setTab] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true); setError("");
    const data = await api(tab === "login" ? "/auth/login" : "/auth/register", {
      method: "POST", body: JSON.stringify(tab === "login" ? { email: form.email, password: form.password } : form),
    });
    setLoading(false);
    if (data.token) { localStorage.setItem("vc_token", data.token); onSuccess(data.user); }
    else setError(data.message || "Something went wrong");
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div className="modal auth-modal" onClick={e => e.stopPropagation()} initial={{ opacity: 0, scale: 0.85, y: 40 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.85, y: 40 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
        <div className="modal-glow" />
        <button className="modal-close" onClick={onClose}><Icon name="close" size={14} /></button>
        <div className="auth-logo"><img src="/banner.gif" alt="VC" style={{ height: 48, borderRadius: 10, margin: "0 auto 10px" }} /><h2>VISIONCART</h2></div>
        <div className="auth-tabs">{["login", "register"].map(t => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t === "login" ? "Login" : "Register"}</button>)}</div>
        <div className="auth-social">
          <button className="btn-google" onClick={() => window.location.href = `${API.replace("/api", "")}/api/auth/google`}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M5.26 9.77A7.24 7.24 0 0 1 12 4.75c1.73 0 3.29.6 4.52 1.6L19.86 3A11.97 11.97 0 0 0 12 0C7.61 0 3.8 2.36 1.73 5.82l3.53 3.95z"/><path fill="#34A853" d="M16.04 18.01A7.22 7.22 0 0 1 12 19.25c-2.99 0-5.56-1.82-6.74-4.48l-3.53 3.94C3.8 21.63 7.61 24 12 24c2.93 0 5.72-1.02 7.83-2.93l-3.79-3.06z"/><path fill="#FBBC05" d="M19.25 12c0-.69-.1-1.4-.26-2.07H12v4.27h4.07a3.5 3.5 0 0 1-1.53 2.3l3.79 3.06C20.53 17.52 21.5 14.97 19.25 12z" opacity=".9"/><path fill="#4285F4" d="M5.26 14.77A7.35 7.35 0 0 1 4.75 12c0-.96.18-1.89.51-2.77L1.73 5.82A11.95 11.95 0 0 0 0 12c0 1.93.46 3.76 1.26 5.37l4-3.6z"/></svg>
            Continue with Google
          </button>
          <button className="btn-discord" onClick={() => window.location.href = `${API.replace("/api", "")}/api/auth/discord`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
            Continue with Discord
          </button>
        </div>
        <div className="auth-divider"><span>or</span></div>
        <div className="auth-form">
          {tab === "register" && <input placeholder="Full Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />}
          <input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input placeholder="Password" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} onKeyDown={e => e.key === "Enter" && submit()} />
          {error && <p className="auth-error">{error}</p>}
          <button className="btn-primary full" onClick={submit} disabled={loading}>{loading ? <span className="spinner" /> : tab === "login" ? "Login" : "Create Account"}</button>
        </div>
      </motion.div>
    </div>
  );
};

// ─── PRODUCT CARD ─────────────────────────────────────────
const ProductCard = ({ product, onAddCart, onBuyNow, onQuickView, index }) => {
  const isVideo = product.mediaType === "video" || product.mediaUrl?.match(/\.(mp4|webm|ogg)$/i);
  const media = product.imageUrl || product.mediaUrl;
  const stock = product.stock ?? 10;
  const stockStatus = stock === 0 ? "out-of-stock" : stock <= 5 ? "low-stock" : "in-stock";
  const stockLabel = stock === 0 ? "Out of Stock" : stock <= 5 ? `Low Stock (${stock})` : "In Stock";
  return (
    <motion.div className="product-card" initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.5, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }} whileHover={{ y: -8, scale: 1.02 }}>
      <div className="product-media">
        {isVideo ? <video src={media} autoPlay muted loop playsInline /> : <img src={media || "/placeholder.png"} alt={product.name} />}
        <div className="product-shine" />
        <motion.div className="product-overlay" initial={{ opacity: 0 }} whileHover={{ opacity: 1 }}>
          <button className="overlay-cart-btn" onClick={() => onAddCart(product)} disabled={stock === 0} style={stock === 0 ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            {stock === 0 ? "Out of Stock" : "+ Add to Cart"}
          </button>
        </motion.div>
        <div className={`stock-badge ${stockStatus}`}>{stockLabel}</div>
        {product.createdAt && new Date() - new Date(product.createdAt) < 7 * 24 * 60 * 60 * 1000 && <div className="product-badge">NEW</div>}
      </div>
      <div className="product-info">
        <h3>{product.name}</h3>
        <p>{product.description}</p>
        <div className="product-footer">
          <span className="product-price">₹{product.price?.toLocaleString("en-IN")}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-outline" onClick={() => onQuickView(product)} style={{ fontSize: "0.75rem", padding: "6px 12px" }}>Quick View</button>
            <button className="btn-buynow" onClick={() => onBuyNow(product)} disabled={stock === 0} style={stock === 0 ? { opacity: 0.5, cursor: "not-allowed" } : {}}>Buy Now →</button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// ─── RECEIPT MODAL ────────────────────────────────────────
const ReceiptModal = ({ receipt, onClose }) => {
  const statusColor = receipt.status === "confirmed" ? "#22c55e" : receipt.status === "rejected" ? "#ef4444" : "#f59e0b";
  const statusIcon = receipt.status === "confirmed" ? <Icon name="check" size={32} /> : receipt.status === "rejected" ? <Icon name="cross" size={32} /> : <span style={{ opacity: 0.5 }}>⏳</span>;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div className="modal upi-modal" onClick={e => e.stopPropagation()} initial={{ opacity: 0, scale: 0.85, y: 40 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.85, y: 40 }}>
        <div className="modal-glow pink" />
        <button className="modal-close" onClick={onClose}><Icon name="close" size={14} /></button>
        <h2 style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Icon name="receipt" size={22} /> Payment Receipt</h2>
        <div style={{ textAlign: "center", margin: "12px 0" }}>
          <div style={{ fontSize: "2rem" }}>{statusIcon}</div>
          <div style={{ color: statusColor, fontWeight: 700, fontSize: "1rem", marginTop: 4, textTransform: "capitalize" }}>{receipt.status}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "16px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Receipt ID</span>
            <strong style={{ fontFamily: "monospace", color: "var(--purple2)", fontSize: "0.9rem" }}>{receipt.receiptId}</strong>
          </div>
          {receipt.items?.map((item, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "4px 0", borderTop: "1px solid var(--border)" }}>
              <span>{item.name} × {item.qty}</span><span>₹{(item.price * item.qty).toLocaleString("en-IN")}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
            <strong>Total</strong>
            <strong className="gradient-text" style={{ fontSize: "1.1rem" }}>₹{receipt.total?.toLocaleString("en-IN")}</strong>
          </div>
        </div>
        <button className="btn-primary full" onClick={onClose} style={{ marginTop: 12 }}>Close</button>
      </motion.div>
    </div>
  );
};

// ─── UPI MODAL — FIXED: No QR delay ───────────────────────
const UPIModal = ({ amount, orderId, user, onClose, onReceiptGenerated }) => {
  // Start with env defaults — show INSTANTLY, no waiting
  const [upi, setUpi] = useState({ upiId: UPI_ID, upiName: UPI_NAME, qrImage: null });
  const [step, setStep] = useState("pay");
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    // Update in background — if custom QR exists it replaces auto QR silently
    api("/upi").then(d => { if (d.upiId) setUpi(d); });
  }, []);

  // Auto QR built from current upi state — always ready immediately
  const upiUrl = `upi://pay?pa=${upi.upiId}&pn=${encodeURIComponent(upi.upiName)}&am=${amount}&cu=INR&tn=${encodeURIComponent("VisionCart Order")}`;
  const autoQr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiUrl)}`;

  const markAsDone = async () => {
    if (!user) return onClose();
    setStep("generating");
    const data = await api("/receipts", { method: "POST", body: JSON.stringify({ orderId }) });
    if (data.receipt) { setReceipt(data.receipt); setStep("done"); onReceiptGenerated?.(); }
    else setStep("pay");
  };

  return (
    <div className="modal-overlay" onClick={step === "done" ? undefined : onClose}>
      <motion.div className="modal upi-modal" onClick={e => e.stopPropagation()} initial={{ opacity: 0, scale: 0.85, y: 40 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.85, y: 40 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
        <div className="modal-glow pink" />
        {step !== "done" && <button className="modal-close" onClick={onClose}><Icon name="close" size={14} /></button>}
        {step === "pay" && (
          <>
            <h2>Pay via UPI 💳</h2>
            <p className="upi-amount">₹{amount?.toLocaleString("en-IN")}</p>
            <div className="upi-qr">
              {/* ✅ FIX: Custom QR shows instantly if saved, else auto-QR — no delay either way */}
              <img
                src={upi.qrImage || autoQr}
                alt="UPI QR"
                onError={e => { if (upi.qrImage) e.target.src = autoQr; }}
              />
            </div>
            <p className="upi-id">UPI ID: <strong>{upi.upiId}</strong></p>
            <p className="upi-hint">Scan with GPay · PhonePe · Paytm</p>
            <button className="btn-primary full" onClick={markAsDone}>I've Paid — Get Receipt <Icon name="receipt" size={16} /></button>
          </>
        )}
        {step === "generating" && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <span className="spinner" style={{ width: 40, height: 40 }} />
            <p style={{ marginTop: 16, color: "var(--text-muted)" }}>Generating your receipt...</p>
          </div>
        )}
        {step === "done" && receipt && (
          <>
            <h2 style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Icon name="receipt" size={22} /> Receipt Generated!</h2>
            <div style={{ textAlign: "center", margin: "16px 0" }}>
              <div style={{ fontSize: "3rem" }}>⏳</div>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: 8 }}>Sent to Discord for confirmation</p>
            </div>
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Receipt ID</span>
                <strong style={{ fontFamily: "monospace", color: "var(--purple2)" }}>{receipt.receiptId}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Total</span>
                <strong className="gradient-text">₹{receipt.total?.toLocaleString("en-IN")}</strong>
              </div>
            </div>
            <button className="btn-primary full" onClick={onClose}>Done</button>
          </>
        )}
      </motion.div>
    </div>
  );
};

// ─── ORDER CHAT ───────────────────────────────────────────
const OrderChat = ({ order, onClose }) => {
  const [messages, setMessages] = useState([]); const [text, setText] = useState(""); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false);
  const [chatErr, setChatErr] = useState("");
  const bottomRef = useRef(null);
  const orderId = order?._id;
  useEffect(() => {
    if (!orderId) { setLoading(false); setChatErr("Invalid order"); return; }
    api(`/orders/${orderId}/messages`).then(d => { setMessages(Array.isArray(d.messages) ? d.messages : []); setLoading(false); }).catch(e => { console.error("Chat fetch error:", e); setChatErr("Failed to load messages"); setLoading(false); });
  }, [orderId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  const send = async () => {
    if (!text.trim() || !orderId) return; setSending(true);
    try {
      const d = await api(`/orders/${orderId}/messages`, { method: "POST", body: JSON.stringify({ text }) });
      if (d.message) setMessages(m => [...m, d.message]);
    } catch (e) { console.error("Chat send error:", e); }
    setText(""); setSending(false);
  };
  return (
    <div className="admin-overlay" onClick={onClose}>
      <motion.div className="admin-panel chat-panel" onClick={e => e.stopPropagation()} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
        <div className="admin-header">
          <div><h2 style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon name="chat" size={20} /> Chat</h2><p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{order?.user?.name || "Customer"} · {typeof order?.total === "number" ? "₹" + order.total.toLocaleString("en-IN") : ""}</p></div>
          <button className="modal-close" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>
        <div className="chat-messages">
          {chatErr && <p style={{ color: "#f87171", textAlign: "center", padding: 20 }}>{chatErr}</p>}
          {!chatErr && loading && <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 20 }}>Loading...</p>}
          {!chatErr && !loading && messages.length === 0 && <p style={{ color: "var(--text-muted)", textAlign: "center", marginTop: 60 }}>No messages yet</p>}
          {!chatErr && safeArr(messages).map((m, i) => m && (
            <div key={i} className={`chat-bubble-wrap ${m.from === "admin" ? "admin" : "user"}`}>
              <div className={`chat-bubble ${m.from === "admin" ? "admin" : "user"}`}>
                {m.text}
                <div className="chat-time">{new Date(m.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="chat-input">
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && !chatErr && send()} placeholder={chatErr ? "Chat unavailable" : "Type a message..."} disabled={!!chatErr} />
          <button className="btn-primary" onClick={send} disabled={sending || !text.trim() || !!chatErr} style={{ padding: "10px 18px" }}>{sending ? <span className="spinner" /> : "Send"}</button>
        </div>
      </motion.div>
    </div>
  );
};

// ─── ADMIN PANEL — Full Page ──────────────────────────────
const AdminPanel = ({ onClose }) => {
  const [tab, setTab] = useState("add");
  const [products, setProducts] = useState([]); const [orders, setOrders] = useState([]); const [admins, setAdmins] = useState([]); const [receipts, setReceipts] = useState([]);
  const [form, setForm] = useState({ name: "", description: "", price: "", stock: 10 });
  const [mediaFile, setMediaFile] = useState(null); const [mediaPreview, setMediaPreview] = useState(null); const [mediaType, setMediaType] = useState("image");
  const [loading, setLoading] = useState(false); const [msg, setMsg] = useState("");
  const [upiForm, setUpiForm] = useState({ upiId: "", upiName: "", qrImage: "" });
  const [upiMsg, setUpiMsg] = useState(""); const [upiLoading, setUpiLoading] = useState(false);
  const [newAdmin, setNewAdmin] = useState({ name: "", email: "", password: "" });
  const [adminMsg, setAdminMsg] = useState("");
  const [adminError, setAdminError] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending"); const [chatOrder, setChatOrder] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    api("/products").then(p => { if (!p.error) setProducts(safeArr(p.products)); }).catch(e => { console.error("Admin init fetch /products:", e); setAdminError("Failed to load products"); });
    api("/upi").then(u => { if (!u.error && u.upiId) setUpiForm(prev => ({ ...prev, upiId: u.upiId, upiName: u.upiName, qrImage: u.qrImage || "" })); }).catch(e => console.error("Admin init fetch /upi:", e));
  }, []);

  const fetchTab = useCallback(async (activeTab) => {
    try {
      switch (activeTab) {
        case "products": {
          const p = await api("/products");
          if (!p.error) setProducts(safeArr(p.products));
          break;
        }
        case "orders": {
          const o = await api("/orders/all");
          if (!o.error) setOrders(safeArr(o.orders));
          break;
        }
        case "receipts": {
          const r = await api("/receipts");
          if (!r.error) setReceipts(safeArr(r.receipts));
          break;
        }
        case "admins": {
          const a = await api("/admins");
          if (!a.error) setAdmins(safeArr(a.admins));
          break;
        }
        default: break;
      }
    } catch (e) { console.error("fetchTab error:", activeTab, e); setAdminError(`Failed to load ${activeTab}`); }
  }, []);

  useEffect(() => { if (tab !== "add" && tab !== "upi") fetchTab(tab); }, [tab, fetchTab]);

  const handleMediaSelect = (e) => {
    const file = e.target.files[0]; if (!file) return;
    setMediaFile(file); setMediaType(file.type.startsWith("video") ? "video" : "image");
    const reader = new FileReader(); reader.onload = () => setMediaPreview(reader.result); reader.readAsDataURL(file);
  };

  const addProduct = async () => {
    if (!form.name || !form.price) return setMsg("Name and price required!");
    setLoading(true);
    try {
      let imageUrl = "", mediaUrl = "", mType = "image";
      if (mediaFile) {
        setMsg("Uploading media...");
        const up = await uploadFile(mediaFile);
        if (up.url) { imageUrl = up.mediaType === "image" ? up.url : ""; mediaUrl = up.url; mType = up.mediaType; }
      }
      await api("/products", { method: "POST", body: JSON.stringify({ ...form, price: Number(form.price), imageUrl, mediaUrl, mediaType: mType }) });
      setForm({ name: "", description: "", price: "", stock: 10 }); setMediaFile(null); setMediaPreview(null);
      setMsg("✅ Product added!"); await fetchTab("products");
    } catch (e) { console.error("addProduct error:", e); setMsg("❌ Failed to add product"); }
    setLoading(false);
    setTimeout(() => setMsg(""), 2500);
  };

  const deleteProduct = async (id) => { try { await api(`/products/${id}`, { method: "DELETE" }); await fetchTab("products"); } catch (e) { console.error("deleteProduct error:", e); } };
  const updateOrderStatus = async (id, status) => { try { await api(`/orders/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) }); await fetchTab("orders"); } catch (e) { console.error("updateOrderStatus error:", e); } };
  const confirmReceipt = async (receiptId, status) => { try { await api(`/receipts/${receiptId}/status`, { method: "PUT", body: JSON.stringify({ status }) }); await fetchTab("receipts"); } catch (e) { console.error("confirmReceipt error:", e); } };

  const addAdmin = async () => {
    if (!newAdmin.name.trim() || !newAdmin.email.trim() || !newAdmin.password.trim())
      return setAdminMsg("❌ All fields (name, email, password) are required!");
    try {
      const d = await api("/admins", { method: "POST", body: JSON.stringify(newAdmin) });
      if (d.error) return setAdminMsg("❌ " + (d.message || "Failed to add admin"));
      setAdminMsg("✅ Admin added successfully!"); setNewAdmin({ name: "", email: "", password: "" }); await fetchTab("admins");
    } catch (e) { console.error("addAdmin error:", e); setAdminMsg("❌ Failed to add admin"); }
    setTimeout(() => setAdminMsg(""), 3000);
  };

  const removeAdmin = async (id) => { try { await api(`/admins/${id}`, { method: "DELETE" }); await fetchTab("admins"); } catch (e) { console.error("removeAdmin error:", e); } };

  const saveUpi = async () => {
    if (!upiForm.upiId || !upiForm.upiName) return setUpiMsg("UPI ID and name required!");
    setUpiLoading(true);
    try {
      const d = await api("/upi", { method: "PUT", body: JSON.stringify(upiForm) });
      setUpiMsg(d.settings ? "✅ Saved!" : "❌ " + (d.message || "Failed"));
    } catch (e) { console.error("saveUpi error:", e); setUpiMsg("❌ Failed to save UPI settings"); }
    setUpiLoading(false);
    setTimeout(() => setUpiMsg(""), 2500);
  };

  const handleQrUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => setUpiForm(f => ({ ...f, qrImage: reader.result })); reader.readAsDataURL(file);
  };

  const safeProds = safeArr(products);
  const safeOrders = safeArr(orders);
  const safeRecs = safeArr(receipts);
  const safeAdmins = safeArr(admins);
  const filteredOrders = statusFilter === "all" ? safeOrders : safeOrders.filter(o => o && o.status === statusFilter);
  const pendingCount = safeOrders.filter(o => o && o.status === "pending").length;
  const pendingRecs = safeRecs.filter(r => r && r.status === "pending").length;
  const TABS = ["add", "products", "orders", "receipts", "upi", "admins"];

  return (
    <>
      {/* ✅ FIX: Full page admin panel instead of side drawer */}
      <motion.div className="admin-fullpage" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
        <div className="admin-fullpage-header">
          <div className="admin-title-wrap">
            <img src="/banner.gif" alt="VC" style={{ height: 36, borderRadius: 8 }} />
            <h1><Icon name="lightning" size={22} /> Admin Panel</h1>
          </div>
          <button className="btn-outline" onClick={onClose}>← Back to Store</button>
        </div>

        <div className="admin-fullpage-tabs">
          {TABS.map(t => (
            <button key={t} className={`admin-tab-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t === "add" ? "✚ Add Product"
               : t === "products" ? <span><Icon name="shop" size={14} /> Products ({safeProds.length})</span>
               : t === "orders" ? <span><Icon name="package" size={14} /> Orders {pendingCount > 0 && <span className="tab-badge">{pendingCount}</span>}</span>
               : t === "receipts" ? <span><Icon name="receipt" size={14} /> Receipts {pendingRecs > 0 && <span className="tab-badge">{pendingRecs}</span>}</span>
               : t === "upi" ? <span><Icon name="cart" size={14} /> UPI Settings</span>
               : <span><Icon name="crown" size={14} /> Admins ({safeAdmins.length})</span>}
            </button>
          ))}
        </div>

        <div className="admin-fullpage-content">

          {adminError && <div className="admin-msg error" style={{ marginBottom: 16 }}>⚠️ {adminError} <button onClick={() => setAdminError("")} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", marginLeft: 12, fontWeight: 700 }}>✕</button></div>}

          {/* ADD PRODUCT */}
          {tab === "add" && (
            <div className="admin-form-wide">
              <h2 className="admin-section-title">Add New Product</h2>
              {msg && <div className="admin-msg">{msg}</div>}
              <div className="admin-form-grid">
                <div className="admin-form-left">
                  <label>Product Name *</label>
                  <input placeholder="e.g. Premium Gaming Chair" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                  <label>Description</label>
                  <textarea placeholder="Describe your product..." value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div><label>Price (₹) *</label><input type="number" placeholder="999" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></div>
                    <div><label>Stock</label><input type="number" placeholder="10" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} /></div>
                  </div>
                </div>
                <div className="admin-form-right">
                  <label>Product Image / Video</label>
                  <input ref={fileRef} type="file" accept="image/*,video/*" onChange={handleMediaSelect} style={{ display: "none" }} />
                  <div className="media-upload-box" onClick={() => fileRef.current.click()}>
                    {mediaPreview ? (
                      mediaType === "video"
                        ? <video src={mediaPreview} style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8 }} muted controls />
                        : <img src={mediaPreview} style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, objectFit: "cover" }} alt="preview" />
                    ) : (
                      <div className="media-upload-placeholder">
                        <span style={{ fontSize: "2.5rem" }}>📁</span>
                        <p>Click to upload image or video</p>
                        <p style={{ fontSize: "0.75rem", opacity: 0.6 }}>JPG, PNG, GIF, MP4, WebM — max 50MB</p>
                      </div>
                    )}
                  </div>
                  {mediaFile && (
                    <button onClick={() => { setMediaFile(null); setMediaPreview(null); }} style={{ marginTop: 8, background: "none", color: "var(--pink)", border: "none", cursor: "pointer", fontSize: "0.82rem" }}>✕ Remove</button>
                  )}
                </div>
              </div>
              <button className="btn-primary" style={{ padding: "14px 40px", fontSize: "1rem", marginTop: 8 }} onClick={addProduct} disabled={loading}>
                {loading ? <span className="spinner" /> : "Add Product"}
              </button>
            </div>
          )}

          {/* PRODUCTS */}
          {tab === "products" && (
            <div>
              <h2 className="admin-section-title">{safeProds.length} Products</h2>
              <div className="admin-products-grid">
                {safeProds.length === 0 ? <p className="empty-state">No products yet!</p> : safeProds.map(p => p && (
                  <motion.div key={p._id} className="admin-product-card" layout>
                    {p.mediaType === "video"
                      ? <video src={p.mediaUrl} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: "10px 10px 0 0" }} muted />
                      : <img src={p.imageUrl || p.mediaUrl || "/placeholder.png"} alt={p.name} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: "10px 10px 0 0" }} />}
                    <div style={{ padding: 12 }}>
                      <strong style={{ display: "block", marginBottom: 4 }}>{p.name}</strong>
                      <span style={{ color: "var(--pink2)", fontWeight: 700 }}>₹{p.price?.toLocaleString("en-IN")}</span>
                      <button className="btn-delete" onClick={() => deleteProduct(p._id)} style={{ display: "block", width: "100%", marginTop: 10 }}>Delete</button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* ORDERS */}
          {tab === "orders" && (
            <div>
              <h2 className="admin-section-title">Orders</h2>
              <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                {["all", "pending", "paid", "cancelled"].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)} style={{ padding: "7px 16px", borderRadius: 8, fontSize: "0.85rem", fontWeight: 600, background: statusFilter === s ? "var(--grad)" : "rgba(255,255,255,0.06)", color: "var(--text)", border: "none", cursor: "pointer" }}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}{s === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
                  </button>
                ))}
              </div>
              <div className="admin-orders-list">
                {!filteredOrders || filteredOrders.length === 0 ? <p className="empty-state">No orders!</p> : filteredOrders.map(o => o && (
                  <div key={o._id} className="admin-order-card">
                    <div className="order-card-left">
                      <strong>{o.user?.name || "Guest"}</strong>
                      <span>{o.user?.email}</span>
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        {["pending", "paid", "cancelled"].map(s => (
                          <button key={s} onClick={() => updateOrderStatus(o._id, s)} style={{ padding: "4px 12px", borderRadius: 6, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", border: "none", background: o.status === s ? (s === "paid" ? "#22c55e" : s === "cancelled" ? "#ef4444" : "var(--grad)") : "rgba(255,255,255,0.08)", color: o.status === s ? "white" : "var(--text-muted)" }}>{s}</button>
                        ))}
                      </div>
                    </div>
                    <div className="order-card-right">
                      <strong style={{ color: "var(--pink)", fontSize: "1.1rem" }}>₹{o.total?.toLocaleString("en-IN")}</strong>
                      <span className={`order-status ${o.status}`}>{o.status}</span>
                      <button onClick={() => setChatOrder(o)} className="btn-chat"><Icon name="chat" size={14} /> Chat</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* RECEIPTS */}
          {tab === "receipts" && (
            <div>
              <h2 className="admin-section-title">Payment Receipts</h2>
              <div className="admin-orders-list">
                {safeRecs.length === 0 ? <p className="empty-state">No receipts yet!</p> : safeRecs.map(r => r && (
                  <div key={r._id || Math.random()} className="admin-order-card">
                    <div className="order-card-left">
                      <strong style={{ fontFamily: "monospace", color: "var(--purple2)" }}>{r.receiptId || "—"}</strong>
                      <span>{r.user?.name || "—"} · {r.user?.email || "—"}</span>
                      {r.createdAt && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{new Date(r.createdAt).toLocaleDateString("en-IN")}</span>}
                    </div>
                    <div className="order-card-right">
                      {typeof r.total === "number" && <strong style={{ color: "var(--pink)", fontSize: "1.1rem" }}>₹{r.total.toLocaleString("en-IN")}</strong>}
                      <span className={`order-status ${r.status || "pending"}`}>{r.status || "pending"}</span>
                      {r.status === "pending" && (
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button onClick={() => confirmReceipt(r.receiptId, "confirmed")} style={{ padding: "5px 12px", borderRadius: 6, fontSize: "0.78rem", background: "#22c55e", color: "#fff", border: "none", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><Icon name="check" size={12} /> Confirm</button>
                          <button onClick={() => confirmReceipt(r.receiptId, "rejected")} style={{ padding: "5px 12px", borderRadius: 6, fontSize: "0.78rem", background: "#ef4444", color: "#fff", border: "none", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><Icon name="cross" size={12} /> Reject</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* UPI */}
          {tab === "upi" && (
            <div className="admin-form-wide" style={{ maxWidth: 560 }}>
              <h2 className="admin-section-title">UPI Settings</h2>
              {upiMsg && <div className="admin-msg">{upiMsg}</div>}
              <label>UPI ID *</label>
              <input placeholder="e.g. yourname@okaxis" value={upiForm.upiId} onChange={e => setUpiForm(f => ({ ...f, upiId: e.target.value }))} />
              <label>Display Name *</label>
              <input placeholder="e.g. VisionCart Store" value={upiForm.upiName} onChange={e => setUpiForm(f => ({ ...f, upiName: e.target.value }))} />
              <label>Custom QR Image <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional — shows instantly, no delay!)</span></label>
              <input type="file" accept="image/*" onChange={handleQrUpload} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", borderRadius: 10, padding: 10, color: "var(--text-muted)", cursor: "pointer" }} />
              {upiForm.qrImage && (
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 16 }}>
                  <img src={upiForm.qrImage} alt="QR" style={{ width: 120, height: 120, borderRadius: 12, objectFit: "contain", border: "1px solid var(--border)", background: "white", padding: 8 }} />
                  <button onClick={() => setUpiForm(f => ({ ...f, qrImage: "" }))} style={{ background: "none", color: "var(--pink)", border: "none", cursor: "pointer", fontSize: "0.85rem" }}>✕ Remove QR</button>
                </div>
              )}
              <button className="btn-primary" style={{ padding: "13px 32px", marginTop: 16 }} onClick={saveUpi} disabled={upiLoading}>{upiLoading ? <span className="spinner" /> : "Save UPI Settings"}</button>
            </div>
          )}

          {/* ADMINS */}
          {tab === "admins" && (
            <div className="admin-form-wide" style={{ maxWidth: 620 }}>
              <h2 className="admin-section-title">Add New Admin</h2>
              {adminMsg && <div className={`admin-msg ${adminMsg.startsWith("❌") ? "error" : ""}`}>{adminMsg}</div>}
              {/* ✅ FIX: All 3 fields clearly visible */}
              <label>Full Name *</label>
              <input placeholder="e.g. John Doe" value={newAdmin.name} onChange={e => setNewAdmin(a => ({ ...a, name: e.target.value }))} />
              <label>Email *</label>
              <input placeholder="admin@email.com" type="email" value={newAdmin.email} onChange={e => setNewAdmin(a => ({ ...a, email: e.target.value }))} />
              <label>Password *</label>
              <input placeholder="Strong password" type="password" value={newAdmin.password} onChange={e => setNewAdmin(a => ({ ...a, password: e.target.value }))} />
              <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: 8 }}>💡 If this email already has an account, they'll be promoted to admin.</p>
              <button className="btn-primary" style={{ padding: "13px 32px" }} onClick={addAdmin}>Add Admin</button>

              <h2 className="admin-section-title" style={{ marginTop: 36 }}>Current Admins ({safeAdmins.length})</h2>
              <div className="admin-orders-list">
                {safeAdmins.map(a => a && (
                  <div key={a._id || Math.random()} className="admin-order-card">
                    <div className="order-card-left">
                      <strong>{a.name}</strong>
                      <span>{a.email}</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--purple2)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}><Icon name="crown" size={12} /> Admin</span>
                    </div>
                    <div className="order-card-right">
                      {a.email !== import.meta.env.VITE_ADMIN_EMAIL && (
                        <button onClick={() => removeAdmin(a._id)} className="btn-delete">Remove</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </motion.div>
      <AnimatePresence>{chatOrder && <OrderChat key="chat" order={chatOrder} onClose={() => setChatOrder(null)} />}</AnimatePresence>
    </>
  );
};

// ─── SHOP PAGE ────────────────────────────────────────────
const ShopPage = ({ onAddCart, onBuyNow, onQuickView }) => {
  const [products, setProducts] = useState([]); const [search, setSearch] = useState(""); const [loading, setLoading] = useState(true);
  useEffect(() => { api("/products").then(d => { setProducts(d.products || []); setLoading(false); }); }, []);
  const filtered = products.filter(p => p.name?.toLowerCase().includes(search.toLowerCase()) || p.description?.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="shop-page">
      <section className="hero">
        <div className="hero-content">
          <motion.div className="hero-badge" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>✦ Premium Store</motion.div>
          <h1 className="hero-title"><AnimatedText text="SHOP THE" className="hero-line1" delay={0.3} /><br /><AnimatedText text="VISION" className="hero-line2 gradient-text" delay={0.5} /></h1>
          <motion.p className="hero-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}>
            <Typewriter texts={["Premium products.", "Instant delivery.", "Exclusive drops.", "Only on VisionCart."]} />
          </motion.p>
          <motion.div className="hero-cta" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 }}>
            <button className="btn-primary large" onClick={() => document.getElementById("products-section")?.scrollIntoView({ behavior: "smooth" })}>Explore Products ↓</button>
          </motion.div>
        </div>
        <div className="hero-orbs"><div className="orb orb1" /><div className="orb orb2" /><div className="orb orb3" /></div>
      </section>
      <div className="shop-search-wrap">
        <motion.div className="shop-search" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <span className="search-icon"><Icon name="search" size={18} /></span>
          <input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
        </motion.div>
      </div>
      <div id="products-section" className="products-section">
        <motion.h2 className="section-title" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }}>{search ? `Results for "${search}"` : "All Products"}</motion.h2>
        {loading ? (
          <div className="products-grid">{[...Array(6)].map((_, i) => <div key={i} className="skeleton-card"><div className="skeleton-img" /><div className="skeleton-text" /><div className="skeleton-text short" /></div>)}</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><p className="empty-state-title" style={{ fontSize: "1rem" }}>No products found{search ? ` for "${search}"` : " yet"}</p></div>
        ) : (
          <div className="products-grid">{filtered.map((p, i) => <ProductCard key={p._id} product={p} index={i} onAddCart={onAddCart} onBuyNow={onBuyNow} onQuickView={onQuickView} />)}</div>
        )}
      </div>
    </div>
  );
};

// ─── CART PAGE ────────────────────────────────────────────
const CartPage = ({ cart, setCart, onCheckout, setPage }) => {
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const update = (id, qty) => { if (qty < 1) setCart(c => c.filter(i => i._id !== id)); else setCart(c => c.map(i => i._id === id ? { ...i, qty } : i)); };
  return (
    <motion.div className="cart-page" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }}>
      <h1 className="page-title">Your <span className="gradient-text">Cart</span></h1>
      {cart.length === 0 ? <div className="empty-state"><div className="empty-state-icon"><Icon name="bag" size={48} /></div><p className="empty-state-title">Your cart is empty</p><p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Browse products and add items you love</p><button className="btn-primary" style={{ marginTop: 12 }} onClick={() => setPage("shop")}>Start Shopping →</button></div> : (
        <>
          <AnimatePresence>
            {cart.map(item => (
              <motion.div key={item._id} className="cart-item" layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                {item.mediaType === "video"
                  ? <video src={item.mediaUrl} style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover" }} muted />
                  : <img src={item.imageUrl || item.mediaUrl || "/placeholder.png"} alt={item.name} />}
                <div className="cart-item-info"><h3>{item.name}</h3><span className="gradient-text">₹{item.price?.toLocaleString("en-IN")}</span></div>
                <div className="cart-qty">
                  <button onClick={() => update(item._id, item.qty - 1)}>−</button>
                  <span>{item.qty}</span>
                  <button onClick={() => update(item._id, item.qty + 1)}>+</button>
                </div>
                <span className="cart-sub gradient-text">₹{(item.price * item.qty).toLocaleString("en-IN")}</span>
                <button className="btn-delete" onClick={() => update(item._id, 0)}>✕</button>
              </motion.div>
            ))}
          </AnimatePresence>
          <motion.div className="cart-total" layout>
            <div><p>Total Amount</p><h2 className="gradient-text">₹{total.toLocaleString("en-IN")}</h2></div>
            <button className="btn-primary large" onClick={() => onCheckout(total)}>Pay via UPI 💳</button>
          </motion.div>
        </>
      )}
    </motion.div>
  );
};

// ─── ORDERS PAGE ──────────────────────────────────────────
const OrdersPage = ({ user }) => {
  const [orders, setOrders] = useState([]); const [loading, setLoading] = useState(true); const [viewReceipt, setViewReceipt] = useState(null); const [chatOrder, setChatOrder] = useState(null);
  useEffect(() => { api("/orders/my").then(d => { setOrders(d.orders || []); setLoading(false); }); }, []);
  return (
    <motion.div className="cart-page" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
      <h1 className="page-title">My <span className="gradient-text">Orders</span></h1>
      {loading ? (
        <div className="products-grid">{[...Array(3)].map((_, i) => <div key={i} className="skeleton-card"><div className="skeleton-img" /><div className="skeleton-text" /></div>)}</div>
      ) : orders.length === 0 ? <div className="empty-state"><div className="empty-state-icon"><Icon name="package" size={48} /></div><p className="empty-state-title">No orders yet</p><p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Your first order is just a click away</p></div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 700, margin: "0 auto" }}>
          {orders.map(o => (
            <motion.div key={o._id} className="cart-item" style={{ flexDirection: "column", alignItems: "flex-start", gap: 12 }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                <span className={`order-status ${o.status}`} style={{ textTransform: "capitalize", fontWeight: 600 }}>{o.status}</span>
                <strong className="gradient-text" style={{ fontSize: "1.1rem" }}>₹{o.total?.toLocaleString("en-IN")}</strong>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                {o.items?.map((item, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <img src={item.product?.imageUrl || item.product?.mediaUrl || "/placeholder.png"} alt={item.product?.name} style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }} />
                    <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>{item.product?.name} × {item.qty}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, width: "100%", flexWrap: "wrap" }}>
                {o.receipt && (
                  <button onClick={() => setViewReceipt(o.receipt)} style={{ flex: 1, padding: "8px", borderRadius: 8, background: "rgba(147,51,234,0.2)", border: "1px solid var(--border)", color: "var(--text)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 }}>
                    <Icon name="receipt" size={14} /> {o.receipt.receiptId} — <span style={{ color: o.receipt.status === "confirmed" ? "#22c55e" : o.receipt.status === "rejected" ? "#ef4444" : "#f59e0b", textTransform: "capitalize" }}>{o.receipt.status}</span>
                  </button>
                )}
                <button onClick={() => setChatOrder(o)} style={{ padding: "8px 16px", borderRadius: 8, background: "rgba(236,72,153,0.15)", border: "1px solid rgba(236,72,153,0.3)", color: "var(--text)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><Icon name="chat" size={14} /> Chat</button>
                <span style={{ color: "var(--text-muted)", fontSize: "0.78rem", alignSelf: "center" }}>{new Date(o.createdAt).toLocaleDateString("en-IN")}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      <AnimatePresence>
        {viewReceipt && <ReceiptModal receipt={viewReceipt} onClose={() => setViewReceipt(null)} />}
        {chatOrder && <OrderChat order={chatOrder} onClose={() => setChatOrder(null)} />}
      </AnimatePresence>
    </motion.div>
  );
};

// ─── TOAST SYSTEM ───────────────────────────────────────────
const ToastContainer = ({ toasts, removeToast }) => {
  return (
    <div className="toast-container">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div key={t.id} className={`toast ${t.type}`} initial={{ opacity: 0, x: 80, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 80, scale: 0.9 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            <span className="toast-icon">{t.type === "success" ? <Icon name="check" size={18} /> : t.type === "error" ? <Icon name="cross" size={18} /> : <Icon name="lightning" size={18} />}</span>
            <span className="toast-msg">{t.message}</span>
            <button onClick={() => removeToast(t.id)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.85rem", padding: 2, flexShrink: 0 }}><Icon name="close" size={14} /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

// ─── MINI CART ─────────────────────────────────────────────
const MiniCart = ({ cart, setCart, setPage, onClose, addToast }) => {
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const update = (id, qty) => {
    if (qty < 1) {
      setCart(c => { const item = c.find(i => i._id === id); if (item) addToast(`${item.name} removed from cart`, "info"); return c.filter(i => i._id !== id); });
    } else {
      setCart(c => c.map(i => i._id === id ? { ...i, qty } : i));
    }
  };
  return (
    <>
      <div className="mini-cart-overlay" onClick={onClose} />
      <motion.div className="mini-cart" initial={{ opacity: 0, y: -10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.95 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
        <div className="mini-cart-header">
          <h3>Shopping Cart ({cart.length})</h3>
          <button onClick={onClose} style={{ background: "none", color: "var(--text-muted)", border: "none", cursor: "pointer" }}><Icon name="close" size={16} /></button>
        </div>
        {cart.length === 0 ? (
          <div className="mini-cart-empty">Your cart is empty</div>
        ) : (
          <>
            <div className="mini-cart-items">
              {cart.map(item => (
                <div key={item._id} className="mini-cart-item">
                  {item.mediaType === "video"
                    ? <video src={item.mediaUrl} muted />
                    : <img src={item.imageUrl || item.mediaUrl || "/placeholder.png"} alt={item.name} />}
                  <div className="mini-cart-item-info">
                    <h4>{item.name}</h4>
                    <span>₹{item.price?.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="mini-cart-qty">
                    <button onClick={() => update(item._id, item.qty - 1)}>−</button>
                    <span>{item.qty}</span>
                    <button onClick={() => update(item._id, item.qty + 1)}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mini-cart-footer">
              <div className="mini-cart-total">
                <span>Total</span>
                <strong className="gradient-text">₹{total.toLocaleString("en-IN")}</strong>
              </div>
              <button className="btn-primary full" onClick={() => { setPage("cart"); onClose(); }}>View Cart & Checkout</button>
            </div>
          </>
        )}
      </motion.div>
    </>
  );
};

// ─── QUICK VIEW MODAL ──────────────────────────────────────
const QuickViewModal = ({ product, onClose, onAddCart, onBuyNow, addToast }) => {
  const [qty, setQty] = useState(1);
  const isVideo = product.mediaType === "video" || product.mediaUrl?.match(/\.(mp4|webm|ogg)$/i);
  const media = product.imageUrl || product.mediaUrl;
  const stock = product.stock ?? 10;
  const stockStatus = stock === 0 ? "out-of-stock" : stock <= 5 ? "low-stock" : "in-stock";
  const stockLabel = stock === 0 ? "Out of Stock" : stock <= 5 ? `Low Stock (${stock})` : "In Stock";
  return (
    <div className="quickview-overlay" onClick={onClose}>
      <motion.div className="quickview" onClick={e => e.stopPropagation()} initial={{ opacity: 0, scale: 0.9, y: 30 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 30 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
        <div className="quickview-media">
          {isVideo ? <video src={media} autoPlay muted loop playsInline /> : <img src={media || "/placeholder.png"} alt={product.name} />}
        </div>
        <div className="quickview-body">
          <button className="quickview-close" onClick={onClose}><Icon name="close" size={14} /></button>
          <h2>{product.name}</h2>
          <span className="qv-price gradient-text">₹{product.price?.toLocaleString("en-IN")}</span>
          <div className={`qv-stock ${stockStatus}`}>
            <span>{stockStatus === "in-stock" ? "✓" : stockStatus === "low-stock" ? "⚠" : "✕"}</span>
            {stockLabel}
          </div>
          <p className="qv-desc">{product.description || "No description available."}</p>
          <div className="qv-actions">
            <div className="qv-qty">
              <button onClick={() => setQty(q => Math.max(1, q - 1))} disabled={stock === 0}>−</button>
              <span>{qty}</span>
              <button onClick={() => setQty(q => Math.min(stock, q + 1))} disabled={qty >= stock || stock === 0}>+</button>
            </div>
            <button className="btn-primary qv-cart-btn" onClick={() => { for (let i = 0; i < qty; i++) onAddCart(product); addToast(`${product.name} added to cart`, "success"); onClose(); }} disabled={stock === 0}>
              {stock === 0 ? "Out of Stock" : "Add to Cart"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

// ─── MAIN APP ─────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null); const [page, setPage] = useState("shop");
  const [showAuth, setShowAuth] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [upiData, setUpiData] = useState(null);
  const [cart, setCart] = useState(() => { try { return JSON.parse(localStorage.getItem("vc_cart") || "[]"); } catch { return []; } });
  const [toasts, setToasts] = useState([]);
  const [quickView, setQuickView] = useState(null);
  const [miniCartOpen, setMiniCartOpen] = useState(false);

  const addToast = useCallback((message, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(toast => toast.id !== id)), 4000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(t => t.filter(toast => toast.id !== id));
  }, []);

  useEffect(() => {
    fetch(`${API.replace("/api", "")}/api/health`).catch(() => {});
    // Restore session from httpOnly cookie (primary) or localStorage (backward compat)
    api("/auth/me").then(d => { if (d.user) setUser(d.user); });
    // Handle legacy ?token= in URL (pre-cookie OAuth flow, deprecated)
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (t) { localStorage.setItem("vc_token", t); window.history.replaceState({}, "", "/"); api("/auth/me").then(d => { if (d.user) setUser(d.user); }); }
  }, []);

  useEffect(() => { localStorage.setItem("vc_cart", JSON.stringify(cart)); }, [cart]);

  const addToCart = useCallback((product) => {
    setCart(c => {
      const ex = c.find(i => i._id === product._id);
      if (ex) {
        addToast(`${product.name} quantity updated`, "info");
        return c.map(i => i._id === product._id ? { ...i, qty: i.qty + 1 } : i);
      }
      addToast(`${product.name} added to cart`, "success");
      return [...c, { ...product, qty: 1 }];
    });
  }, [addToast]);

  const handleBuyNow = async (product) => {
    if (!user) { setShowAuth(true); return; }
    const orderData = await api("/orders", { method: "POST", body: JSON.stringify({ items: [{ product: product._id, qty: 1, price: product.price }], total: product.price }) });
    if (orderData.order) setUpiData({ amount: product.price, orderId: orderData.order._id });
    else addToast(orderData.message || "Checkout failed", "error");
  };

  const handleCartCheckout = async (total) => {
    if (!user) { setShowAuth(true); return; }
    const items = cart.map(i => ({ product: i._id, qty: i.qty, price: i.price }));
    const orderData = await api("/orders", { method: "POST", body: JSON.stringify({ items, total }) });
    if (orderData.order) { setCart([]); setUpiData({ amount: total, orderId: orderData.order._id }); addToast("Order placed successfully", "success"); }
    else addToast(orderData.message || "Checkout failed", "error");
  };

  const logout = async () => { localStorage.removeItem("vc_token"); try { await api("/auth/logout", { method: "POST" }); } catch {} setUser(null); addToast("Logged out", "info"); };
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  if (showAdmin) return (
    <div className="app">
      <ParticleBackground />
      <AdminErrorBoundary>
        <AnimatePresence>
          <AdminPanel key="admin" onClose={() => setShowAdmin(false)} />
        </AnimatePresence>
      </AdminErrorBoundary>
    </div>
  );

  const appRef = useRef(null);
  useRipple(appRef);

  return (
    <div className="app" ref={appRef}>
      <ParticleBackground />
      <BackToTop />
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <Navbar user={user} onLogin={() => setShowAuth(true)} onLogout={logout} onAdmin={() => setShowAdmin(true)} page={page} setPage={setPage} cartCount={cartCount} cart={cart} setCart={setCart} miniCartOpen={miniCartOpen} setMiniCartOpen={setMiniCartOpen} addToast={addToast} />
      <main className="main">
        <AnimatePresence mode="wait">
          {page === "shop" && <motion.div key="shop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><ShopPage onAddCart={addToCart} onBuyNow={handleBuyNow} onQuickView={setQuickView} /></motion.div>}
          {page === "cart" && <motion.div key="cart" initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -60 }}><CartPage cart={cart} setCart={setCart} onCheckout={handleCartCheckout} setPage={setPage} /></motion.div>}
          {page === "orders" && <motion.div key="orders" initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -60 }}><OrdersPage user={user} /></motion.div>}
        </AnimatePresence>
      </main>
      <AnimatePresence>
        {showAuth && <AuthModal key="auth" onClose={() => setShowAuth(false)} onSuccess={u => { setUser(u); setShowAuth(false); addToast("Welcome to VisionCart!", "success"); }} />}
        {upiData && <UPIModal key="upi" amount={upiData.amount} orderId={upiData.orderId} user={user} onClose={() => setUpiData(null)} onReceiptGenerated={() => setCart([])} />}
        {quickView && <QuickViewModal key="quickview" product={quickView} onClose={() => setQuickView(null)} onAddCart={addToCart} onBuyNow={handleBuyNow} addToast={addToast} />}
      </AnimatePresence>
    </div>
  );
}
