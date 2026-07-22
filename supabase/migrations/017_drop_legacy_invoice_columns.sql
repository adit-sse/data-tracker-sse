-- Drop invoice columns from actual_invoices
ALTER TABLE actual_invoices
  DROP COLUMN IF EXISTS consumption,
  DROP COLUMN IF EXISTS amount,
  DROP COLUMN IF EXISTS invoice_number,
  DROP COLUMN IF EXISTS invoice_date,
  DROP COLUMN IF EXISTS framework,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS input_type,
  DROP COLUMN IF EXISTS customer,
  DROP COLUMN IF EXISTS emissions_factor;

-- Drop invoice columns from non_metered_records
ALTER TABLE non_metered_records
  DROP COLUMN IF EXISTS consumption,
  DROP COLUMN IF EXISTS unit,
  DROP COLUMN IF EXISTS amount,
  DROP COLUMN IF EXISTS sub_category,
  DROP COLUMN IF EXISTS input_type,
  DROP COLUMN IF EXISTS framework,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS customer,
  DROP COLUMN IF EXISTS invoice_number,
  DROP COLUMN IF EXISTS invoice_date;
