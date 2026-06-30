CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION get_supplier_by_name(input_name TEXT)
RETURNS TABLE(id INTEGER, name TEXT) AS $$
BEGIN
  RETURN QUERY
    SELECT s.id, s.name::TEXT FROM suppliers s WHERE s.name ILIKE input_name LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT s.id, s.name::TEXT FROM suppliers s
      WHERE similarity(s.name, input_name) > 0.4
      ORDER BY similarity(s.name, input_name) DESC
      LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;
