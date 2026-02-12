-- Cleanup: remove legacy old 16PF slug (16pf) from DB
-- Use when you previously had an old test with slug='16pf' and want ONLY:
-- - 16pf-a
-- - 16pf-b
--
-- Safe order: delete interpretations first (FK cascade should handle too), then tests.

begin;

-- Remove legacy interpretation keys (if any)
delete from public.test_interpretations where test_slug = '16pf';

-- Remove legacy test definition (if any)
delete from public.tests where slug = '16pf';

-- If you have training attempts referencing old slug, you may need to decide what to do with them.
-- Example (DANGEROUS): delete old attempts
-- delete from public.training_attempts where test_slug = '16pf';

commit;
