# 🧾 BillKaro — WhatsApp-First Smart Invoicing & Collection Bot

> **"Bol ke bill banao, WhatsApp pe paisa pao."**
> *(Say it to bill it, get paid on WhatsApp.)*

BillKaro is a micro-SaaS platform that enables Indian SMEs (contractors, distributors, agencies) to generate GST-compliant invoices and collect payments entirely through WhatsApp — no app downloads, no accounting knowledge required.

---

## ✨ Features

- **WhatsApp-Native Invoicing** — Send a text or voice note, get a professional PDF invoice in seconds
- **Automated Payment Reminders** — Polite, scheduled follow-ups so you never chase payments manually
- **UPI Payment Links** — Every invoice includes a one-tap payment link (Razorpay)
- **Smart NLU** — Understands Hindi, English, and Hinglish naturally
- **Owner Dashboard** — Track financials, invoices, and clients from any browser
- **Client Payment Scores** — Know which clients pay on time

---

## 🏗️ Architecture

```
├── server/          # Node.js + Express + TypeScript backend
│   ├── prisma/      # Database schema (PostgreSQL)
│   ├── src/
│   │   ├── bot/     # WhatsApp conversation flows
│   │   ├── routes/  # REST API endpoints
│   │   ├── services/# Business logic (NLU, PDF, payments, reminders)
│   │   ├── templates/# Invoice PDF templates
│   │   └── utils/   # Shared utilities
│   └── ...
├── dashboard/       # Next.js 14 frontend
│   ├── src/
│   │   ├── app/     # App Router pages
│   │   ├── components/
│   │   ├── hooks/
│   │   └── lib/
│   └── ...
├── docs/            # Setup guides & API reference
└── docker-compose.yml  # PostgreSQL + Redis for local dev
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Meta Developer Account (WhatsApp Cloud API)
- Razorpay Account
- OpenAI API Key

### 1. Clone & Install

```bash
git clone https://github.com/your-org/billkaro.git
cd billkaro

# Install backend dependencies
cd server && npm install

# Install frontend dependencies
cd ../dashboard && npm install
```

### 2. Start Infrastructure

```bash
# From project root
docker compose up -d
```

This starts PostgreSQL (port 5432), Redis (port 6379), and Adminer (port 8080).

### 3. Configure Environment

```bash
# Copy env template
cp .env.example .env
# Edit .env with your API keys
```

### 4. Initialize Database

```bash
cd server
npx prisma migrate dev --name init
npx prisma generate
```

### 5. Run Development Servers

```bash
# Terminal 1: Backend API
cd server && npm run dev

# Terminal 2: Frontend Dashboard
cd dashboard && npm run dev
```

- **API**: http://localhost:4000
- **Dashboard**: http://localhost:3000
- **DB Viewer**: http://localhost:8080

---

## 📚 Documentation

| Document | Description |
|---|---|
| [Setup Guide](docs/SETUP_GUIDE.md) | Detailed prerequisite setup |
| [WhatsApp Setup](docs/WHATSAPP_SETUP.md) | Meta Cloud API configuration |
| [API Reference](docs/API_REFERENCE.md) | REST API documentation |
| [Product Blueprint](PRODUCT_BLUEPRINT.md) | Full product design & strategy |

---

## 🛠️ Tech Stack

| Component | Technology |
|---|---|
| Backend | Node.js 20, Express, TypeScript |
| Database | PostgreSQL 16, Prisma ORM |
| Queue | Redis 7, BullMQ |
| AI/NLU | OpenAI GPT-4o-mini, Whisper |
| PDF | Puppeteer, Handlebars |
| Payments | Razorpay (UPI, cards, netbanking) |
| WhatsApp | Meta Cloud API |
| Frontend | Next.js 14, React 18, Recharts |
| Storage | Cloudflare R2 (S3-compatible) |

---

## 📄 License

Proprietary — All rights reserved.
