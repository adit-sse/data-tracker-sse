-- Add MIRN identifier type to meters table
-- Run this in your Supabase SQL Editor

ALTER TABLE meters DROP CONSTRAINT IF EXISTS meters_identifier_type_check;
ALTER TABLE meters ADD CONSTRAINT meters_identifier_type_check
  CHECK (identifier_type IN ('NMI', 'MIRN', 'ACCOUNT_NUMBER', 'METER_NUMBER', 'REGISTRATION_PLATE', 'CARD_NUMBER', 'FACILITY_LEVEL', 'DESCRIPTION'));
