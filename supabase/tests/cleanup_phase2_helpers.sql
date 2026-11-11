-- One-time cleanup of the verified Phase 2 test-only schema.
-- RESTRICT (the default) stops if an unexpected dependency exists.
-- No application records, policies, functions or storage objects are changed.
begin;
drop function if exists rls_check.rec(text, text, text);
drop function if exists rls_check.try(text);
drop function if exists rls_check.val(text);
drop table if exists rls_check.results;
drop table if exists rls_check.ctx;
drop schema if exists rls_check;
commit;
