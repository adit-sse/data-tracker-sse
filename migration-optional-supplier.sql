-- Migration: Make supplier_id optional in meters table
-- Run this in Supabase SQL Editor

-- Allow NULL for supplier_id
ALTER TABLE meters ALTER COLUMN supplier_id DROP NOT NULL;

-- Verify the change
SELECT column_name, is_nullable, data_type 
FROM information_schema.columns 
WHERE table_name = 'meters' 
AND column_name = 'supplier_id';

-- Should show: is_nullable = 'YES'
