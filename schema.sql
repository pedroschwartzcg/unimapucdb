-- Rode no Supabase: SQL Editor > New query.
-- ATENÇÃO: troque 'seu.email@gmail.com' (em minúsculas) pelo Gmail do dev, o MESMO de DEV_EMAIL no config.js.
create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  cat text not null check (char_length(cat) <= 60),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  w int default 40,
  h int default 26,
  autor text default 'dev',
  approved boolean default true,
  created_at timestamptz default now()
);
alter table public.places enable row level security;

create or replace function public.is_dev() returns boolean language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = lower('pedroschwartzcg@gmail.com')
$$;

drop policy if exists "publico ve aprovados" on public.places;
drop policy if exists "aluno sugere" on public.places;
drop policy if exists "dev edita" on public.places;
drop policy if exists "dev apaga" on public.places;

create policy "publico ve aprovados" on public.places for select using (approved or public.is_dev());
create policy "aluno sugere"        on public.places for insert
  with check (public.is_dev() or (approved = false and autor = 'aluno' and cat = 'Sugestão'));
create policy "dev edita"           on public.places for update using (public.is_dev());
create policy "dev apaga"           on public.places for delete using (public.is_dev());

-- Se a tabela JÁ existia (instalação anterior), aplique só as restrições novas:
-- alter table public.places add constraint places_lat_ck check (lat between -90 and 90);
-- alter table public.places add constraint places_lng_ck check (lng between -180 and 180);
-- alter table public.places add constraint places_cat_ck check (char_length(cat) <= 60);
-- (e rode o restante do arquivo: a função e as policies são recriadas com segurança)
