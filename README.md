# VisionCart

Full-stack e-commerce store with UPI payments, Google/Discord OAuth, admin panel with live UPI management, per-order chat, and a Discord bot for payment confirmations.

---

## Recommended Production Architecture

- **Frontend:** Vercel
- **Backend/API:** DigitalOcean App Platform (`backend`, `npm start`)
- **Database:** DigitalOcean Managed PostgreSQL
- **Product images/videos:** DigitalOcean Spaces with CDN
- **Monitoring:** DigitalOcean Uptime checks against `/health`

This keeps VisionCart production-ready without Kubernetes, large droplets, load balancers, or unnecessary infrastructure spend.

---

## DigitalOcean App Platform Deployment

### 1. Managed PostgreSQL

1. Create a DigitalOcean Managed PostgreSQL cluster.
2. Copy the connection string.
3. Set it in App Platform as:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:25060/visioncart?sslmode=require
```

DigitalOcean managed database backups work at the database layer, so the backend stores orders/products/users in PostgreSQL tables instead of project files.

### 2. DigitalOcean Spaces

1. Create a Space.
2. Create Spaces access keys.
3. Set these backend env vars:

```env
DO_SPACES_KEY=
DO_SPACES_SECRET=
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
DO_SPACES_BUCKET=
DO_SPACES_REGION=nyc3
```

Uploaded product media is stored in Spaces through the S3-compatible API, not inside the repo or App Platform container.

### 3. Backend App Platform Service

Use these settings:

| Setting | Value |
|---|---|
| Source Directory | `backend` |
| Build Command | `npm ci` |
| Run Command | `npm start` |
| HTTP Port | `5000` |
| Health Check Path | `/health` |

Required backend env vars:

```env
DATABASE_URL=
JWT_SECRET=
SESSION_SECRET=
DO_SPACES_KEY=
DO_SPACES_SECRET=
DO_SPACES_ENDPOINT=
DO_SPACES_BUCKET=
DO_SPACES_REGION=
FRONTEND_URL=
CLIENT_URL=
SERVER_URL=
NODE_ENV=production
ADMIN_EMAIL=
ADMIN_PASSWORD=
```

Optional env vars:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_WEBHOOK_URL=
DISCORD_BOT_SECRET=
UPI_ID=
UPI_NAME=
```

An example App Platform spec is available at `.do/app.yaml.example`.

### 4. Frontend on Vercel

Set:

```env
VITE_API_URL=https://vision-cart.onrender.com/api
```

Also set the frontend deployment URL in backend `FRONTEND_URL` and `CLIENT_URL`. For this deployment, use `https://vision-cart-ivory.vercel.app`.

### 5. OAuth Redirect URLs

Use the backend URL for OAuth callbacks:

```text
https://your-digitalocean-backend.ondigitalocean.app/api/auth/google/callback
https://your-digitalocean-backend.ondigitalocean.app/api/auth/discord/callback
```

---

## Project Structure

```
VisionCart/
├── frontend/              # React + Vite SPA
│   ├── src/
│   │   ├── App.jsx        # Main storefront and admin UI
│   │   ├── main.jsx       # Entry point
│   │   └── index.css      # Global styles
│   ├── public/
│   │   ├── banner.gif     # Animated logo
│   │   └── placeholder.png
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── package-lock.json
│   ├── .env.example
│   └── .gitignore
│
├── backend/               # Express + MongoDB REST API
│   ├── src/
│   │   └── server.js      # Backend entrypoint
│   ├── server.js          # Existing API implementation
│   ├── package.json
│   ├── package-lock.json
│   ├── .env.example
│   └── .gitignore
│
└── discord-bot/           # Discord.js bot for payment ops
    ├── bot.js
    ├── package.json
    ├── .env.example
    └── .gitignore
```

---

## Local Setup

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)

### 1. Backend
```bash
cd backend
cp .env.example .env
# Edit .env with your values (see Environment Variables section)
npm install
npm run dev
```

### 2. Frontend
```bash
cd frontend
cp .env.example .env
# Edit .env with your values
npm install
npm run dev
```

### 3. Discord Bot (optional)
```bash
cd discord-bot
cp .env.example .env
# Edit .env with your values
npm install
npm start
```

Open http://localhost:5173

### Security Notes
- Keep `.env` files out of git.
- Use `.env.example` as the only committed environment template.
- Never commit real MongoDB URLs, JWT secrets, payment keys, webhook URLs, or admin passwords.
- Rotate any secret that has ever been shared outside your trusted environment.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | JWT signing key (min 32 chars) |
| `SESSION_SECRET` | Yes | Express session secret (min 32 chars) |
| `ADMIN_EMAIL` | Yes | Root admin email (seeded on first run) |
| `ADMIN_PASSWORD` | Yes | Root admin password |
| `SERVER_URL` | Yes | Public URL for OAuth callbacks (e.g. https://your-app.onrender.com) |
| `CLIENT_URL` | Yes | Frontend URL for CORS (comma-separated for multiple origins) |
| `PORT` | No | Server port (default: 5000) |
| `UPI_ID` | No | Default UPI ID |
| `UPI_NAME` | No | Default UPI display name |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `DISCORD_CLIENT_ID` | No | Discord OAuth client ID |
| `DISCORD_CLIENT_SECRET` | No | Discord OAuth client secret |
| `CLOUDINARY_CLOUD_NAME` | No | Cloudinary cloud name (for image/video uploads) |
| `CLOUDINARY_API_KEY` | No | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | No | Cloudinary API secret |
| `DISCORD_WEBHOOK_URL` | No | Discord webhook for payment notifications |
| `DISCORD_BOT_SECRET` | For bot | Shared secret between backend and Discord bot |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Yes | Backend API URL (e.g. http://localhost:5000/api) |
| `VITE_UPI_ID` | No | Default UPI ID (overridable via Admin Panel) |
| `VITE_UPI_NAME` | No | Default UPI display name |
| `VITE_ADMIN_EMAIL` | No | Root admin email (hides Remove button for this admin) |

### Discord Bot (`discord-bot/.env`)

| Variable | Required | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `DISCORD_BOT_SECRET` | Yes | Must match backend `DISCORD_BOT_SECRET` |
| `VISIONCART_API_URL` | Yes | Backend API URL (e.g. https://your-app.onrender.com/api) |

---

## Deploy on Render (Free)

### Backend → Web Service
| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Environment | Node |

Add all env vars from `backend/.env.example` with real values.

### Frontend → Static Site
| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Build Command | `npm install && npm run build` |
| Publish Directory | `dist` |

Add env var: `VITE_API_URL = https://your-backend.onrender.com/api`

### Discord Bot → Background Worker or separate host
| Setting | Value |
|---|---|
| Root Directory | `discord-bot` |
| Build Command | `npm install` |
| Start Command | `node bot.js` |
| Environment | Node |

---

## Discord Bot Setup

1. Go to https://discord.com/developers/applications → New Application
2. Go to Bot → Add Bot → Copy token (this is `DISCORD_BOT_TOKEN`)
3. Enable Privileged Gateway Intents: Server Members Intent, Message Content Intent
4. Go to OAuth2 → URL Generator → Scopes: `bot` → Permissions: `Send Messages`, `Use Slash Commands` → Copy URL → Open in browser to invite bot
5. In `discord-bot/.env` set:
   - `DISCORD_BOT_TOKEN` = token from step 2
   - `DISCORD_BOT_SECRET` = a random long string (must match backend `DISCORD_BOT_SECRET`)
   - `VISIONCART_API_URL` = your backend API URL

Bot commands (registered automatically on startup):
- `/receipt VC-XXXXXXXX` — Look up a receipt
- `/confirm VC-XXXXXXXX` — Confirm a payment
- `/reject VC-XXXXXXXX` — Reject a payment

---

## Production Checklist

- [ ] MongoDB Atlas cluster configured (M0 free tier is sufficient)
- [ ] All env vars set with production values (not defaults)
- [ ] `JWT_SECRET` and `SESSION_SECRET` are strong random strings (32+ chars)
- [ ] Cloudinary account created (free tier) for image/video uploads
- [ ] Google OAuth credentials created (if using social login)
- [ ] Discord OAuth credentials created (if using social login)
- [ ] Discord bot created, invited to server, and `DISCORD_BOT_SECRET` matches both backend and bot
- [ ] Discord webhook URL configured (for payment notifications)
- [ ] `banner.gif` and `placeholder.png` exist in `frontend/public/`
- [ ] CORS: `CLIENT_URL` matches your frontend domain exactly
- [ ] Frontend build passes (`cd frontend && npm run build`)
- [ ] Backend starts without errors (`cd backend && node server.js`)
- [ ] Rate limits tested (200 req/15min general, 20 for auth, 30 for orders/receipts)
- [ ] Admin can log in at `/api/auth/login` and access admin panel
- [ ] Payment flow works: add to cart → checkout → UPI → receipt → Discord notification → Bot confirm
- [ ] `NODE_ENV=production` set on production server

---

## Known Limitations

- **Single-file architecture**: All frontend components live in one file (`App.jsx`). Works fine for this scale but becomes harder to maintain beyond ~1500 lines.
- **No TypeScript**: Plain JavaScript with JSX. No type safety.
- **No automated tests**: No unit, integration, or E2E tests.
- **No state management library**: Uses raw `useState`/`useContext` patterns. No Redux or Zustand.
- **Client-side admin email check**: The Remove button in Admin → Admins tab uses `VITE_ADMIN_EMAIL` to protect the root admin. If this env var is missing, the button appears but the backend still blocks removal (double protection).
- **Polling-based chat**: Order chat uses REST polling (no WebSocket). New messages require a manual refresh or re-mount.
- **Cloudinary-dependent uploads**: Product image/video upload requires Cloudinary credentials. Without them, admin can still add products by pasting image URLs directly.
- **QR code uses external API**: Auto-generated UPI QR uses `api.qrserver.com` — requires internet. Custom QR upload is recommended for production.
- **OAuth state validation**: CSRF state is stored in session (server-side). This means OAuth requires session affinity or shared session store in multi-instance deployments.
- **No password reset flow**: Users who lose password cannot reset it. Admin must manually update in DB.
- **No email notifications**: Order confirmations, receipt updates, and chat messages rely entirely on Discord. No email-based notifications.

---

## Features

- Product listing with search and skeleton loading
- Cart with quantity management (localStorage-persisted)
- UPI payment with QR code (live-updatable from Admin Panel)
- JWT auth + Google OAuth + Discord OAuth
- Order history with receipt modals
- Order chat (between admin and customer)
- Admin Panel: Add/delete products, view/filter orders, update order status, chat with customers, manage UPI settings, manage admins
- Discord bot: `/receipt`, `/confirm`, `/reject` commands
- Discord webhook notifications for payments
- Animated particle background, typewriter effect, toast notifications
- Responsive design (mobile + desktop)
- Rate limiting, security headers, NoSQL injection protection
- Server-side price computation (prevents client-side tampering)
- Atomic stock management (race-condition-safe)

---

## Security

- Helmet security headers
- HPP (HTTP parameter pollution) protection
- express-mongo-sanitize (NoSQL injection prevention)
- CORS whitelist-based origin validation
- Rate limiting on all endpoints (stricter on auth, orders, receipts)
- Server-side order total computation (client cannot tamper with prices)
- Atomic stock decrement via `findOneAndUpdate` with `$gte` check
- httpOnly cookies for JWT with secure/sameSite config
- Input validation on all user-submitted data
- Min password length enforced (8 chars)
- JWT/SESSION secrets validated at startup (min 32 chars)
- Required env vars checked at startup — exits with error if missing

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 + Framer Motion 11 |
| Backend | Node.js + Express 4 |
| Database | MongoDB + Mongoose 8 |
| Auth | JWT + Passport (Google OAuth 2.0, Discord OAuth) |
| File Uploads | Cloudinary via Multer |
| Styling | Custom CSS (CSS variables, gradients, glass effects) |
| Discord Bot | discord.js v14 with slash commands |
| Hosting | Render-ready (Static Site + Web Service + Worker) |
