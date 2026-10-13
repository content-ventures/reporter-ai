-- Narrow commands. Execute after reporter-r1.sql; no API or AI provider is started here.
BEGIN;

-- Retain these receipts for the agreed HTTP retry horizon. Do not purge completed
-- transport rows before then. No additional idempotency/workflow table.
CREATE UNIQUE INDEX uq_reporter_command_receipt ON core.integration_outbox(
  portal_id,(payload->'command'->>'actor_id'),(payload->'command'->>'operation'),
  (payload->'command'->>'key')) WHERE module='reporter_ai' AND payload ? 'command';

CREATE FUNCTION core.reporter_require(permission text) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.context_portal_id();
BEGIN
  IF NOT core.reporter_allowed(portal,permission) THEN
    RAISE EXCEPTION 'Reporter action denied' USING ERRCODE='42501';
  END IF;
  RETURN portal;
END $$;

CREATE FUNCTION core.reporter_audit(p_portal uuid,p_action text,p_entity text,p_id uuid,p_data jsonb)
RETURNS void LANGUAGE sql SET search_path=pg_catalog,core,public,pg_temp AS $$
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,entity_id,after_data,source,request_id,correlation_id)
  VALUES(p_portal,CASE WHEN current_setting('app.access_mode',true)='user' THEN core.context_user_id() END,
    p_action,p_entity,p_id,p_data,'reporter_ai',
    nullif(current_setting('app.request_id',true),'')::uuid,
    nullif(current_setting('app.correlation_id',true),'')::uuid)
$$;

CREATE FUNCTION core.reporter_outcome(p_portal uuid,p_action text,p_entity text,p_id uuid,p_data jsonb)
RETURNS void LANGUAGE sql SET search_path=pg_catalog,core,public,pg_temp AS $$
  INSERT INTO public.event_outbox(portal_id,event_type,entity_type,entity_id,payload)
    VALUES(p_portal,p_action,p_entity,p_id,p_data)
$$;

CREATE FUNCTION core.reporter_source(p_portal uuid,p_object uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  -- Local proposed safety limits; product limits and signature checks remain an integration gate.
  PERFORM 1 FROM core.storage_objects WHERE id=p_object AND portal_id=p_portal
    AND tenant_id=core.context_tenant_id() AND status='completed'
    AND owner_user_id=core.context_user_id() AND purpose='reporter-source'
    AND size BETWEEN 1 AND 104857600
    AND content_type IN ('audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg',
      'audio/webm','video/mp4','video/webm')
    AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source unavailable, unauthorized or outside limits' USING ERRCODE='23514'; END IF;
END $$;

CREATE FUNCTION public.reporter_create(p_kind text,p_source uuid,p_input_revision integer,p_key text,p_parameters jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); actor uuid := core.context_user_id();
  receipt core.integration_outbox; inputs jsonb; aggregate uuid := gen_random_uuid();
  generation uuid := gen_random_uuid(); event uuid := gen_random_uuid(); event_type text; language text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('transcript','article','carousel') OR p_source IS NULL
    OR p_input_revision IS NULL OR p_input_revision<1 OR p_key IS NULL OR btrim(p_key)=''
    OR length(p_key)>128 OR p_parameters IS NULL OR jsonb_typeof(p_parameters)<>'object'
    OR octet_length(p_parameters::text)>4096 THEN RAISE EXCEPTION 'Invalid creation parameters' USING ERRCODE='22023'; END IF;
  IF (p_kind='transcript' AND (p_input_revision<>1 OR p_parameters-ARRAY['language']<>'{}'))
    OR (p_kind<>'transcript' AND p_parameters<>'{}')
    OR (p_parameters ? 'language' AND jsonb_typeof(p_parameters->'language')<>'string')
    THEN RAISE EXCEPTION 'Unsupported parameters/intake' USING ERRCODE='22023'; END IF;
  language := coalesce(p_parameters->>'language','pt-BR');
  inputs := jsonb_build_object('source_id',p_source,'input_revision',p_input_revision,'parameters',p_parameters);
  PERFORM pg_advisory_xact_lock(hashtextextended(portal::text||actor::text||'create.'||p_kind||p_key,0));
  SELECT * INTO receipt FROM core.integration_outbox WHERE module='reporter_ai' AND portal_id=portal
    AND payload->'command'->>'actor_id'=actor::text
    AND payload->'command'->>'operation'='create.'||p_kind AND payload->'command'->>'key'=p_key;
  IF FOUND THEN
    IF receipt.payload->'command'->'inputs' IS DISTINCT FROM inputs THEN
      RAISE EXCEPTION 'Idempotency key reused with different inputs' USING ERRCODE='22023';
    END IF;
    RETURN receipt.aggregate_id::uuid;
  END IF;
  IF p_kind='transcript' THEN
    PERFORM core.reporter_source(portal,p_source);
    INSERT INTO public.reporter_transcripts(id,portal_id,source_object_id,created_by,language,generation_id)
      VALUES(aggregate,portal,p_source,actor,language,generation);
    event_type := 'reporter.transcription.requested';
  ELSIF p_kind='article' THEN
    PERFORM 1 FROM public.reporter_transcripts WHERE portal_id=portal AND id=p_source
      AND status='ready' AND revision=p_input_revision FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ready transcript revision required' USING ERRCODE='40001'; END IF;
    INSERT INTO public.reporter_articles(id,portal_id,transcript_id,author_id,generation_id)
      VALUES(aggregate,portal,p_source,actor,generation);
    event_type := 'reporter.article_generation.requested';
  ELSE
    PERFORM 1 FROM public.reporter_articles WHERE portal_id=portal AND id=p_source
      AND status='approved' AND approved_revision=p_input_revision FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Exact approved article revision required' USING ERRCODE='40001'; END IF;
    INSERT INTO public.reporter_carousels(id,portal_id,article_id,article_revision,created_by,generation_id)
      VALUES(aggregate,portal,p_source,p_input_revision,actor,generation);
    event_type := 'reporter.carousel_generation.requested';
  END IF;
  INSERT INTO core.integration_outbox(id,tenant_id,portal_id,module,event_type,aggregate_id,payload)
  VALUES(event,core.context_tenant_id(),portal,'reporter_ai',event_type,aggregate::text,
    jsonb_build_object('schema_version',1,'event_id',event,'tenant_id',core.context_tenant_id(),
      'portal_id',portal,'module','reporter_ai','entity_type',p_kind,'entity_id',aggregate,
      'generation_id',generation,'expected_revision',1,'input_revision',p_input_revision,
      'parameters',p_parameters,'request_id',nullif(current_setting('app.request_id',true),''),
      'command',jsonb_build_object('actor_id',actor,'operation','create.'||p_kind,'key',p_key,'inputs',inputs)));
  PERFORM core.reporter_audit(portal,'reporter.'||p_kind||'.requested',p_kind,aggregate,
    jsonb_build_object('revision',1,'generation_id',generation,'event_id',event));
  RETURN aggregate;
END $$;

CREATE FUNCTION public.reporter_edit_article(p_id uuid,p_revision integer,p_title text,p_content text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); result integer;
BEGIN
  UPDATE public.reporter_articles SET title=p_title,content=p_content,status='draft',revision=revision+1,
    approver_id=NULL,review_comment=NULL,submitted_at=NULL
    WHERE id=p_id AND portal_id=portal AND revision=p_revision AND status IN ('draft','changes_requested')
    RETURNING revision INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article revision/state conflict' USING ERRCODE='40001'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.reporter_submit_article(p_id uuid,p_revision integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.submit'); result integer;
BEGIN
  UPDATE public.reporter_articles SET status='in_review',submitted_at=clock_timestamp(),revision=revision+1
    WHERE id=p_id AND portal_id=portal AND revision=p_revision AND status='draft' RETURNING revision INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article revision/state conflict' USING ERRCODE='40001'; END IF;
  PERFORM core.reporter_audit(portal,'reporter.article.submitted','article',p_id,jsonb_build_object('revision',result));
  PERFORM core.reporter_outcome(portal,'reporter.article.submitted','article',p_id,jsonb_build_object('revision',result));
  RETURN result;
END $$;

CREATE FUNCTION public.reporter_review_article(p_id uuid,p_revision integer,p_approve boolean,p_comment text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.review'); article public.reporter_articles; data jsonb; action text;
BEGIN
  IF p_approve IS NULL OR length(p_comment)>4000 OR
    (NOT p_approve AND (p_comment IS NULL OR btrim(p_comment)='')) THEN
    RAISE EXCEPTION 'Valid review decision/comment required' USING ERRCODE='22023';
  END IF;
  UPDATE public.reporter_articles SET status=CASE WHEN p_approve THEN 'approved' ELSE 'changes_requested' END,
    approver_id=core.context_user_id(),approved_revision=CASE WHEN p_approve THEN revision+1 END,
    approved_at=CASE WHEN p_approve THEN clock_timestamp() END,review_comment=p_comment,revision=revision+1
    WHERE id=p_id AND portal_id=portal AND revision=p_revision AND status='in_review' RETURNING * INTO article;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article revision/state conflict' USING ERRCODE='40001'; END IF;
  action := CASE WHEN p_approve THEN 'reporter.article.approved' ELSE 'reporter.article.changes_requested' END;
  data := jsonb_build_object('revision',article.revision,'generation_id',article.generation_id,
    'approver_id',article.approver_id,'approved_at',article.approved_at,'review_comment',p_comment);
  -- Snapshot is editorial audit only, never transport/business-event payload.
  IF p_approve THEN data := data || jsonb_build_object('approved_revision',article.approved_revision,
    'snapshot',jsonb_build_object('title',article.title,'content',article.content,
      'source_kind',article.source_kind,'transcript_id',article.transcript_id,'source_metadata',article.source_metadata));
  END IF;
  PERFORM core.reporter_audit(portal,action,'article',p_id,data);
  PERFORM core.reporter_outcome(portal,action,'article',p_id,data-ARRAY['snapshot','review_comment']);
  RETURN article.revision;
END $$;

CREATE FUNCTION public.reporter_edit_carousel(p_id uuid,p_revision integer,p_title text,p_slides jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); result integer;
BEGIN
  UPDATE public.reporter_carousels SET title=p_title,slides=p_slides,status='draft',ready_at=NULL,
    output_object_id=NULL,output_revision=NULL,revision=revision+1
    WHERE id=p_id AND portal_id=portal AND revision=p_revision AND status IN ('draft','ready') RETURNING revision INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Carousel revision/state conflict' USING ERRCODE='40001'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.reporter_ready_carousel(p_id uuid,p_revision integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); result integer;
BEGIN
  UPDATE public.reporter_carousels SET status='ready',ready_at=clock_timestamp(),revision=revision+1
    WHERE id=p_id AND portal_id=portal AND revision=p_revision AND status='draft' RETURNING revision INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Carousel revision/state conflict' USING ERRCODE='40001'; END IF;
  PERFORM core.reporter_audit(portal,'reporter.carousel.ready','carousel',p_id,jsonb_build_object('revision',result));
  PERFORM core.reporter_outcome(portal,'reporter.carousel.ready','carousel',p_id,jsonb_build_object('revision',result));
  RETURN result;
END $$;

CREATE FUNCTION public.reporter_retry(p_kind text,p_id uuid,p_revision integer,p_key text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.retry'); actor uuid := core.context_user_id();
  receipt core.integration_outbox; prior core.integration_outbox; row_data jsonb; relation regclass;
  generation uuid := gen_random_uuid(); event uuid := gen_random_uuid(); inputs jsonb; next_revision integer;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('transcript','article','carousel') OR p_id IS NULL OR p_revision IS NULL OR p_revision<1
    OR p_key IS NULL OR btrim(p_key)='' OR length(p_key)>128 THEN RAISE EXCEPTION 'Invalid retry' USING ERRCODE='22023'; END IF;
  inputs := jsonb_build_object('entity_id',p_id,'revision',p_revision);
  PERFORM pg_advisory_xact_lock(hashtextextended(portal::text||actor::text||'retry.'||p_kind||p_key,0));
  SELECT * INTO receipt FROM core.integration_outbox WHERE module='reporter_ai' AND portal_id=portal
    AND payload->'command'->>'actor_id'=actor::text AND payload->'command'->>'operation'='retry.'||p_kind
    AND payload->'command'->>'key'=p_key;
  IF FOUND THEN
    IF receipt.payload->'command'->'inputs' IS DISTINCT FROM inputs THEN
      RAISE EXCEPTION 'Idempotency key reused with different inputs' USING ERRCODE='22023';
    END IF;
    RETURN (receipt.payload->>'generation_id')::uuid;
  END IF;
  relation := CASE p_kind WHEN 'transcript' THEN 'public.reporter_transcripts'::regclass
    WHEN 'article' THEN 'public.reporter_articles'::regclass ELSE 'public.reporter_carousels'::regclass END;
  -- Lock ordering matches completion (transport then aggregate).
  SELECT * INTO prior FROM core.integration_outbox WHERE module='reporter_ai' AND portal_id=portal
    AND aggregate_id=p_id::text AND payload->>'entity_type'=p_kind ORDER BY occurred_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Processing receipt missing' USING ERRCODE='23514'; END IF;
  EXECUTE format('SELECT to_jsonb(r) FROM %s r WHERE id=$1 AND portal_id=$2 FOR UPDATE',relation) INTO row_data USING p_id,portal;
  IF row_data IS NULL OR row_data->>'status'<>'failed' OR (row_data->>'revision')::integer<>p_revision THEN
    RAISE EXCEPTION 'Retry revision/state conflict' USING ERRCODE='40001';
  END IF;
  IF p_kind='transcript' THEN PERFORM core.reporter_source(portal,(row_data->>'source_object_id')::uuid); END IF;
  next_revision := p_revision+1;
  IF p_kind='transcript' THEN
    UPDATE public.reporter_transcripts SET status='queued',generation_id=generation,error_code=NULL,provider=NULL,
      model=NULL,provider_request_id=NULL,started_at=NULL,completed_at=NULL,revision=next_revision WHERE id=p_id;
  ELSE
    EXECUTE format('UPDATE %s SET status=''generating'',generation_id=$1,error_code=NULL,provider=NULL,
      model=NULL,provider_request_id=NULL,prompt_version=NULL,revision=$2 WHERE id=$3',relation)
      USING generation,next_revision,p_id;
  END IF;
  INSERT INTO core.integration_outbox(id,tenant_id,portal_id,module,event_type,aggregate_id,payload)
  VALUES(event,core.context_tenant_id(),portal,'reporter_ai',prior.event_type,p_id::text,
    (prior.payload-ARRAY['command','processing_revision'])||jsonb_build_object('event_id',event,'generation_id',generation,
      'expected_revision',next_revision,'request_id',nullif(current_setting('app.request_id',true),''),
      'command',jsonb_build_object('actor_id',actor,'operation','retry.'||p_kind,'key',p_key,'inputs',inputs)));
  PERFORM core.reporter_audit(portal,'reporter.'||p_kind||'.retried',p_kind,p_id,
    jsonb_build_object('revision',next_revision,'generation_id',generation,'event_id',event));
  RETURN generation;
END $$;

CREATE FUNCTION core.reporter_worker_require() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF NOT core.job_allowed(ARRAY['reporter-ai-processing']) THEN
    RAISE EXCEPTION 'Reporter processing job denied' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION core.reporter_input_valid(job core.integration_outbox) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(
    SELECT FROM public.reporter_transcripts t JOIN core.storage_objects s
      ON (s.portal_id,s.id)=(t.portal_id,t.source_object_id)
      WHERE job.payload->>'entity_type'='transcript' AND t.id=job.aggregate_id::uuid
        AND t.portal_id=job.portal_id AND s.tenant_id=job.tenant_id AND s.status='completed'
        AND s.purpose='reporter-source' AND s.owner_user_id=t.created_by
        AND s.size BETWEEN 1 AND 104857600
        AND s.content_type IN ('audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/webm','video/mp4','video/webm')
        AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp())
    UNION ALL SELECT FROM public.reporter_articles a JOIN public.reporter_transcripts t
      ON (t.portal_id,t.id)=(a.portal_id,a.transcript_id)
      WHERE job.payload->>'entity_type'='article' AND a.id=job.aggregate_id::uuid AND a.portal_id=job.portal_id
        AND a.source_kind='transcript' AND t.status='ready' AND t.revision=(job.payload->>'input_revision')::integer
    UNION ALL SELECT FROM public.reporter_carousels c JOIN public.reporter_articles a
      ON (a.portal_id,a.id,a.approved_revision)=(c.portal_id,c.article_id,c.article_revision)
      WHERE job.payload->>'entity_type'='carousel' AND c.id=job.aggregate_id::uuid AND c.portal_id=job.portal_id
        AND a.status='approved' AND a.approved_revision=(job.payload->>'input_revision')::integer)
$$;

CREATE FUNCTION core.reporter_finish_row(job core.integration_outbox,result jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE kind text := job.payload->>'entity_type'; entity uuid := job.aggregate_id::uuid;
  expected_revision integer := (job.payload->>'expected_revision')::integer;
  generation uuid := (job.payload->>'generation_id')::uuid; data jsonb; failed boolean; action text; next_revision integer;
BEGIN
  IF result IS NULL OR jsonb_typeof(result)<>'object' OR octet_length(result::text)>4194304
    OR result-ARRAY['title','content','segments','slides','provider','model','provider_request_id',
      'prompt_version','error_code','duration_ms','usage_unit','input_units','output_units']<>'{}'
    THEN RAISE EXCEPTION 'Invalid processing result envelope' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT FROM jsonb_each(result) e WHERE e.key IN ('provider','model','provider_request_id','prompt_version','error_code')
    AND jsonb_typeof(e.value)<>'null' AND (jsonb_typeof(e.value)<>'string' OR length(e.value#>>'{}')>256))
    OR EXISTS(SELECT FROM jsonb_each(result) e WHERE e.key IN ('duration_ms','input_units','output_units')
      AND jsonb_typeof(e.value)<>'null' AND (jsonb_typeof(e.value)<>'number'))
    THEN RAISE EXCEPTION 'Invalid processing metadata types' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT FROM jsonb_each(result) e WHERE e.key IN ('title','content')
    AND jsonb_typeof(e.value) NOT IN ('string','null')) THEN
    RAISE EXCEPTION 'Processing content must be text' USING ERRCODE='22023';
  END IF;
  IF (result->>'duration_ms')::numeric<0 OR (result->>'duration_ms')::numeric>86400000
    OR (result->>'input_units')::numeric<0 OR (result->>'output_units')::numeric<0
    OR (result->>'input_units')::numeric>1000000000000 OR (result->>'output_units')::numeric>1000000000000
    OR (result->>'usage_unit') NOT IN ('tokens','audio_ms')
    OR (result->>'error_code') !~ '^[A-Z][A-Z0-9_]{0,127}$'
    THEN RAISE EXCEPTION 'Invalid processing metadata values' USING ERRCODE='22023'; END IF;
  failed := result->>'error_code' IS NOT NULL;
  IF kind='transcript' THEN
    UPDATE public.reporter_transcripts SET status=CASE WHEN failed THEN 'failed' ELSE 'ready' END,
      content=CASE WHEN NOT failed THEN result->>'content' END,
      segments=CASE WHEN NOT failed THEN nullif(result->'segments','null'::jsonb) END,
      provider=result->>'provider',model=result->>'model',provider_request_id=result->>'provider_request_id',
      error_code=result->>'error_code',completed_at=clock_timestamp(),revision=revision+1
      WHERE id=entity AND portal_id=job.portal_id AND status='processing' AND revision=expected_revision
        AND generation_id=generation RETURNING revision INTO next_revision;
  ELSIF kind='article' THEN
    UPDATE public.reporter_articles SET status=CASE WHEN failed THEN 'failed' ELSE 'draft' END,
      title=CASE WHEN NOT failed THEN result->>'title' END,content=CASE WHEN NOT failed THEN result->>'content' END,
      provider=result->>'provider',model=result->>'model',provider_request_id=result->>'provider_request_id',
      prompt_version=result->>'prompt_version',error_code=result->>'error_code',revision=revision+1
      WHERE id=entity AND portal_id=job.portal_id AND status='generating' AND revision=expected_revision
        AND generation_id=generation RETURNING revision INTO next_revision;
  ELSIF kind='carousel' THEN
    UPDATE public.reporter_carousels SET status=CASE WHEN failed THEN 'failed' ELSE 'draft' END,
      title=CASE WHEN NOT failed THEN result->>'title' END,slides=CASE WHEN failed THEN '[]'::jsonb ELSE result->'slides' END,
      provider=result->>'provider',model=result->>'model',provider_request_id=result->>'provider_request_id',
      prompt_version=result->>'prompt_version',error_code=result->>'error_code',revision=revision+1
      WHERE id=entity AND portal_id=job.portal_id AND status='generating' AND revision=expected_revision
        AND generation_id=generation RETURNING revision INTO next_revision;
  ELSE RAISE EXCEPTION 'Unknown processing entity'; END IF;
  IF next_revision IS NULL THEN RAISE EXCEPTION 'Stale generation/revision/state' USING ERRCODE='40001'; END IF;
  data := jsonb_build_object('revision',next_revision,'processing',jsonb_build_object('schema_version',1,
    'generation_id',generation,'event_id',job.id,'request_id',job.payload->'request_id',
    'provider',result->'provider','model',result->'model','provider_request_id',result->'provider_request_id',
    'prompt_version',result->'prompt_version','input_revision',job.payload->'input_revision',
    'status',CASE WHEN failed THEN 'failed' WHEN kind='transcript' THEN 'ready' ELSE 'draft' END,
    'attempt',job.attempts,'duration_ms',result->'duration_ms','usage_unit',result->'usage_unit',
    'input_units',result->'input_units','output_units',result->'output_units','error_code',result->'error_code'));
  action := 'reporter.'||kind||CASE WHEN failed THEN '.failed' ELSE '.generated' END;
  PERFORM core.reporter_audit(job.portal_id,action,kind,entity,data);
  PERFORM core.reporter_outcome(job.portal_id,action,kind,entity,data);
END $$;

-- Dedicated processor only. Never run provider calls in the cache invalidation drainer.
CREATE FUNCTION public.reporter_claim(p_owner text) RETURNS SETOF core.integration_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE exhausted core.integration_outbox;
BEGIN
  PERFORM core.reporter_worker_require();
  IF p_owner IS NULL OR p_owner !~ '^[a-zA-Z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'Invalid lease owner'; END IF;
  -- Recover exhausted generations without deleting the inspectable dead letter.
  FOR exhausted IN SELECT o.* FROM core.integration_outbox o WHERE module='reporter_ai'
    AND processed_at IS NULL AND attempts>=8 AND coalesce(lease_until,'-infinity')<=clock_timestamp()
    AND last_error IS DISTINCT FROM 'ATTEMPTS_EXHAUSTED'
    ORDER BY occurred_at,id LIMIT 10 FOR UPDATE SKIP LOCKED LOOP
    PERFORM core.reporter_finish_row(exhausted,jsonb_build_object('error_code','ATTEMPTS_EXHAUSTED'));
    UPDATE core.integration_outbox SET lease_owner=NULL,lease_until=NULL,last_error='ATTEMPTS_EXHAUSTED' WHERE id=exhausted.id;
  END LOOP;
  RETURN QUERY WITH pending AS (
    SELECT id FROM core.integration_outbox WHERE module='reporter_ai'
      AND event_type IN ('reporter.transcription.requested','reporter.article_generation.requested','reporter.carousel_generation.requested')
      AND processed_at IS NULL AND attempts<8 AND available_at<=clock_timestamp()
      AND coalesce(lease_until,'-infinity')<=clock_timestamp()
      ORDER BY available_at,occurred_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
    UPDATE core.integration_outbox o SET lease_owner=p_owner,lease_until=clock_timestamp()+interval '60 seconds',last_error='LEASE_RESERVED'
      FROM pending p WHERE o.id=p.id RETURNING o.*;
END $$;

CREATE FUNCTION public.reporter_start(p_event uuid,p_owner text) RETURNS core.integration_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE job core.integration_outbox; next_revision integer;
BEGIN
  PERFORM core.reporter_worker_require();
  SELECT * INTO job FROM core.integration_outbox WHERE id=p_event AND module='reporter_ai'
    AND lease_owner=p_owner AND lease_until>clock_timestamp() AND processed_at IS NULL AND attempts<8
    AND last_error='LEASE_RESERVED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lease expired or unavailable' USING ERRCODE='40001'; END IF;
  IF job.payload->>'entity_type'='transcript' THEN
    UPDATE public.reporter_transcripts SET status='processing',started_at=clock_timestamp(),revision=revision+1
      WHERE id=job.aggregate_id::uuid AND portal_id=job.portal_id AND status='queued'
        AND generation_id=(job.payload->>'generation_id')::uuid
        AND revision=(job.payload->>'expected_revision')::integer RETURNING revision INTO next_revision;
    IF FOUND THEN job.payload := jsonb_set(job.payload,'{expected_revision}',to_jsonb(next_revision)); END IF;
  END IF;
  -- Verify even when resuming a prior attempt, before consuming an attempt.
  IF NOT EXISTS (
    SELECT FROM public.reporter_transcripts WHERE job.payload->>'entity_type'='transcript'
      AND id=job.aggregate_id::uuid AND portal_id=job.portal_id AND status='processing'
      AND generation_id=(job.payload->>'generation_id')::uuid AND revision=(job.payload->>'expected_revision')::integer
    UNION ALL SELECT FROM public.reporter_articles WHERE job.payload->>'entity_type'='article'
      AND id=job.aggregate_id::uuid AND portal_id=job.portal_id AND status='generating'
      AND generation_id=(job.payload->>'generation_id')::uuid AND revision=(job.payload->>'expected_revision')::integer
    UNION ALL SELECT FROM public.reporter_carousels WHERE job.payload->>'entity_type'='carousel'
      AND id=job.aggregate_id::uuid AND portal_id=job.portal_id AND status='generating'
      AND generation_id=(job.payload->>'generation_id')::uuid AND revision=(job.payload->>'expected_revision')::integer
  ) THEN RAISE EXCEPTION 'Stale processing input' USING ERRCODE='40001'; END IF;
  UPDATE core.integration_outbox SET payload=job.payload,attempts=attempts+1,last_error='ATTEMPT_STARTED'
    WHERE id=job.id AND lease_owner=p_owner AND lease_until>clock_timestamp() RETURNING * INTO job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lease expired while starting' USING ERRCODE='40001'; END IF;
  IF NOT core.reporter_input_valid(job) THEN
    PERFORM core.reporter_finish_row(job,jsonb_build_object('error_code','INPUT_UNAVAILABLE'));
    UPDATE core.integration_outbox SET processed_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,
      last_error='INPUT_UNAVAILABLE' WHERE id=job.id AND lease_owner=p_owner AND lease_until>clock_timestamp()
      RETURNING * INTO job;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lease expired while rejecting input' USING ERRCODE='40001'; END IF;
  END IF;
  RETURN job;
END $$;

CREATE FUNCTION public.reporter_renew(p_event uuid,p_owner text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  PERFORM core.reporter_worker_require();
  UPDATE core.integration_outbox SET lease_until=clock_timestamp()+interval '60 seconds'
    WHERE id=p_event AND module='reporter_ai' AND lease_owner=p_owner AND lease_until>clock_timestamp() AND processed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lease expired or unavailable' USING ERRCODE='40001'; END IF;
END $$;

CREATE FUNCTION public.reporter_complete(p_event uuid,p_owner text,p_attempt integer,p_result jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE job core.integration_outbox;
BEGIN
  PERFORM core.reporter_worker_require();
  SELECT * INTO job FROM core.integration_outbox WHERE id=p_event AND module='reporter_ai'
    AND lease_owner=p_owner AND lease_until>clock_timestamp() AND processed_at IS NULL
    AND attempts=p_attempt AND attempts>0 AND last_error='ATTEMPT_STARTED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lease/attempt unavailable' USING ERRCODE='40001'; END IF;
  PERFORM core.reporter_finish_row(job,CASE WHEN core.reporter_input_valid(job) THEN p_result
    ELSE jsonb_build_object('error_code','INPUT_UNAVAILABLE') END);
  UPDATE core.integration_outbox SET processed_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,last_error=NULL
    WHERE id=p_event AND lease_owner=p_owner AND attempts=p_attempt AND lease_until>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Lease expired while completing' USING ERRCODE='40001'; END IF;
END $$;

CREATE FUNCTION public.reporter_release(p_event uuid,p_owner text,p_attempt integer,p_error_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  PERFORM core.reporter_worker_require();
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,127}$'
    OR p_error_code IN ('ATTEMPT_STARTED','ATTEMPTS_EXHAUSTED') THEN RAISE EXCEPTION 'Sanitized error code required'; END IF;
  UPDATE core.integration_outbox SET lease_owner=NULL,lease_until=NULL,last_error=p_error_code,
    available_at=clock_timestamp()+make_interval(secs=>least(3600,5*power(2,greatest(attempts-1,0)))::integer)
    WHERE id=p_event AND module='reporter_ai' AND lease_owner=p_owner AND lease_until>clock_timestamp()
      AND processed_at IS NULL AND attempts=p_attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lease/attempt unavailable' USING ERRCODE='40001'; END IF;
END $$;

-- Only these public entry points are callable. Internal helpers are inaccessible.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure signature,p.proname name FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('core','public') AND p.proname LIKE 'reporter_%'
      AND p.proname NOT IN ('reporter_guard','reporter_segments_valid','reporter_slides_valid','reporter_allowed') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO reporter_executor',fn.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn.signature);
    IF fn.name IN ('reporter_create','reporter_edit_article','reporter_submit_article','reporter_review_article',
      'reporter_edit_carousel','reporter_ready_carousel','reporter_retry') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_runtime',fn.signature);
    ELSIF fn.name IN ('reporter_claim','reporter_start','reporter_renew','reporter_complete','reporter_release') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_worker',fn.signature);
    END IF;
  END LOOP;
END $$;
COMMIT;
