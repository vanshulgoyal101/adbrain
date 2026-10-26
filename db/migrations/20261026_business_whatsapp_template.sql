begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #840: the business's own WhatsApp opening, used by every new WhatsApp campaign by default:
-- greeting, then a pre-typed message (optionally with a Call now button) or up to three questions.
-- Null means AdBrain writes one per campaign, as before. Validated in the app (zod); the database
-- only bounds its shape and size. Covered by the existing owner-only "businesses: all own" policy.
alter table public.businesses add column if not exists whatsapp_template jsonb;

alter table public.businesses drop constraint if exists businesses_whatsapp_template_shape;
alter table public.businesses add constraint businesses_whatsapp_template_shape
  check (whatsapp_template is null or (jsonb_typeof(whatsapp_template) = 'object' and octet_length(whatsapp_template::text) <= 4096));

commit;
