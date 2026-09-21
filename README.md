# Khata Sathi (Cloud Edition)

**Your bills, your khata — completely cloud-hosted.**

Khata Sathi is a cloud-native credit notebook (khata) and receipt management application designed for production on **Vercel** with **PostgreSQL** and **Supabase Auth / Google OAuth**.

After deploying, you can **turn off your laptop** and access Khata Sathi from any phone, laptop, or tablet worldwide via your custom domain or Vercel URL.

---

## Production Cloud Architecture

```
                      My Custom Domain (e.g. https://mydomain.com)
                                            |
                                            v
                                     Vercel Edge CDN
                                     /             \
                   Frontend (PWA/SPA)               Python Serverless API
                                                            |
                                        +-------------------+-------------------+
                                        |                                       |
                                        v                                       v
                             PostgreSQL Database                       Supabase Auth & Storage
                         (Neon.tech or Supabase)                      (Google OAuth + Storage)
                     All business data & audit trail                 Multi-tenant user identity
```

---

## Complete Step-by-Step Cloud Setup & Deployment Guide

### Step 1: Create a Free PostgreSQL Database on Supabase (or Neon)
1. Go to [Supabase](https://supabase.com) and create a free account.
2. Click **New Project**, name it (e.g. `khata-sathi`), choose your region, and set a database password.
3. Once the project is ready, go to **Project Settings → Database**.
4. Under **Connection string**, select **URI** and choose **Transaction Pooler (Port 6543)** (ideal for serverless Vercel).
5. Copy this URL (replace `[YOUR-PASSWORD]` with your database password). This is your `DATABASE_URL`.

---

### Step 2: Configure Google Sign-In & Supabase Auth

#### A. Google Cloud Console (OAuth Credentials)
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Navigate to **APIs & Services → OAuth consent screen**:
   - User Type: **External**
   - App Name: `Khata Sathi`
   - User Support Email: Your email
   - Developer Contact Info: Your email
   - Save and continue through Scopes (default `email`, `profile`, `openid` are sufficient).
4. Navigate to **APIs & Services → Credentials**:
   - Click **Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Name: `Khata Sathi Web Client`.
   - **Authorized redirect URIs**: Add your Supabase callback URL:
     `https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback`
     *(Find your Project Reference ID under Supabase Project Settings → General)*.
   - Click **Create**.
   - Copy the **Client ID** and **Client Secret**.

#### B. Enable Google in Supabase
1. In your Supabase dashboard, go to **Authentication → Providers**.
2. Click **Google**, toggle it **Enabled**.
3. Paste the **Client ID** and **Client Secret** obtained from Google Cloud Console.
4. Under **Authentication → URL Configuration**:
   - **Site URL**: Your production domain or Vercel URL (e.g. `https://your-app.vercel.app`).
   - **Redirect URLs**: Add `https://your-app.vercel.app` and `http://localhost:8000` (for local dev).
5. Go to **Project Settings → API**:
   - Copy the **Project URL** (`SUPABASE_URL`).
   - Copy the **anon public key** (`SUPABASE_ANON_KEY`).

---

### Step 3: Deploy to Vercel

1. Push your code to GitHub / GitLab / Bitbucket.
2. Go to [Vercel](https://vercel.com) and click **Add New → Project**.
3. Import your Khata Sathi repository.
4. Under **Environment Variables**, add the following:
   - `DATABASE_URL`: `postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:6543/postgres?sslmode=require`
   - `SESSION_SECRET`: A secure random 32+ character string (e.g. `openssl rand -hex 32`)
   - `SUPABASE_URL`: `https://[REF].supabase.co`
   - `SUPABASE_ANON_KEY`: Your Supabase anon public key
5. Click **Deploy**.

---

### Step 4: (Optional) Connect Your Custom Domain
In Vercel Dashboard → **Settings → Domains**, enter your custom domain (e.g., `khata.yourshop.com`) and configure the DNS CNAME/A records as guided by Vercel.

**Your laptop can now be turned off completely.** The application runs 24/7 in the cloud.

---

## Multi-Tenant Security & Privacy

Every single database record (customers, bills, payments, cash drawer entries, settings) is tied to a unique `user_id`. When any user logs in (via Email or Google OAuth):
- The server extracts and cryptographically verifies their Supabase JWT / session token.
- All database queries strictly enforce `WHERE user_id = %s`.
- Account A cannot access, view, modify, or export any data belonging to Account B.

---

## Free-Tier Limits & Transparency

| Provider | Free Tier Limits | Credit Card Required? | What happens when limit is reached? |
| :--- | :--- | :--- | :--- |
| **Vercel** | 100 GB bandwidth/month, Serverless Functions, Free Custom SSL | **No** | Soft notification |
| **Supabase** | 500 MB PostgreSQL DB, 50,000 Monthly Active Users, 1 GB Storage | **No** | Warning notification |
| **Neon** | 0.5 GB PostgreSQL DB, autoscaling scale-to-zero | **No** | Compute scales down when idle |

---

## Features

- **Google OAuth & Email Auth**: One-click Google sign-in and secure email/password registration with password recovery.
- **Strict Multi-Tenant Isolation**: Total data separation across business accounts.
- **Stateless Serverless Execution**: Zero local disk dependencies; safe for Vercel's read-only serverless filesystem.
- **Itemized Billing & FIFO Ledgers**: Automatically tracks line items, partial payments, and debit/credit balances.
- **Cash Drawer (Galla)**: Opening and closing cash flow tracking linked to transactions.
- **PDF & Excel Exports**: Direct cloud generation of customer statements, bills, and drawer reports.

