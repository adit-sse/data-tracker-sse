# Invoice Tracking System

A Next.js application for tracking utility invoices (electricity, gas, fuel, oil) across multiple clients and facilities. Features include coverage visualization with progress bars, CSV/XLSX import, and comprehensive dashboard views.

## Features

- ✅ Multi-client invoice tracking
- ✅ Facility and meter management
- ✅ CSV/XLSX bulk import
- ✅ 12-month coverage dashboard with progress bars
- ✅ Color-coded coverage indicators (Green=100%, Yellow=85-99%, Orange=50-84%, Red=1-49%, Grey=0%)
- ✅ Fiscal year support (July-June)
- ✅ Gap detection and tooltips
- ✅ Responsive design

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS
- **Backend**: Supabase (PostgreSQL)
- **File Parsing**: Papa Parse (CSV), XLSX
- **Date Handling**: date-fns

## Prerequisites

- Node.js 18+ 
- Supabase account and project
- npm or yarn

## Setup Instructions

### 1. Clone and Install

```bash
cd invoice-tracker
npm install
```

### 2. Configure Supabase

Create a Supabase project at https://supabase.com

#### Create Database Tables

Run the following SQL in your Supabase SQL Editor:

```sql
-- Clients table
CREATE TABLE clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Facilities table
CREATE TABLE facilities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Utility categories table
CREATE TABLE utility_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Insert utility categories
INSERT INTO utility_categories (name) VALUES 
  ('ELECTRICITY'),
  ('GAS'),
  ('FUEL'),
  ('OIL');

-- Suppliers table
CREATE TABLE suppliers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Meters table
CREATE TABLE meters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  facility_id UUID REFERENCES facilities(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id),
  utility_category_id UUID REFERENCES utility_categories(id),
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('NMI', 'ACCOUNT_NUMBER', 'METER_NUMBER', 'REGISTRATION_PLATE', 'CARD_NUMBER', 'FACILITY_LEVEL')),
  lookup1 TEXT NOT NULL,
  lookup2 TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Actual invoices table
CREATE TABLE actual_invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meter_id UUID REFERENCES meters(id) ON DELETE CASCADE,
  invoice_number TEXT,
  invoice_date TEXT,
  period_start_date DATE NOT NULL,
  period_end_date DATE NOT NULL,
  consumption NUMERIC,
  amount NUMERIC,
  framework TEXT,
  version TEXT,
  input_type TEXT,
  emissions_factor NUMERIC,
  customer TEXT,
  status TEXT DEFAULT 'IMPORTED',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_facilities_client ON facilities(client_id);
CREATE INDEX idx_meters_facility ON meters(facility_id);
CREATE INDEX idx_invoices_meter ON actual_invoices(meter_id);
CREATE INDEX idx_invoices_period ON actual_invoices(period_start_date, period_end_date);
```

#### Optional: Create Storage Bucket for Client Logos

1. Go to Storage in Supabase Dashboard
2. Create a new bucket named `client-logos`
3. Set to Public
4. Set file size limit to 5MB
5. Allow image types: image/png, image/jpeg, image/svg+xml

### 3. Environment Variables

Create `.env.local` file in the root directory:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and add your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run Development Server

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## Usage

### 1. Create a Client

1. Click "Add Client" on the home page
2. Enter client name
3. Click "Create"

### 2. Add Facilities

1. Navigate to the client detail page
2. Click "Add Facility"
3. Enter facility name and optional address
4. Click "Create Facility"

### 3. Upload Invoices

1. Navigate to the client detail page
2. Click "Upload Invoices"
3. Upload a CSV or XLSX file with the following columns:

**Required Columns:**
- `Company` - Client name
- `Facility` - Facility name
- `Category` - ELECTRICITY, GAS, FUEL, or OIL
- `Provider` - Supplier name
- `Date Range` - Format: DD/MM/YYYY-DD/MM/YYYY (e.g., "01/12/2025-31/12/2025")

**Meter Identifier (at least one required):**
- `NMI` - National Meter Identifier (for electricity)
- `Account Number` - Account number (for gas)
- `Meter Number` - Meter number

**Optional Columns:**
- `Invoice Number`
- `Invoice Date`
- `Amount($)`
- `Consumption`
- `Input Type`
- `Framework`
- `Version`
- `Customer`
- `Output (tCO2-e)`
- `Supply Address`

### 4. View Coverage Dashboard

The client detail page shows:
- List of facilities with meter counts
- 12-month coverage table (July-June fiscal year)
- Progress bars showing coverage percentage
- Color-coded indicators
- Hover tooltips showing gap details

## CSV Import Example

See `sample-invoices.csv` for an example file format.

## Project Structure

```
invoice-tracker/
├── app/
│   ├── api/
│   │   └── clients/
│   │       ├── route.ts              # List/create clients
│   │       └── [id]/
│   │           ├── route.ts          # Get/update client
│   │           ├── facilities/
│   │           │   └── route.ts      # List/create facilities
│   │           ├── coverage/
│   │           │   └── route.ts      # Get coverage data
│   │           └── upload/
│   │               └── route.ts      # Process CSV upload
│   ├── clients/
│   │   └── [id]/
│   │       ├── page.tsx              # Client detail page
│   │       ├── facilities/
│   │       │   └── new/
│   │       │       └── page.tsx      # Add facility page
│   │       └── upload/
│   │           └── page.tsx          # Upload invoices page
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # Home page
│   └── globals.css                   # Global styles
├── components/
│   ├── ClientCard.tsx                # Client card component
│   ├── CoverageTable.tsx             # Coverage dashboard table
│   ├── FacilityForm.tsx              # Add facility form
│   ├── FileUpload.tsx                # File upload component
│   └── ProgressBarCell.tsx           # Progress bar cell
├── lib/
│   ├── coverage.ts                   # Coverage calculation utilities
│   └── supabase.ts                   # Supabase client
├── types/
│   └── index.ts                      # TypeScript type definitions
└── package.json
```

## Coverage Calculation

The system calculates coverage by:
1. For each meter, gather all invoices
2. For each month in the fiscal year:
   - Extract all days covered by invoice periods
   - Count unique covered days
   - Calculate percentage: (covered days / total days in month) × 100
3. Color-code based on percentage thresholds

## Troubleshooting

### CSV Import Errors

- **"Missing required fields"**: Ensure Company, Facility, Category, Provider, and Date Range columns exist
- **"Invalid date range format"**: Use DD/MM/YYYY-DD/MM/YYYY format
- **"Invalid category"**: Category must be ELECTRICITY, GAS, FUEL, or OIL (case-insensitive)
- **"No meter identifier found"**: Include at least one of: NMI, Account Number, or Meter Number

### Database Connection Issues

- Verify `.env.local` has correct Supabase URL and key
- Check Supabase project is active
- Verify tables are created in Supabase SQL Editor

## Future Enhancements

- Logo upload functionality
- Invoice PDF export
- Email notifications for missing coverage
- Date range selector for custom fiscal years
- Invoice status workflow
- Advanced filtering and search
- Dark mode

## License

MIT

## Support

For issues or questions, please create an issue in the repository.
