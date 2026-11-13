-- UniMap UCDB: campos para revisão e Storage privado de fotos.
-- Migração exclusivamente aditiva. Revise antes de executar no Supabase.
-- Não cria/recria public.places nem remove/substitui policies existentes.

alter table public.places
  add column if not exists description text,
  add column if not exists image_path text,
  add column if not exists rejected boolean not null default false;

-- O bucket fica privado: imagens pendentes só são acessíveis ao administrador.
-- Se o bucket já existir, esta instrução preserva sua configuração atual.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-images', 'place-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Não sobrescreve policies com estes nomes caso a migração já tenha sido aplicada.
do $$
begin
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
      and policyname = 'unimap_place_images_select'
  ) then
    create policy unimap_place_images_select
      on storage.objects for select to anon, authenticated
      using (
        bucket_id = 'place-images'
        and (
          public.is_dev()
          or exists (
            select 1 from public.places p
            where p.image_path = storage.objects.name and p.approved = true
          )
        )
      );
  end if;
end
$$;
