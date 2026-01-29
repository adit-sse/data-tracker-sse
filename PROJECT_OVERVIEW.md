# Invoice Tracking System - Project Overview

## What This Application Does

This is a complete Next.js application for tracking utility invoices across multiple clients and facilities. It calculates and visualizes coverage completeness using color-coded progress bars, showing how many days each month are covered by invoices.

### Key Features

1. **Multi-Client Management**
   - Create and manage multiple clients
   - Each client can have multiple facilities
   - Track coverage across all meters

2. **Coverage Dashboard**
   - Visual 12-month coverage view (fiscal year: July-June)
   - Color-coded progress bars:
     - 🟢 Green (100% coverage)
     - 🟡 Yellow (85-99% coverage)
     - 🟠 Orange (50-84% coverage)
     - 🔴 Red (1-49% coverage)
     - ⚪ Grey (0% coverage)
   - Hover tooltips showing coverage gaps
   - Filter by utility type

3. **CSV/XLSX Import**
   - Bulk import invoice data
   - Automatic facility and meter creation
   - Flexible meter identification (NMI, account numbers, meter numbers)
   - Duplicate detection
   - Error reporting with row numbers

4. **Coverage Calculation**
   - Day-by-day coverage tracking
   - Handles overlapping invoices
   - Identifies gaps in coverage
   - Per-meter monthly calculations

## Technology Stack

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS
- **Backend**: Supabase (PostgreSQL)
- **File Parsing**: Papa Parse (CSV), XLSX
- **Date Handling**: date-fns
- **Deployment**: Vercel-ready

## Project Structure

```
invoice-tracker/
├── app/                           # Next.js App Router
│   ├── api/                       # API Routes
│   │   └── clients/
│   │       ├── route.ts           # GET/POST clients
│   │       └── [id]/
│   │           ├── route.ts       # GET/PUT client
│   │           ├── facilities/    # Facility operations
│   │           ├── coverage/      # Coverage data
│   │           └── upload/        # CSV import
│   ├── clients/[id]/              # Client pages
│   │   ├── page.tsx               # Client dashboard
│   │   ├── facilities/new/        # Add facility
│   │   └── upload/                # Upload invoices
│   ├── layout.tsx                 # Root layout
│   ├── page.tsx                   # Home page
│   └── globals.css                # Global styles
│
├── components/                    # React Components
│   ├── ClientCard.tsx             # Client list card
│   ├── CoverageTable.tsx          # 12-month coverage table
│   ├── FacilityForm.tsx           # Add facility form
│   ├── FileUpload.tsx             # Drag & drop upload
│   └── ProgressBarCell.tsx        # Coverage progress bar
│
├── lib/                           # Utility Functions
│   ├── coverage.ts                # Coverage calculations
│   └── supabase.ts                # Database client
│
├── types/                         # TypeScript Types
│   └── index.ts                   # Type definitions
│
├── sample-invoices.csv            # Sample data
├── supabase-init.sql             # Database schema
├── QUICKSTART.md                  # 5-minute setup
└── README.md                      # Full documentation
```

## Database Schema

### Tables

1. **clients** - Client/company information
2. **facilities** - Facility locations per client
3. **utility_categories** - Lookup (ELECTRICITY, GAS, FUEL, OIL)
4. **suppliers** - Utility providers
5. **meters** - Meter/account identifiers
6. **actual_invoices** - Invoice records with coverage periods

### Key Design Decisions

- **Flexible meter identification**: Supports NMI (electricity), account numbers (gas), meter numbers, and more
- **Date-based coverage**: Uses `period_start_date` and `period_end_date` for accurate day-by-day tracking
- **Normalized data**: Prevents duplicate facilities and suppliers
- **UUID primary keys**: Supabase-friendly, globally unique

## How Coverage Works

### Coverage Calculation Flow

1. **Gather invoices** for a meter
2. **For each month** in the fiscal year:
   - Extract invoice period dates
   - Track all unique days covered
   - Calculate: (covered days / total days in month) × 100
3. **Detect gaps** between covered periods
4. **Color-code** based on percentage thresholds
5. **Display** in progress bar with tooltip

### Example

Invoice covers: Dec 1-20, 2024 (20 days)
Invoice covers: Dec 22-31, 2024 (10 days)

Result: 30/31 days covered (96.8%) → Yellow
Gap: Dec 21 (1 day) → Shown in tooltip

## CSV Import Process

### Import Flow

1. **Parse CSV** → Extract rows with Papa Parse
2. **For each row**:
   - Find or create client (by company name)
   - Find or create facility (by facility name + client)
   - Find or create supplier (by provider name)
   - Determine meter identifier type (NMI > Account > Meter)
   - Find or create meter (by facility + identifier)
   - Parse date range (DD/MM/YYYY-DD/MM/YYYY)
   - Insert invoice record
3. **Return results** → Count of imported, list of errors

### Duplicate Handling

- Meters: Unique by (facility, category, identifier_type, lookup1)
- Invoices: Optional duplicate check by invoice_number
- Facilities/Suppliers: Matched by name (case-sensitive)

## API Endpoints

### Client Operations
- `GET /api/clients` - List all with current month coverage
- `POST /api/clients` - Create new client
- `GET /api/clients/[id]` - Get client details
- `PUT /api/clients/[id]` - Update client

### Facility Operations
- `GET /api/clients/[id]/facilities` - List facilities
- `POST /api/clients/[id]/facilities` - Create facility

### Coverage & Upload
- `GET /api/clients/[id]/coverage?fiscalYear=2025` - Get 12-month data
- `POST /api/clients/[id]/upload` - Process CSV/XLSX

## Page Routes

- `/` - Home (client list with current month coverage)
- `/clients/[id]` - Client dashboard (facilities + 12-month coverage)
- `/clients/[id]/facilities/new` - Add facility form
- `/clients/[id]/upload` - CSV/XLSX upload interface

## Component Breakdown

### ClientCard
Displays on home page with:
- Client name and logo
- Number of facilities
- Current month coverage percentage
- Progress bar

### CoverageTable
Main dashboard feature:
- 12 columns (Jul-Jun)
- Rows per meter (facility | supplier | utility | meter ID)
- Progress bar cells with coverage percentage
- Filter by utility type
- Color-coded indicators
- Hover tooltips for gaps

### ProgressBarCell
Individual coverage cell:
- Responsive width based on percentage
- Shows "X/Y days" label
- Color changes based on thresholds
- Tooltip with gap details

### FileUpload
Drag & drop interface:
- Visual feedback on drag
- File type validation
- Processing state
- Upload button

## Development Workflow

### Adding New Features

1. **Add types** in `types/index.ts`
2. **Create API route** in `app/api/`
3. **Build component** in `components/`
4. **Add page** in `app/`
5. **Test** with sample data

### Common Modifications

- **Add utility type**: Insert into `utility_categories` table
- **Change fiscal year**: Modify `generateFiscalYearMonths()` in `lib/coverage.ts`
- **Adjust colors**: Update `tailwind.config.js` and `getCoverageColorClass()`
- **New identifier type**: Add to `IdentifierType` in types and meter table constraint

## Testing

### With Sample Data

1. Create two clients: "Camco Engineering", "CBH Group"
2. Upload `sample-invoices.csv`
3. Verify:
   - Facilities auto-created
   - Meters linked correctly
   - Coverage shows correctly
   - Progress bars display
   - Tooltips work on hover

### Manual Testing

1. Create client manually
2. Add facility with address
3. Upload CSV with mix of:
   - Complete months (31/31)
   - Partial months (20/31)
   - Missing months (0/31)
4. Check color coding
5. Verify gap tooltips

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import to Vercel
3. Add environment variables
4. Deploy

### Environment Variables

Required in production:
```
NEXT_PUBLIC_SUPABASE_URL=your-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-key
```

## Performance Considerations

- Indexes on foreign keys and date ranges
- API routes fetch only needed data
- Coverage calculated client-side to reduce DB load
- React hooks for efficient re-renders
- Tailwind for minimal CSS bundle

## Future Enhancements

### Phase 2 Features
- Logo upload to Supabase Storage
- Invoice PDF export
- Email alerts for coverage gaps
- Advanced filtering (date ranges, suppliers)
- Invoice edit/delete UI
- Audit trail
- User authentication

### Phase 3 Features
- Multi-year comparison
- Budget vs actual tracking
- Emissions reporting
- API webhooks
- Mobile app
- Dark mode

## Support

For issues:
1. Check Supabase connection
2. Verify CSV format
3. Check browser console
4. Review API responses
5. Check database constraints

## License

MIT - Free to use and modify

---

**Ready to deploy!** All core features are implemented and tested.
