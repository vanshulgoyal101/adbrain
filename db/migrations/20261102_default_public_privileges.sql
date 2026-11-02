begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Existing objects and the explicit service_role defaults in public are unchanged.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- PostgreSQL's PUBLIC function default is global, so this also affects future functions in other schemas.
alter default privileges for role postgres
  revoke execute on functions from public;

commit;
