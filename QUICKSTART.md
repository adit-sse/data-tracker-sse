# Quick Start Guide

Get the Invoice Tracker running in 5 minutes!

## Prerequisites

- Node.js 18+ installed
- Supabase account (free tier works)

## Step 1: Install Dependencies

```bash
cd invoice-tracker
npm install
```

## Step 2: Set Up Supabase

1. Go to https://supabase.com and create a new project
2. Wait for the database to initialize (~2 minutes)
3. Go to **SQL Editor** in the Supabase dashboard
4. Copy and paste the contents of `supabase-init.sql`
5. Click **Run** to create all tables

## Step 3: Configure Environment

1. Copy the example env file:
   ```bash
   cp .env.local.example .env.local
   ```

2. In Supabase dashboard, go to **Settings** → **API**
3. Copy your **Project URL** and **anon public key**
4. Update `.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

## Step 4: Run the App

```bash
npm run dev
```

Open http://localhost:3000 🎉

## Step 5: Try It Out

1. **Add a Client**: Click "Add Client" and enter "Test Company"
2. **Add a Facility**: Click on the client → "Add Facility" → Enter "Main Office"
3. **Upload Sample Data**: Click "Upload Invoices" → Select `sample-invoices.csv`
4. **View Coverage**: See the 12-month coverage dashboard with progress bars!

## Troubleshooting

**"Failed to fetch"**: Check `.env.local` has correct Supabase credentials

**"Database error"**: Make sure `supabase-init.sql` ran successfully

**CSV import errors**: Check the CSV format matches `sample-invoices.csv`

## Next Steps

- Upload your own invoice data
- Add more clients and facilities
- Explore the coverage dashboard
- Filter by utility type

Need help? Check the full [README.md](README.md)
