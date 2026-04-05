# Vippy Spend Tracker

Expense tracker for HDFC corporate card transactions at Vippy Industries. Connects to Gmail to automatically pull transaction alerts and Amazon order emails, parses them using Claude AI, and displays a visual dashboard.

## Architecture

```
Browser (Next.js App)
    |
    |── Sync Gmail ──> POST /api/sync
    |                      |
    |                      |── Gmail API (googleapis)
    |                      |     Fetches HDFC alert emails + Amazon order emails
    |                      |
    |                      |── Claude API (claude-sonnet-4-20250514)
    |                      |     Parses email text into structured transaction data
    |                      |     (merchant, amount, date, category, receipt status)
    |                      |
    |                      |── Supabase (PostgreSQL)
    |                            Stores transactions, deduplicates by email_id
    |
    |── Dashboard UI
          |── Overview tab    → Donut chart (category split) + Bar chart (breakdown)
          |── Transactions tab → Filterable list with category badges + receipt toggle
          |── Receipts tab     → Missing vs attached receipt tracking
```

## Tech Stack

- **Next.js 14** — App Router, React Server Components
- **Gmail API** — `googleapis` npm package, OAuth2 with refresh token
- **Claude AI** — Anthropic API for email-to-transaction parsing
- **Supabase** — PostgreSQL database for persistence
- **Chart.js** — `react-chartjs-2` for donut and bar charts
- **Inline styles** — No CSS framework

## Data Flow

1. User clicks "Sync Gmail"
2. Server fetches all HDFC/Amazon emails via Gmail API
3. Checks Supabase for already-processed email IDs (dedup)
4. Sends new emails to Claude in batches of 10 (with rate limit handling)
5. Claude returns structured JSON: merchant, amount, date, category, receipt status
6. Transactions saved to Supabase
7. Dashboard renders charts and lists from stored data

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/sync` | POST | Fetch Gmail → Parse with Claude → Store in Supabase |
| `/api/transactions` | GET | Load all transactions from Supabase |
| `/api/transactions` | PATCH | Toggle receipt status |
| `/api/auth/google` | GET | Initiate Google OAuth flow |
| `/api/auth/callback` | GET | Handle OAuth callback, display refresh token |
| `/api/auth/status` | GET | Check if Google account is connected |

## Database Schema

```sql
transactions (
  id             bigint (auto)
  email_id       text (unique)
  merchant       text
  amount         numeric
  date           date
  category       text       -- amazon|fuel|dining|swiggy|utilities|subscriptions|office|travel|other
  has_receipt    boolean
  item_description text
  raw_email      text
  created_at     timestamptz
)
```

## Environment Variables

```
ANTHROPIC_API_KEY      — Claude API key
GOOGLE_CLIENT_ID       — Google OAuth client ID
GOOGLE_CLIENT_SECRET   — Google OAuth client secret
GOOGLE_REFRESH_TOKEN   — Gmail refresh token (obtained via /api/auth/google)
SUPABASE_URL           — Supabase project URL
SUPABASE_ANON_KEY      — Supabase anonymous/public key
NEXTAUTH_URL           — App base URL (http://localhost:3000 or Vercel domain)
```

## Setup

```bash
npm install
# Fill in .env.local with your keys
npm run dev
# Visit http://localhost:3000
# Click "Connect Google Account" → authorize → copy refresh token to .env.local
# Click "Sync Gmail" to fetch and parse transactions
```

## Project Structure

```
app/
  layout.js                    — Root layout
  page.js                      — Dashboard UI (all 3 tabs)
  api/sync/route.js            — Gmail fetch + Claude parse + Supabase store
  api/transactions/route.js    — CRUD for transactions
  api/auth/google/route.js     — OAuth initiation
  api/auth/callback/route.js   — OAuth callback
  api/auth/status/route.js     — Connection status check
lib/
  gmail.js                     — Gmail API client with pagination
  claude.js                    — Claude parser with batching + rate limit retry
  supabase.js                  — Supabase client
  categories.js                — Category definitions and colors
```
