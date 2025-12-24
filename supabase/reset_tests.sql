-- PRODUCTION helper: remove all tests (and related interpretation/unlocks)
--
-- Use this if you seeded demo tests earlier and want a clean catalog.
--
-- ⚠️ This will DELETE DATA.

begin;

-- Remove paywall state first
delete from public.test_unlocks;
delete from public.test_interpretations;

-- Remove tests
delete from public.tests;

commit;
