# Discord Bot Setup Guide

## Step 1 — Create the bot
1. Go to https://discord.com/developers/applications
2. Click "New Application" → name it "VisionCart"
3. Go to "Bot" tab → "Add Bot"
4. Copy the **Bot Token** — this is DISCORD_BOT_TOKEN in bot/.env

## Step 2 — Invite bot to your server
1. Go to "OAuth2" → "URL Generator"
2. Scopes: `bot`, `applications.commands`
3. Bot Permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`
4. Open the generated URL and invite to your server

## Step 3 — Create a Webhook (for payment notifications)
1. In your Discord server → right-click the channel where you want notifications
2. Edit Channel → Integrations → Webhooks → New Webhook
3. Copy the Webhook URL → add to backend .env as DISCORD_WEBHOOK_URL

## Step 4 — Set up bot .env
```
cd discord-bot
cp .env.example .env
# Fill in:
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_BOT_SECRET=same_as_backend_DISCORD_BOT_SECRET
VISIONCART_API_URL=https://vision-cart.onrender.com/api
```

## Step 5 — Run the bot
```
npm install
npm start
```

## Bot Commands
- `/receipt VC-AB12CD34` — view receipt details
- `/confirm VC-AB12CD34` — confirm payment ✅
- `/reject VC-AB12CD34`  — reject payment ❌

## How it works
1. Customer pays via UPI on website
2. Customer clicks "I've Paid — Get Receipt"
3. Backend generates receipt ID (e.g. VC-XY78MN23)
4. Backend sends embed to Discord webhook with all order details
5. Admin runs `/confirm VC-XY78MN23` in Discord
6. Bot calls backend API → order marked as paid → customer sees confirmed on Orders page
