CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION get_client_by_name(input_name TEXT)
RETURNS TABLE(id INTEGER, name TEXT) AS $$
BEGIN
  RETURN QUERY
    SELECT c.id, c.name::TEXT FROM clients c WHERE c.name ILIKE input_name LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT c.id, c.name::TEXT FROM clients c
      WHERE similarity(c.name, input_name) > 0.4
      ORDER BY similarity(c.name, input_name) DESC
      LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;
