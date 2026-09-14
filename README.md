# Vippy Spend Tracker

Internal expense tracker for HDFC corporate card transactions at **Vippy Industries**. Connects to Gmail, parses transaction alerts using Sarvam-105B (with GPT-5.6 fallback), and displays a visual dashboard with spending insights.

## Features

- **Gmail Sync** — Fetches HDFC bank alerts, Amazon orders, Swiggy/Zomato receipts, and refund emails
- **AI Parsing** — Sarvam-105B extracts merchant, amount, date, category, item descriptions, and transaction notes, with GPT-5.6 as fallback
- **Multi-user Auth** — Google OAuth with NextAuth, user-scoped data isolation
- **Dashboard** — Donut chart, bar chart, spending insights (top category, daily avg, most frequent merchant)
- **Date Filtering** — Date range picker with presets (7D, 30D, 90D, 1Y, All)
- **Transaction Detail** — Click any transaction for full detail popup with AI insights
- **User Notes** — Add personal notes to any transaction
- **Receipt Tracking** — Track missing vs attached receipts, Amazon orders auto-marked
- **Reports** — CSV export, category breakdown table, missing receipts report
- **Refund Detection** — Amazon returns and HDFC reversals auto-detected, subtracted from totals
- **Dark Mode** — Light/dark theme toggle, persisted in localStorage
- **Mobile Responsive** — Full mobile-optimized layout

## Architecture

```
Browser (Next.js App)
    |
    |── Google OAuth ──> NextAuth (session + JWT)
    |
    |── Sync Gmail ──> POST /api/sync
    |                      |── Gmail API (fetch emails)
    |                      |── Sarvam-105B (parse → structured data), GPT-5.6 fallback
    |                      |── Supabase (store per-user)
    |
    |── Dashboard ──> GET /api/transactions
    |                      |── Supabase (user-scoped query)
    |
    |── Reports ──> GET /api/reports?format=csv|json
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Auth | NextAuth v4 + Google OAuth |
| Email | Gmail API via `googleapis` |
| AI | Sarvam-105B (`sarvam:sarvam-105b`), GPT-5.6 fallback (`openai:gpt-5.6`) |
| Database | Supabase (PostgreSQL) |
| Charts | Chart.js + react-chartjs-2 |
| Styling | CSS variables + inline styles (no framework) |
| Hosting | Vercel |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/sync` | POST | Gmail → Sarvam-105B/GPT-5.6 → Supabase (auth required) |
| `/api/transactions` | GET | Load user's transactions |
| `/api/transactions` | PATCH | Update receipt status or user notes |
| `/api/transactions/claim` | POST | Claim orphaned transactions |
| `/api/reports` | GET | CSV export or JSON summary report |
| `/api/auth/[...nextauth]` | * | NextAuth OAuth handlers |
| `/api/auth/status` | GET | Check connection status |

## Database Schema

```sql
create table transactions (
  id               bigint generated always as identity primary key,
  email_id         text,
  user_id          text,
  merchant         text not null,
  amount           numeric not null,
  date             date not null,
  category         text not null,
  has_receipt      boolean default false,
  is_refund        boolean default false,
  item_description text,
  notes            text,
  txn_time         text,
  user_notes       text,
  raw_email        text,
  created_at       timestamptz default now(),
  unique(email_id, user_id)
);
```

## Environment Variables

```
SARVAM_API_KEY           — Sarvam API key (text parsing, document extraction)
OPENAI_API_KEY           — OpenAI API key (vision reads, text fallback)
GOOGLE_CLIENT_ID         — Google OAuth client ID
GOOGLE_CLIENT_SECRET     — Google OAuth client secret
GOOGLE_REFRESH_TOKEN     — Gmail refresh token
NEXTAUTH_SECRET          — NextAuth session secret
NEXTAUTH_URL             — App base URL (no trailing slash)
SUPABASE_URL             — Supabase project URL
SUPABASE_ANON_KEY        — Supabase anonymous key
```

## Setup

```bash
git clone https://github.com/khush0030/vippy-spend-tracker.git
cd vippy-spend-tracker
npm install
cp .env.local.example .env.local  # Fill in your keys
npm run dev
```

1. Visit `http://localhost:3000` → Sign in with Google
2. Click **Sync Gmail** to fetch and parse transactions
3. Future syncs only process new emails (no duplicate API costs)

## Google Cloud Console Setup

| Setting | Value |
|---------|-------|
| API to enable | Gmail API |
| OAuth scope | `openid email profile https://www.googleapis.com/auth/gmail.readonly` |
| Authorized JS origins | `http://localhost:3000`, `https://your-app.vercel.app` |
| Redirect URIs | `http://localhost:3000/api/auth/callback/google`, `https://your-app.vercel.app/api/auth/callback/google` |

## Project Structure

```
app/
  layout.js                       — Root layout + SessionProvider
  page.js                         — Dashboard (all tabs, charts, modals)
  providers.js                    — NextAuth SessionProvider
  login/page.js                   — Login page
  api/sync/route.js               — Gmail + Sarvam/GPT + Supabase sync
  api/transactions/route.js       — CRUD transactions
  api/transactions/claim/route.js — Claim orphaned transactions
  api/reports/route.js            — CSV/JSON report generation
  api/auth/[...nextauth]/route.js — NextAuth handler
  api/auth/status/route.js        — Connection check
lib/
  auth.js                         — NextAuth config
  gmail.js                        — Gmail API client
  supabase.js                     — Supabase client
  categories.js                   — Category definitions
middleware.js                     — Auth middleware
```
