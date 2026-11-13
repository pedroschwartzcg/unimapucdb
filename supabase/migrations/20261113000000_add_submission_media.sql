-- UniMap UCDB: metadados complementares, rate limit e Storage privado.
-- Migração exclusivamente aditiva: não altera public.places e não remove/substitui policies.
-- Revise e execute manualmente. Nenhum SQL foi executado por esta revisão.

create table if not exists public.place_submission_details (
  place_id uuid primary key references public.places(id) on delete cascade,
  description text check (description is null or char_length(description) <= 500),
  image_path text unique,
  rejected boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.place_submission_details enable row level security;
grant select on public.place_submission_details to anon, authenticated;
grant insert on public.place_submission_details to authenticated;
grant update on public.place_submission_details to authenticated;
grant all on public.place_submission_details to service_role;

-- Migra metadados da primeira versão da implementação, caso suas colunas já existam.
do $$
begin
  if (
    select count(*) = 3
    from information_schema.columns
    where table_schema = 'public' and table_name = 'places'
      and column_name in ('description', 'image_path', 'rejected')
  ) then
    execute $sql$
      insert into public.place_submission_details (place_id, description, image_path, rejected)
      select id, description, image_path, coalesce(rejected, false)
      from public.places
      where description is not null or image_path is not null or rejected is true
      on conflict (place_id) do nothing
    $sql$;
  end if;
end
$$;

create table if not exists public.place_submission_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.place_submission_rate_limits enable row level security;
grant all on public.place_submission_rate_limits to service_role;

create or replace function public.consume_place_submission_limit(
  p_ip_hash text,
  p_window_start timestamptz,
  p_limit integer default 6
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_count integer;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$' or p_limit < 1 or p_limit > 20 then
    return false;
  end if;
  insert into public.place_submission_rate_limits (ip_hash, window_start, request_count, updated_at)
  values (p_ip_hash, p_window_start, 1, now())
  on conflict (ip_hash) do update set
    window_start = excluded.window_start,
    request_count = case
      when public.place_submission_rate_limits.window_start = excluded.window_start
        then public.place_submission_rate_limits.request_count + 1
      else 1
    end,
    updated_at = now()
  returning request_count into v_request_count;
  return v_request_count <= p_limit;
end;
$$;
revoke all on function public.consume_place_submission_limit(text, timestamptz, integer) from public;
revoke all on function public.consume_place_submission_limit(text, timestamptz, integer) from anon, authenticated;
grant execute on function public.consume_place_submission_limit(text, timestamptz, integer) to service_role;

-- O bucket é privado. Se já existir, a configuração atual é preservada.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-images', 'place-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Policies aditivas. Os guards RESTRICTIVE limitam o bucket mesmo se outra policy permissiva for ampla.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'place_submission_details'
      and policyname = 'unimap_submission_details_select'
  ) then
    create policy unimap_submission_details_select
      on public.place_submission_details for select to anon, authenticated
      using (
        public.is_dev()
        or exists (select 1 from public.places p where p.id = place_id and p.approved = true)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'place_submission_details'
      and policyname = 'unimap_submission_details_select_guard'
  ) then
    create policy unimap_submission_details_select_guard
      on public.place_submission_details as restrictive for select to anon, authenticated
      using (
        public.is_dev()
        or exists (select 1 from public.places p where p.id = place_id and p.approved = true)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'place_submission_details'
      and policyname = 'unimap_submission_details_admin_update'
  ) then
    create policy unimap_submission_details_admin_update
      on public.place_submission_details for update to authenticated
      using (public.is_dev()) with check (public.is_dev());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'place_submission_details'
      and policyname = 'unimap_submission_details_admin_insert'
  ) then
    create policy unimap_submission_details_admin_insert
      on public.place_submission_details for insert to authenticated
      with check (public.is_dev());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'unimap_place_images_insert'
  ) then
    create policy unimap_place_images_insert
      on storage.objects for insert to anon, authenticated
      with check (
        bucket_id = 'place-images'
        and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
        and metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
        and case
          when coalesce(metadata ->> 'size', '') ~ '^[0-9]+$'
            then (metadata ->> 'size')::bigint between 1 and 5242880
          else false
        end
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'unimap_place_images_insert_guard'
  ) then
    create policy unimap_place_images_insert_guard
      on storage.objects as restrictive for insert to anon, authenticated
      with check (bucket_id <> 'place-images' or public.is_dev());
  end if;

  -- Separate gate name keeps this restriction effective if an earlier migration
  -- already created a less restrictive insert_guard policy.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'unimap_place_images_server_insert_only'
  ) then
    create policy unimap_place_images_server_insert_only
      on storage.objects as restrictive for insert to anon, authenticated
      with check (bucket_id <> 'place-images' or public.is_dev());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'unimap_place_images_select'
  ) then
    create policy unimap_place_images_select
      on storage.objects for select to anon, authenticated
      using (
        bucket_id = 'place-images'
        and (
          public.is_dev()
          or exists (
            select 1 from public.place_submission_details d
            join public.places p on p.id = d.place_id
            where d.image_path = storage.objects.name and p.approved = true
          )
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'unimap_place_images_select_guard'
  ) then
    create policy unimap_place_images_select_guard
      on storage.objects as restrictive for select to anon, authenticated
      using (
        bucket_id <> 'place-images'
        or public.is_dev()
        or exists (
          select 1 from public.place_submission_details d
          join public.places p on p.id = d.place_id
          where d.image_path = storage.objects.name and p.approved = true
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'unimap_place_images_delete_guard'
  ) then
    create policy unimap_place_images_delete_guard
      on storage.objects as restrictive for delete to anon, authenticated
      using (bucket_id <> 'place-images' or public.is_dev());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'unimap_place_images_admin_delete'
  ) then
    create policy unimap_place_images_admin_delete
      on storage.objects for delete to authenticated
      using (bucket_id = 'place-images' and public.is_dev());
  end if;
end
$$;
