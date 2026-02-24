-- Invoice Tracking System - Database Schema
-- Run this in your Supabase SQL Editor

-- 1. Create clients table
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Create facilities table
CREATE TABLE IF NOT EXISTS facilities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Create utility categories table
CREATE TABLE IF NOT EXISTS utility_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Insert utility categories
INSERT INTO utility_categories (name) VALUES 
  ('ELECTRICITY'),
  ('GAS'),
  ('FUEL'),
  ('OIL')
ON CONFLICT (name) DO NOTHING;

-- 4. Create suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Create meters table
CREATE TABLE IF NOT EXISTS meters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  facility_id UUID REFERENCES facilities(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id),
  utility_category_id UUID REFERENCES utility_categories(id),
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('NMI', 'ACCOUNT_NUMBER', 'METER_NUMBER', 'REGISTRATION_PLATE', 'CARD_NUMBER', 'FACILITY_LEVEL', 'DESCRIPTION')),
  lookup1 TEXT NOT NULL,
  lookup2 TEXT,
  in_service_start_date DATE,
  in_service_end_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (facility_id, utility_category_id, identifier_type, lookup1)
);

-- 6. Create actual invoices table
CREATE TABLE IF NOT EXISTS actual_invoices (
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

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_facilities_client ON facilities(client_id);
CREATE INDEX IF NOT EXISTS idx_meters_facility ON meters(facility_id);
CREATE INDEX IF NOT EXISTS idx_meters_supplier ON meters(supplier_id);
CREATE INDEX IF NOT EXISTS idx_meters_category ON meters(utility_category_id);
CREATE INDEX IF NOT EXISTS idx_invoices_meter ON actual_invoices(meter_id);
CREATE INDEX IF NOT EXISTS idx_invoices_period ON actual_invoices(period_start_date, period_end_date);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON actual_invoices(invoice_number) WHERE invoice_number IS NOT NULL;

-- Add comments for documentation
COMMENT ON TABLE clients IS 'Stores client/company information';
COMMENT ON TABLE facilities IS 'Stores facility locations for each client';
COMMENT ON TABLE utility_categories IS 'Lookup table for utility types (ELECTRICITY, GAS, FUEL, OIL)';
COMMENT ON TABLE suppliers IS 'Stores utility provider/supplier information';
COMMENT ON TABLE meters IS 'Stores meter/account information with flexible identifier types';
COMMENT ON TABLE actual_invoices IS 'Stores invoice records with period coverage dates';

COMMENT ON COLUMN meters.identifier_type IS 'Type of meter identifier: NMI, ACCOUNT_NUMBER, METER_NUMBER, REGISTRATION_PLATE, CARD_NUMBER, FACILITY_LEVEL, DESCRIPTION';
COMMENT ON COLUMN meters.lookup1 IS 'Primary identifier (e.g., NMI number, account number, meter number)';
COMMENT ON COLUMN meters.lookup2 IS 'Secondary identifier (e.g., "WA - SWIS" for electricity region, "LPG" for gas type)';
COMMENT ON COLUMN meters.in_service_start_date IS 'Date when meter came into service (null = always in service from beginning)';
COMMENT ON COLUMN meters.in_service_end_date IS 'Date when meter went out of service (null = still in service)';
COMMENT ON COLUMN actual_invoices.period_start_date IS 'Start date of invoice coverage period';
COMMENT ON COLUMN actual_invoices.period_end_date IS 'End date of invoice coverage period (inclusive)';

-- Optional: Insert sample data for testing
-- Uncomment the following lines to add test data

/*
-- Sample Client 1
INSERT INTO clients (name) VALUES ('Camco Engineering') RETURNING id;
-- Note the returned ID and replace <client_id_1> below

-- Sample Client 2
INSERT INTO clients (name) VALUES ('CBH Group') RETURNING id;
-- Note the returned ID and replace <client_id_2> below

-- Sample Facilities
INSERT INTO facilities (client_id, name, address) VALUES
  ('<client_id_1>', 'Perth Office', '123 Main Street, Perth WA 6000'),
  ('<client_id_1>', 'Warehouse', '456 Industrial Ave, Perth WA 6105'),
  ('<client_id_2>', 'Head Office', '789 Farm Road, Perth WA 6000');

-- Sample Suppliers
INSERT INTO suppliers (name) VALUES
  ('Synergy'),
  ('Alinta Energy'),
  ('Horizon Power'),
  ('BP'),
  ('Kleenheat');
*/

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Database schema created successfully!';
  RAISE NOTICE 'You can now run the Next.js application and start importing invoices.';
END $$;
