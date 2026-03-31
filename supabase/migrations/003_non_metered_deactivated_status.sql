-- Allow DEACTIVATED status on non_metered_records (template: months not supplied via API).
ALTER TABLE public.non_metered_records
  DROP CONSTRAINT IF EXISTS non_metered_records_status_check;

ALTER TABLE public.non_metered_records
  ADD CONSTRAINT non_metered_records_status_check
  CHECK (
    status IN (
      'IMPORTED',
      'INFERRED_EMPTY',
      'MANUAL',
      'PENDING',
      'ERROR',
      'CONFIRMED',
      'DEACTIVATED'
    )
  );
