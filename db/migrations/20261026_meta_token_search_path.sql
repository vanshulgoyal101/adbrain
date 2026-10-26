-- #625 (Reviewer): the encrypted-token RPCs follow the #359 standard, an empty search_path. Their bodies
-- name every table (private.meta_tokens) and use only built-in types, so behaviour is unchanged.
alter function public.meta_token_insert(uuid, uuid, uuid, text, text, text, text, text, text, text, text[], jsonb, timestamptz, timestamptz, timestamptz)
  set search_path = '';
alter function public.meta_token_get(uuid, uuid) set search_path = '';
alter function public.meta_token_delete(uuid, uuid) set search_path = '';
