alter table public.creatives add column if not exists generation jsonb;
notify pgrst, 'reload schema';