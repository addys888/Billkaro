# 🔧 BillKaro — Setup Guide

Complete guide to set up BillKaro for local development.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20+ | Runtime |
| npm | 10+ | Package manager |
| Docker | 24+ | PostgreSQL & Redis |
| Docker Compose | 2.20+ | Container orchestration |
| Git | 2.40+ | Version control |

---

## Step 1: External Account Setup

### 1.1 Meta Developer Account (WhatsApp Cloud API)

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create a new app → Select "Business" type
3. Add the **WhatsApp** product to your app
4. From WhatsApp > Getting Started:
   - Note your **Phone Number ID**
   - Note your **WhatsApp Business Account ID**
   - Generate a **Permanent Access Token** (System User Token)
5. Set up a webhook URL (see [WhatsApp Setup Guide](WHATSAPP_SETUP.md))

### 1.2 OpenAI API Key

1. Go to [platform.openai.com](https://platform.openai.com)
2. Create an API key
3. Ensure you have access to `gpt-4o-mini` and `whisper-1` models
4. Add billing (GPT-4o-mini costs ~$0.15/1M input tokens)

### 1.3 Razorpay Account

1. Go to [razorpay.com](https://razorpay.com) → Sign Up
2. Complete KYC verification
3. From Dashboard > Settings > API Keys:
   - Generate **Key ID** and **Key Secret**
4. From Dashboard > Settings > Webhooks:
   - Add webhook URL: `https://your-domain.com/webhook/razorpay`
   - Select events: `payment_link.paid`, `payment_link.expired`
   - Note the **Webhook Secret**

### 1.4 Cloudflare R2 (File Storage) — Optional for MVP

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Navigate to R2 > Create Bucket → Name: `billkaro-invoices`
3. Create R2 API token with read/write access
4. Note: Endpoint URL, Access Key, Secret Key

> For MVP, you can store PDFs locally in `server/tmp/` and serve via Express static.

---

## Step 2: Local Infrastructure

```bash
# From project root
docker compose up -d

# Verify services
docker compose ps
# Expected: postgres (5432), redis (6379), adminer (8080)
```

Access Adminer at `http://localhost:8080`:
- System: PostgreSQL
- Server: postgres
- Username: billkaro
- Password: billkaro_dev
- Database: billkaro_db

---

## Step 3: Backend Setup

```bash
cd server

# Install dependencies
npm install

# Copy environment variables
cp ../.env.example .env
# Edit .env with your API keys

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# Seed sample data (optional)
npx prisma db seed

# Start dev server
npm run dev
# Server runs on http://localhost:4000
```

---

## Step 4: Frontend Setup

```bash
cd dashboard

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Start dev server
npm run dev
# Dashboard runs on http://localhost:3000
```

---

## Step 5: Webhook Tunneling (for WhatsApp)

For local development, you need a public URL for webhooks. Use `ngrok`:

```bash
# Install ngrok
brew install ngrok  # macOS

# Tunnel to your backend
ngrok http 4000
```

Copy the public URL (e.g., `https://abc123.ngrok.io`) and configure it in:
1. Meta WhatsApp webhook settings
2. Razorpay webhook settings

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Docker containers won't start | Check if ports 5432/6379/8080 are in use |
| Prisma migration fails | Ensure PostgreSQL is running: `docker compose ps` |
| WhatsApp messages not arriving | Verify webhook URL and verify token in Meta dashboard |
| PDF generation crashes | Ensure Puppeteer dependencies installed: `npx puppeteer install` |
