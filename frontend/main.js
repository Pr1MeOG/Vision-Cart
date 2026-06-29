(function () {
  "use strict";

  const API = window.VISISON_CART_API_URL || "http://localhost:5000/api";
  const API_BASE = API.replace(/\/api\/?$/, "");
  const STORE_NAME = "Visison Cart";
  const CART_KEY = "vc_cart";
  const THEME_KEY = "vc_theme";
  const LOADING_MIN_MS = 900;
  const loadingStartedAt = performance.now();

  const fallbackProducts = [
    {
      _id: "local-1",
      name: "SaaS Landing UI Kit",
      description: "Hero sections, pricing blocks, dashboards, and mobile screens for a fast product launch.",
      price: 2499,
      imageUrl: digitalThumb("UI", "#7c3aed", "#06b6d4"),
      category: "UI Kits",
      stock: 12,
      createdAt: new Date().toISOString()
    },
    {
      _id: "local-2",
      name: "Discord Store Bot Pack",
      description: "Starter commands, order notifications, receipt helpers, and moderation-ready bot scripts.",
      price: 3499,
      imageUrl: digitalThumb("BOT", "#5865f2", "#22d3ee"),
      category: "Bots",
      stock: 8,
      createdAt: new Date().toISOString()
    },
    {
      _id: "local-3",
      name: "Creator Thumbnail System",
      description: "Editable thumbnail layouts, glow overlays, badges, and social post templates.",
      price: 1299,
      imageUrl: digitalThumb("PSD", "#ec4899", "#f59e0b"),
      category: "Design Assets",
      stock: 5,
      createdAt: new Date().toISOString()
    },
    {
      _id: "local-4",
      name: "E-Commerce Email Templates",
      description: "Responsive transactional emails for receipts, abandoned carts, drops, and updates.",
      price: 999,
      imageUrl: digitalThumb("MAIL", "#0ea5e9", "#8b5cf6"),
      category: "Templates",
      stock: 14
    },
    {
      _id: "local-5",
      name: "AI Prompt Vault",
      description: "Curated prompts for product copy, ad creatives, coding helpers, and customer support.",
      price: 799,
      imageUrl: digitalThumb("AI", "#10b981", "#7c3aed"),
      category: "Prompt Packs",
      stock: 10
    },
    {
      _id: "local-6",
      name: "Premium Icon Bundle",
      description: "Sharp app, dashboard, and commerce icons in organized SVG and PNG formats.",
      price: 1499,
      imageUrl: digitalThumb("SVG", "#f97316", "#06b6d4"),
      category: "Design Assets",
      stock: 7
    }
  ];

  const state = {
    products: fallbackProducts.slice(),
    categories: ["All", "UI Kits", "Bots", "Design Assets", "Templates", "Prompt Packs"],
    selectedCategory: "All",
    search: "",
    featuredOnly: false,
    cart: readCart(),
    user: null,
    authMode: "login"
  };

  const els = {
    header: document.getElementById("header"),
    navMenu: document.getElementById("nav-menu"),
    navToggle: document.getElementById("nav-toggle"),
    navClose: document.getElementById("nav-close"),
    navLinks: document.querySelectorAll(".nav-link"),
    overlay: document.getElementById("overlay"),
    cart: document.getElementById("cart"),
    cartShop: document.getElementById("cart-shop"),
    cartClose: document.getElementById("cart-close"),
    cartItems: document.getElementById("cart-items"),
    cartEmpty: document.getElementById("cart-empty"),
    cartTotal: document.getElementById("cart-total"),
    cartCount: document.getElementById("cart-count"),
    cartItemsLabel: document.getElementById("cart-items-label"),
    checkoutButton: document.getElementById("checkout-button"),
    login: document.getElementById("login"),
    loginButton: document.getElementById("login-button"),
    loginClose: document.getElementById("login-close"),
    authTitle: document.getElementById("auth-title"),
    authTabs: document.querySelectorAll("[data-auth-tab]"),
    authForm: document.getElementById("auth-form"),
    authName: document.getElementById("auth-name"),
    authEmail: document.getElementById("auth-email"),
    authPassword: document.getElementById("auth-password"),
    authMessage: document.getElementById("auth-message"),
    authSubmit: document.getElementById("auth-submit"),
    googleLogin: document.getElementById("google-login"),
    discordLogin: document.getElementById("discord-login"),
    search: document.getElementById("product-search"),
    featuredToggle: document.getElementById("featured-toggle"),
    productCount: document.getElementById("product-count"),
    categoryRow: document.getElementById("category-row"),
    productsGrid: document.getElementById("products-grid"),
    productsEmpty: document.getElementById("products-empty"),
    catalogTitle: document.getElementById("catalog-title"),
    arrivalsWrapper: document.getElementById("arrivals-wrapper"),
    newsletterForm: document.getElementById("newsletter-form"),
    quickView: document.getElementById("quick-view"),
    upiModal: document.getElementById("upi-modal"),
    toastArea: document.getElementById("toast-area"),
    scrollUp: document.getElementById("scroll-up"),
    particleCanvas: document.getElementById("particle-canvas"),
    themeSelect: document.getElementById("theme-select"),
    previewLoading: document.getElementById("preview-loading")
  };

  function digitalThumb(label, colorA, colorB) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${colorA}"/>
            <stop offset="1" stop-color="${colorB}"/>
          </linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <rect width="600" height="600" rx="52" fill="#080914"/>
        <circle cx="110" cy="120" r="170" fill="${colorA}" opacity=".24"/>
        <circle cx="480" cy="470" r="210" fill="${colorB}" opacity=".2"/>
        <rect x="92" y="128" width="416" height="316" rx="30" fill="url(#g)" opacity=".18" stroke="rgba(255,255,255,.2)"/>
        <path d="M132 206h336M132 272h210M132 338h272" stroke="rgba(255,255,255,.32)" stroke-width="18" stroke-linecap="round"/>
        <text x="300" y="418" text-anchor="middle" fill="white" font-family="Inter, Arial" font-size="92" font-weight="800" filter="url(#glow)">${label}</text>
      </svg>`;
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  function formatPrice(value) {
    return "Rs. " + Number(value || 0).toLocaleString("en-IN");
  }

  function warmBackend() {
    fetch(`${API_BASE}/api/health`, {
      cache: "no-store",
      credentials: "include",
      keepalive: true
    }).catch(() => {});
  }

  function getMedia(product) {
    return product.imageUrl || product.mediaUrl || "./public/placeholder.png";
  }

  function isVideo(product) {
    return product.mediaType === "video" || /\.(mp4|webm|ogg)$/i.test(product.mediaUrl || "");
  }

  function readCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
  }

  async function api(path, options = {}) {
    const token = localStorage.getItem("vc_token");
    const response = await fetch(API + path, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(options.headers || {})
      },
      ...options
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || data.error || "Request failed");
    }
    return data;
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    els.toastArea.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      setTimeout(() => toast.remove(), 220);
    }, 3000);
  }

  function hidePreviewLoading() {
    if (!els.previewLoading) return;
    const elapsed = performance.now() - loadingStartedAt;
    const delay = Math.max(0, LOADING_MIN_MS - elapsed);
    setTimeout(() => {
      els.previewLoading.classList.add("is-hidden");
      els.previewLoading.setAttribute("aria-hidden", "true");
    }, delay);
  }

  function setOverlay(active) {
    els.overlay.classList.toggle("active", active);
    document.body.classList.toggle("panel-open", active);
  }

  function closePanels() {
    els.cart.classList.remove("show-cart");
    els.login.classList.remove("show-login");
    els.navMenu.classList.remove("show-menu");
    els.quickView.classList.remove("active");
    els.upiModal.classList.remove("active");
    els.quickView.setAttribute("aria-hidden", "true");
    els.upiModal.setAttribute("aria-hidden", "true");
    setOverlay(false);
  }

  function openCart() {
    els.login.classList.remove("show-login");
    els.navMenu.classList.remove("show-menu");
    els.cart.classList.add("show-cart");
    setOverlay(true);
  }

  function openLogin() {
    els.cart.classList.remove("show-cart");
    els.navMenu.classList.remove("show-menu");
    els.login.classList.add("show-login");
    setOverlay(true);
  }

  function openMenu() {
    els.cart.classList.remove("show-cart");
    els.login.classList.remove("show-login");
    els.navMenu.classList.add("show-menu");
    setOverlay(true);
  }

  function renderCategories() {
    els.categoryRow.innerHTML = state.categories.map((category) => (
      `<button class="category-pill ${category === state.selectedCategory ? "active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
    )).join("");
  }

  function filteredProducts() {
    const term = state.search.trim().toLowerCase();
    return state.products.filter((product) => {
      const matchesCategory = state.selectedCategory === "All" || product.category === state.selectedCategory;
      const matchesFeatured = !state.featuredOnly || isFeaturedProduct(product);
      const matchesSearch = !term ||
        String(product.name || "").toLowerCase().includes(term) ||
        String(product.description || "").toLowerCase().includes(term);
      return matchesCategory && matchesFeatured && matchesSearch;
    });
  }

  function renderProducts() {
    const products = filteredProducts();
    els.catalogTitle.textContent = state.search
      ? `Results for "${state.search}"`
      : state.selectedCategory === "All"
        ? "All Digital Goods"
        : `${state.selectedCategory} Goods`;

    if (els.productCount) {
      const shown = products.length;
      const total = state.products.length;
      const suffix = state.featuredOnly ? " featured picks" : shown === 1 ? " curated item" : " curated items";
      els.productCount.textContent = `${shown} of ${total} VisionCart${suffix}`;
    }

    if (els.featuredToggle) {
      els.featuredToggle.classList.toggle("active", state.featuredOnly);
      els.featuredToggle.setAttribute("aria-pressed", String(state.featuredOnly));
    }

    els.productsGrid.innerHTML = products.map(productCardTemplate).join("");
    els.productsEmpty.style.display = products.length ? "none" : "block";
    renderArrivals();
  }

  function productScore(product) {
    return String(product._id || product.name || "")
      .split("")
      .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  }

  function productRating(product) {
    const score = productScore(product);
    const rating = (4.6 + (score % 4) / 10).toFixed(1);
    const reviews = 8 + (score % 36);
    return { rating, reviews };
  }

  function isFeaturedProduct(product) {
    const stock = Number(product.stock ?? 10);
    const price = Number(product.price || 0);
    return stock > 0 && (isNew(product) || stock <= 5 || price <= 1499 || productScore(product) % 5 === 0);
  }

  function productHighlight(product) {
    const stock = Number(product.stock ?? 10);
    if (isNew(product)) return "New drop";
    if (stock > 0 && stock <= 5) return "Limited";
    if (isFeaturedProduct(product)) return "Featured";
    return "";
  }

  function productCardTemplate(product) {
    const stock = Number(product.stock ?? 10);
    const stockClass = stock === 0 ? "out-of-stock" : stock <= 5 ? "low-stock" : "";
    const stockLabel = stock === 0 ? "Unavailable" : stock <= 5 ? `Limited (${stock})` : "Instant access";
    const highlight = productHighlight(product);
    const { rating, reviews } = productRating(product);
    const media = isVideo(product)
      ? `<video src="${escapeAttr(getMedia(product))}" muted loop playsinline></video>`
      : `<img src="${escapeAttr(getMedia(product))}" alt="${escapeAttr(product.name)}">`;

    return `
      <article class="product-card" data-product-id="${escapeAttr(product._id)}">
        <div class="product-media">
          ${media}
          ${highlight ? `<span class="badge">${escapeHtml(highlight)}</span>` : ""}
          <span class="stock-badge ${stockClass}">${escapeHtml(stockLabel)}</span>
        </div>
        <div class="product-info">
          <div class="product-meta">
            <span class="product-category">${escapeHtml(product.category || "Featured")}</span>
            <span class="product-rating"><i class="bx bxs-star"></i>${rating} <small>(${reviews})</small></span>
          </div>
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.description || "Premium product from " + STORE_NAME + ".")}</p>
          <div class="product-footer">
            <span class="price">${formatPrice(product.price)}</span>
            <div class="product-actions">
              <button class="mini-button" data-action="quick" aria-label="Quick view"><i class="bx bx-show"></i></button>
              <button class="mini-button" data-action="add" aria-label="Add to cart" ${stock === 0 ? "disabled" : ""}><i class="bx bx-cart-add"></i></button>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderArrivals() {
    const arrivals = state.products
      .slice()
      .sort((a, b) => Number(isNew(b)) - Number(isNew(a)))
      .slice(0, 8);

    els.arrivalsWrapper.innerHTML = arrivals.map((product) => `
      <article class="new-card swiper-slide" data-product-id="${escapeAttr(product._id)}">
        <div class="product-media">
          <img src="${escapeAttr(getMedia(product))}" alt="${escapeAttr(product.name)}">
          <span class="badge">New</span>
        </div>
        <span class="product-category">${escapeHtml(product.category || "Featured")}</span>
        <h3>${escapeHtml(product.name)}</h3>
        <div class="product-footer">
          <span class="price">${formatPrice(product.price)}</span>
          <button class="mini-button" data-action="add" aria-label="Add to cart"><i class="bx bx-cart-add"></i></button>
        </div>
      </article>
    `).join("");

    if (window.newSwiperInstance) {
      window.newSwiperInstance.update();
    }
  }

  function isNew(product) {
    if (!product.createdAt) return false;
    const created = new Date(product.createdAt).getTime();
    return Number.isFinite(created) && Date.now() - created < 7 * 24 * 60 * 60 * 1000;
  }

  function addToCart(productId) {
    const product = state.products.find((item) => String(item._id) === String(productId));
    if (!product) return;
    if (Number(product.stock ?? 10) === 0) {
      showToast("This product is out of stock.");
      return;
    }

    const existing = state.cart.find((item) => String(item._id) === String(product._id));
    if (existing) {
      existing.qty += 1;
    } else {
      state.cart.push({ ...product, qty: 1 });
    }
    saveCart();
    renderCart();
    showToast(`${product.name} added to cart.`);
  }

  function updateCart(productId, qty) {
    if (qty < 1) {
      state.cart = state.cart.filter((item) => String(item._id) !== String(productId));
    } else {
      state.cart = state.cart.map((item) => (
        String(item._id) === String(productId) ? { ...item, qty } : item
      ));
    }
    saveCart();
    renderCart();
  }

  function renderCart() {
    const count = state.cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const total = state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);

    els.cartCount.textContent = count > 99 ? "99+" : String(count);
    els.cartItemsLabel.textContent = `${count} ${count === 1 ? "item" : "items"}`;
    els.cartTotal.textContent = formatPrice(total);
    els.cartEmpty.style.display = state.cart.length ? "none" : "block";
    els.checkoutButton.disabled = state.cart.length === 0;

    els.cartItems.innerHTML = state.cart.map((item) => {
      const media = isVideo(item)
        ? `<video src="${escapeAttr(getMedia(item))}" muted></video>`
        : `<img src="${escapeAttr(getMedia(item))}" alt="${escapeAttr(item.name)}">`;
      return `
        <article class="cart-card" data-product-id="${escapeAttr(item._id)}">
          ${media}
          <div class="cart-details">
            <h3>${escapeHtml(item.name)}</h3>
            <span class="cart-price">${formatPrice(item.price)}</span>
            <div class="cart-amount">
              <div class="cart-qty">
                <button data-cart-action="dec" aria-label="Decrease quantity">-</button>
                <span>${Number(item.qty || 0)}</span>
                <button data-cart-action="inc" aria-label="Increase quantity">+</button>
              </div>
              <button class="cart-remove" data-cart-action="remove" aria-label="Remove item"><i class="bx bx-trash"></i></button>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  function openQuickView(productId) {
    const product = state.products.find((item) => String(item._id) === String(productId));
    if (!product) return;
    const media = isVideo(product)
      ? `<video src="${escapeAttr(getMedia(product))}" autoplay muted loop playsinline></video>`
      : `<img src="${escapeAttr(getMedia(product))}" alt="${escapeAttr(product.name)}">`;

    els.quickView.innerHTML = `
      <article class="modal-card quick-view-content">
        <div class="quick-view-media">${media}</div>
        <div class="quick-view-body">
          <button class="modal-close" data-modal-close aria-label="Close quick view"><i class="bx bx-x"></i></button>
          <span class="product-category">${escapeHtml(product.category || "Featured")}</span>
          <h2>${escapeHtml(product.name)}</h2>
          <strong class="price">${formatPrice(product.price)}</strong>
          <p>${escapeHtml(product.description || "Premium product from " + STORE_NAME + ".")}</p>
          <div class="quick-view-actions">
            <button class="button" data-quick-add="${escapeAttr(product._id)}">Add to Cart</button>
            <button class="button button-soft" data-quick-buy="${escapeAttr(product._id)}">Buy Now</button>
          </div>
        </div>
      </article>
    `;
    els.quickView.classList.add("active");
    els.quickView.setAttribute("aria-hidden", "false");
    setOverlay(true);
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    els.login.classList.toggle("register-mode", mode === "register");
    els.authTitle.textContent = mode === "register" ? "Create your Visison Cart account" : "Sign in to Visison Cart";
    els.authSubmit.textContent = mode === "register" ? "Create Account" : "Sign In";
    els.authTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.authTab === mode));
    els.authMessage.textContent = "";
    els.authMessage.className = "form-message";
  }

  async function submitAuth(event) {
    event.preventDefault();
    els.authSubmit.disabled = true;
    els.authSubmit.textContent = state.authMode === "register" ? "Creating..." : "Signing in...";
    els.authMessage.className = "form-message";
    els.authMessage.textContent = "";

    const payload = state.authMode === "register"
      ? { name: els.authName.value.trim(), email: els.authEmail.value.trim(), password: els.authPassword.value }
      : { email: els.authEmail.value.trim(), password: els.authPassword.value };

    try {
      const data = await api(state.authMode === "register" ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (data.token) localStorage.setItem("vc_token", data.token);
      state.user = data.user || null;
      els.authMessage.className = "form-message success";
      els.authMessage.textContent = "Signed in successfully.";
      showToast("Welcome to Visison Cart.");
      setTimeout(closePanels, 500);
    } catch (error) {
      els.authMessage.className = "form-message error";
      els.authMessage.textContent = error.message || "Login failed.";
    } finally {
      els.authSubmit.disabled = false;
      els.authSubmit.textContent = state.authMode === "register" ? "Create Account" : "Sign In";
    }
  }

  async function checkout() {
    if (!state.cart.length) return;
    if (state.cart.some((item) => String(item._id).startsWith("local-"))) {
      showToast("Checkout needs live digital goods from the backend.");
      return;
    }
    if (!state.user) {
      showToast("Please sign in before checkout.");
      openLogin();
      return;
    }

    const items = state.cart.map((item) => ({
      product: item._id,
      qty: item.qty,
      price: item.price
    }));

    try {
      const data = await api("/orders", {
        method: "POST",
        body: JSON.stringify({ items })
      });
      if (data.order) {
        closePanels();
        openUpiModal(data.order.total, data.order._id);
      }
    } catch (error) {
      showToast(error.message || "Checkout failed. Is the backend running?");
    }
  }

  async function openUpiModal(amount, orderId) {
    let upi = { upiId: "visioncart@upi", upiName: STORE_NAME, qrImage: "" };
    try {
      const data = await api("/upi");
      upi = { ...upi, ...data };
    } catch (error) {
      // Keep the default UPI display when the backend is unavailable.
    }

    const upiUrl = `upi://pay?pa=${encodeURIComponent(upi.upiId)}&pn=${encodeURIComponent(upi.upiName)}&am=${amount}&cu=INR&tn=${encodeURIComponent(STORE_NAME + " Order")}`;
    const qr = upi.qrImage || `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiUrl)}`;

    els.upiModal.innerHTML = `
      <article class="modal-card upi-body">
        <button class="modal-close" data-modal-close aria-label="Close payment"><i class="bx bx-x"></i></button>
        <h2>Pay with UPI</h2>
        <p>Total: <strong>${formatPrice(amount)}</strong></p>
        <div class="upi-qr"><img src="${escapeAttr(qr)}" alt="UPI QR code"></div>
        <p>UPI ID: <strong>${escapeHtml(upi.upiId)}</strong></p>
        <div class="quick-view-actions">
          <button class="button" data-paid="${escapeAttr(orderId)}">I have paid</button>
          <button class="button button-soft" data-modal-close>Close</button>
        </div>
      </article>
    `;
    els.upiModal.classList.add("active");
    els.upiModal.setAttribute("aria-hidden", "false");
    setOverlay(true);
  }

  async function markPaid(orderId) {
    try {
      const data = await api("/receipts", {
        method: "POST",
        body: JSON.stringify({ orderId })
      });
      state.cart = [];
      saveCart();
      renderCart();
      showToast(data.receipt ? `Receipt ${data.receipt.receiptId} generated.` : "Receipt generated.");
      closePanels();
    } catch (error) {
      showToast(error.message || "Could not generate receipt.");
    }
  }

  async function loadProducts() {
    try {
      const [productData, categoryData] = await Promise.all([
        api("/products"),
        api("/categories").catch(() => ({ categories: [] }))
      ]);

      if (Array.isArray(productData.products) && productData.products.length) {
        state.products = productData.products;
      }

      const apiCategories = Array.isArray(categoryData.categories)
        ? categoryData.categories.map((item) => item.name).filter(Boolean)
        : [];
      state.categories = ["All", ...new Set([...apiCategories, ...state.products.map((item) => item.category).filter(Boolean)])];
    } catch (error) {
      state.categories = ["All", ...new Set(state.products.map((item) => item.category).filter(Boolean))];
      showToast("Using demo products. Start the backend to load your live catalog.");
    }

    renderCategories();
    renderProducts();
  }

  async function restoreUser() {
    try {
      const data = await api("/auth/me");
      state.user = data.user || null;
    } catch (error) {
      state.user = null;
    }
  }

  function initSwipers() {
    if (!window.Swiper) return;

    new Swiper(".home-swiper", {
      spaceBetween: 24,
      loop: true,
      pagination: {
        el: ".swiper-pagination",
        clickable: true
      }
    });

    window.newSwiperInstance = new Swiper(".new-swiper", {
      spaceBetween: 18,
      slidesPerView: 1.15,
      breakpoints: {
        576: { slidesPerView: 2 },
        900: { slidesPerView: 3 },
        1120: { slidesPerView: 4 }
      }
    });
  }

  function initParticles() {
    const canvas = els.particleCanvas;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pointer = { x: 0, y: 0, active: false };
    const particles = [];
    let width = 0;
    let height = 0;
    let frameId = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = Math.min(78, Math.max(36, Math.floor(width / 18)));
      particles.length = 0;
      for (let i = 0; i < target; i += 1) {
        particles.push(makeParticle());
      }
    }

    function makeParticle() {
      const purple = Math.random() > 0.32;
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.32,
        vy: (Math.random() - 0.5) * 0.32,
        size: Math.random() * 1.9 + 0.7,
        alpha: Math.random() * 0.45 + 0.18,
        color: purple ? "160, 104, 255" : "78, 214, 191"
      };
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (pointer.active) {
          const dx = pointer.x - p.x;
          const dy = pointer.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150 && dist > 1) {
            p.x -= dx * 0.002;
            p.y -= dy * 0.002;
          }
        }

        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;

        ctx.beginPath();
        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.shadowColor = `rgba(${p.color}, 0.85)`;
        ctx.shadowBlur = 12;
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 118) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(169, 105, 255, ${0.13 * (1 - dist / 118)})`;
            ctx.lineWidth = 1;
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      frameId = requestAnimationFrame(draw);
    }

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
    }, { passive: true });
    window.addEventListener("pointerleave", () => {
      pointer.active = false;
    });

    resize();
    draw();

    window.addEventListener("beforeunload", () => cancelAnimationFrame(frameId), { once: true });
  }

  function resolveTheme(choice) {
    if (choice !== "system") return choice;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(choice) {
    const selected = ["light", "grey", "dark", "system"].includes(choice) ? choice : "system";
    localStorage.setItem(THEME_KEY, selected);
    document.documentElement.dataset.theme = resolveTheme(selected);
    document.documentElement.dataset.themeChoice = selected;
    if (els.themeSelect) {
      els.themeSelect.value = selected;
    }
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || "system";
    applyTheme(saved);

    if (window.matchMedia) {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", () => {
        if ((localStorage.getItem(THEME_KEY) || "system") === "system") {
          applyTheme("system");
        }
      });
    }
  }

  function bindEvents() {
    window.addEventListener("scroll", () => {
      els.header.classList.toggle("scrolled", window.scrollY > 40);
      els.scrollUp.classList.toggle("show-scroll", window.scrollY > 360);
    }, { passive: true });

    els.scrollUp.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    els.navToggle.addEventListener("click", openMenu);
    els.navClose.addEventListener("click", closePanels);
    els.cartShop.addEventListener("click", openCart);
    els.cartClose.addEventListener("click", closePanels);
    els.loginButton.addEventListener("click", openLogin);
    els.loginClose.addEventListener("click", closePanels);
    els.overlay.addEventListener("click", closePanels);

    els.navLinks.forEach((link) => {
      link.addEventListener("click", () => {
        els.navLinks.forEach((item) => item.classList.remove("active-link"));
        link.classList.add("active-link");
        closePanels();
      });
    });

    els.search.addEventListener("input", (event) => {
      state.search = event.target.value;
      renderProducts();
    });

    els.featuredToggle.addEventListener("click", () => {
      state.featuredOnly = !state.featuredOnly;
      renderProducts();
    });

    els.categoryRow.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.selectedCategory = button.dataset.category;
      renderCategories();
      renderProducts();
    });

    document.addEventListener("click", (event) => {
      const productCard = event.target.closest("[data-product-id]");
      const actionButton = event.target.closest("[data-action]");
      if (productCard && actionButton) {
        const id = productCard.dataset.productId;
        if (actionButton.dataset.action === "add") addToCart(id);
        if (actionButton.dataset.action === "quick") openQuickView(id);
      }

      const quickAdd = event.target.closest("[data-quick-add]");
      if (quickAdd) {
        addToCart(quickAdd.dataset.quickAdd);
        closePanels();
        openCart();
      }

      const quickBuy = event.target.closest("[data-quick-buy]");
      if (quickBuy) {
        addToCart(quickBuy.dataset.quickBuy);
        closePanels();
        openCart();
      }

      if (event.target.closest("[data-modal-close]")) {
        closePanels();
      }

      const paid = event.target.closest("[data-paid]");
      if (paid) {
        markPaid(paid.dataset.paid);
      }
    });

    els.cartItems.addEventListener("click", (event) => {
      const card = event.target.closest("[data-product-id]");
      const action = event.target.closest("[data-cart-action]");
      if (!card || !action) return;
      const item = state.cart.find((entry) => String(entry._id) === String(card.dataset.productId));
      if (!item) return;
      if (action.dataset.cartAction === "inc") updateCart(item._id, Number(item.qty) + 1);
      if (action.dataset.cartAction === "dec") updateCart(item._id, Number(item.qty) - 1);
      if (action.dataset.cartAction === "remove") updateCart(item._id, 0);
    });

    els.checkoutButton.addEventListener("click", checkout);
    els.authForm.addEventListener("submit", submitAuth);
    els.authTabs.forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.authTab)));
    els.googleLogin.addEventListener("click", () => { window.location.href = API.replace("/api", "") + "/api/auth/google"; });
    els.discordLogin.addEventListener("click", () => { window.location.href = API.replace("/api", "") + "/api/auth/discord"; });

    els.newsletterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      event.currentTarget.reset();
      showToast("Thanks for subscribing to Visison Cart digital drop alerts.");
    });

    if (els.themeSelect) {
      els.themeSelect.addEventListener("change", (event) => {
        applyTheme(event.target.value);
        showToast(`Theme set to ${event.target.options[event.target.selectedIndex].text}.`);
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePanels();
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function init() {
    warmBackend();
    window.addEventListener("online", warmBackend);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) warmBackend();
    });
    setInterval(() => {
      if (!document.hidden) warmBackend();
    }, 4 * 60 * 1000);
    initTheme();
    bindEvents();
    initParticles();
    initSwipers();
    renderCart();
    renderCategories();
    renderProducts();
    setAuthMode("login");
    restoreUser();
    loadProducts().finally(hidePreviewLoading);
  }

  init();
})();
