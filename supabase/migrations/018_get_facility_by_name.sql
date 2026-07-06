CREATE OR REPLACE FUNCTION get_facility_by_name(input_name TEXT, input_client_id INTEGER)
RETURNS TABLE(id INTEGER, name TEXT) AS $$
BEGIN
  RETURN QUERY
    SELECT f.id, f.name::TEXT FROM facilities f
    WHERE f.client_id = input_client_id AND f.name ILIKE input_name LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT f.id, f.name::TEXT FROM facilities f
      WHERE f.client_id = input_client_id
        AND similarity(f.name, input_name) > 0.4
      ORDER BY similarity(f.name, input_name) DESC
      LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;
