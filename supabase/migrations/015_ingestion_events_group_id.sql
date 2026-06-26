-- Add group_id to ingestion_events so that error log entries originating from the
-- same facility group can be collapsed into a single card in the UI.
ALTER TABLE ingestion_events
  ADD COLUMN group_id int4 REFERENCES facility_groups(id) ON DELETE SET NULL;

CREATE INDEX ingestion_events_group_id_idx ON ingestion_events(group_id)
  WHERE group_id IS NOT NULL;
