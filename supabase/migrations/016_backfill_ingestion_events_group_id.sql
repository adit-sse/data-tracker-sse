-- Backfill group_id on existing ingestion_events rows by matching
-- (client_id, supplier_name, utility_name) against facility_groups.
UPDATE ingestion_events ie
SET group_id = fg.id
FROM facility_groups fg
JOIN suppliers s   ON s.id   = fg.supplier_id
JOIN categories cat ON cat.id = fg.category_id
WHERE ie.group_id IS NULL
  AND ie.client_id    = fg.client_id
  AND ie.supplier_name ILIKE s.name
  AND ie.utility_name  ILIKE cat.name;
