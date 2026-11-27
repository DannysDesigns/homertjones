-- Homer T. Jones: gallery, editable homepage text, and the /Host admin.
-- Safe to run more than once (Supabase SQL editor or `supabase db query --linked -f supabase/schema.sql`).

-- ---------------------------------------------------------------------------
-- Admin allowlist. Only accounts listed here can change the site.
-- Add someone:  insert into public.site_admins (user_id, note)
--               select id, 'Name' from auth.users where email = 'person@example.com';
-- ---------------------------------------------------------------------------

create table if not exists public.site_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table public.site_admins enable row level security;
revoke all on public.site_admins from anon, authenticated;
grant select on public.site_admins to authenticated;

drop policy if exists "Admins can see their own admin row" on public.site_admins;
create policy "Admins can see their own admin row" on public.site_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.is_site_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.site_admins a where a.user_id = (select auth.uid()));
$$;

revoke execute on function public.is_site_admin() from public, anon;
grant execute on function public.is_site_admin() to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Gallery images. Files live in Storage:
--   gallery            (public)  <id>/large.jpg, <id>/thumb.jpg
--   gallery-originals  (private) <id>/original.<ext>
-- ---------------------------------------------------------------------------

create table if not exists public.gallery_images (
  id uuid primary key default gen_random_uuid(),
  title text not null default '' check (char_length(title) <= 160),
  caption text not null default '' check (char_length(caption) <= 1000),
  image_path text not null,
  thumb_path text not null,
  original_path text not null,
  original_name text not null default '',
  original_type text not null default '',
  original_size bigint,
  width integer,
  height integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gallery_images_sort_idx on public.gallery_images (sort_order, created_at desc);

drop trigger if exists gallery_images_touch on public.gallery_images;
create trigger gallery_images_touch before update on public.gallery_images
  for each row execute function public.touch_updated_at();

alter table public.gallery_images enable row level security;
revoke all on public.gallery_images from anon, authenticated;
grant select on public.gallery_images to anon, authenticated;
grant insert, update, delete on public.gallery_images to authenticated;

drop policy if exists "Anyone can view gallery images" on public.gallery_images;
create policy "Anyone can view gallery images" on public.gallery_images
  for select to anon, authenticated
  using (true);

drop policy if exists "Admins can add gallery images" on public.gallery_images;
create policy "Admins can add gallery images" on public.gallery_images
  for insert to authenticated
  with check ((select public.is_site_admin()));

drop policy if exists "Admins can edit gallery images" on public.gallery_images;
create policy "Admins can edit gallery images" on public.gallery_images
  for update to authenticated
  using ((select public.is_site_admin()))
  with check ((select public.is_site_admin()));

drop policy if exists "Admins can delete gallery images" on public.gallery_images;
create policy "Admins can delete gallery images" on public.gallery_images
  for delete to authenticated
  using ((select public.is_site_admin()));

-- Saves a new gallery order in one step: position in the array becomes sort_order.
create or replace function public.reorder_gallery_images(ordered_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only site admins can reorder the gallery' using errcode = '42501';
  end if;

  update public.gallery_images g
     set sort_order = o.position
    from unnest(ordered_ids) with ordinality as o (id, position)
   where g.id = o.id
     and g.sort_order is distinct from o.position::integer;
end;
$$;

revoke execute on function public.reorder_gallery_images(uuid[]) from public, anon;
grant execute on function public.reorder_gallery_images(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Editable homepage text. Each key matches a data-edit="..." attribute in
-- public/index.html. A missing row means "use the text written in the HTML".
-- ---------------------------------------------------------------------------

create table if not exists public.site_content (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  value text not null check (char_length(value) <= 4000),
  updated_at timestamptz not null default now()
);

drop trigger if exists site_content_touch on public.site_content;
create trigger site_content_touch before update on public.site_content
  for each row execute function public.touch_updated_at();

alter table public.site_content enable row level security;
revoke all on public.site_content from anon, authenticated;
grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;

drop policy if exists "Anyone can read site content" on public.site_content;
create policy "Anyone can read site content" on public.site_content
  for select to anon, authenticated
  using (true);

drop policy if exists "Admins can add site content" on public.site_content;
create policy "Admins can add site content" on public.site_content
  for insert to authenticated
  with check ((select public.is_site_admin()));

drop policy if exists "Admins can edit site content" on public.site_content;
create policy "Admins can edit site content" on public.site_content
  for update to authenticated
  using ((select public.is_site_admin()))
  with check ((select public.is_site_admin()));

drop policy if exists "Admins can remove site content" on public.site_content;
create policy "Admins can remove site content" on public.site_content
  for delete to authenticated
  using ((select public.is_site_admin()));

-- ---------------------------------------------------------------------------
-- Storage buckets and policies.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('gallery', 'gallery', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('gallery-originals', 'gallery-originals', false, 52428800,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins can manage gallery files" on storage.objects;
create policy "Admins can manage gallery files" on storage.objects
  for all to authenticated
  using (bucket_id in ('gallery', 'gallery-originals') and (select public.is_site_admin()))
  with check (bucket_id in ('gallery', 'gallery-originals') and (select public.is_site_admin()));
