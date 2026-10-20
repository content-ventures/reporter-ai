-- Fact checks of citations: one row per citation id, kept apart from the citation so a recheck
-- or an editor's verdict never collides with the citation's editorial revision. Replayable.
BEGIN;

ALTER TABLE public.reporter_ed_items DROP CONSTRAINT IF EXISTS reporter_ed_items_kind_check;
ALTER TABLE public.reporter_ed_items ADD CONSTRAINT reporter_ed_items_kind_check
  CHECK(kind IN ('person','member','activity','feedback','image_asset','citation','library_image','banner','fact_check'));

COMMIT;
