-- Preserve mapped header context even when its value also appears in a row.
BEGIN;
CREATE OR REPLACE FUNCTION core.reporter_memory_market_binding_context(p_evidence jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(jsonb_object_agg(f.key,f.value->'value'),'{}'::jsonb)
  FROM jsonb_each(coalesce(p_evidence->'market'->'fields','{}'::jsonb)) f
  WHERE f.value->>'record'='1' AND p_evidence->'market'->'mapping'->f.key->>'record'='header'
    AND nullif(f.value->>'value','') IS NOT NULL
    AND f.value->>'value'=CASE f.key WHEN 'indicator' THEN p_evidence->>'indicator' WHEN 'value' THEN p_evidence->'value'->>'raw'
      WHEN 'unit' THEN p_evidence->>'unit' WHEN 'period' THEN p_evidence->'period'->>'label' WHEN 'geography' THEN p_evidence->>'geography'
      WHEN 'population' THEN p_evidence->>'population' WHEN 'qualifier' THEN p_evidence->>'qualifier' WHEN 'institution' THEN p_evidence->>'issuingInstitution' END
$$;
ALTER FUNCTION core.reporter_memory_market_binding_context(jsonb) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_market_binding_context(jsonb) FROM PUBLIC;
COMMIT;
