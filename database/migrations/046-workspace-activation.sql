-- One audited activation policy; deployment and data recovery never require another client workspace.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_workspace_activation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  mode text NOT NULL DEFAULT 'admin' CHECK(mode IN ('off','admin','all')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.reporter_workspace_activation(singleton) VALUES(true) ON CONFLICT DO NOTHING;
ALTER TABLE public.reporter_workspace_activation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_workspace_activation FROM PUBLIC,reporter_runtime,reporter_worker,reporter_executor;

-- Mode is public product availability, not an authorization grant. Every context still checks its actual membership.
CREATE OR REPLACE FUNCTION public.reporter_workspace_activation() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('mode',mode,'revision',revision,'updatedAt',updated_at) FROM public.reporter_workspace_activation WHERE singleton
$$;
CREATE OR REPLACE FUNCTION public.reporter_workspace_activation_save(p_mode text,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.platform_operator(); previous jsonb; updated jsonb; current public.reporter_workspace_activation;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('off','admin','all') THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  SELECT * INTO current FROM public.reporter_workspace_activation WHERE singleton FOR UPDATE;
  IF current.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  previous:=public.reporter_workspace_activation();
  IF current.mode=p_mode THEN RETURN previous; END IF;
  UPDATE public.reporter_workspace_activation SET mode=p_mode,revision=revision+1,updated_at=clock_timestamp() WHERE singleton;
  updated:=public.reporter_workspace_activation();
  INSERT INTO public.audit_log(user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(actor,'platform.navigation.changed','workspace_activation',previous,updated,'platform',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN updated;
END $$;
ALTER FUNCTION public.reporter_workspace_activation() OWNER TO CURRENT_USER;
ALTER FUNCTION public.reporter_workspace_activation_save(text,bigint) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.reporter_workspace_activation(),public.reporter_workspace_activation_save(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_workspace_activation(),public.reporter_workspace_activation_save(text,bigint) TO reporter_runtime;
COMMIT;
