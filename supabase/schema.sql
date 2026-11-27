-- =====================================================================
-- Runedle · X1 ao vivo
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em "Run".
-- =====================================================================

-- Salas (visíveis para os jogadores, sem a resposta)
create table if not exists public.x1_rooms (
  code        text primary key,
  mode        text not null check (mode in ('classic', 'quote', 'ability', 'emoji', 'splash')),
  status      text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  round       int  not null default 0,
  host_id     uuid,
  winner_id   uuid,
  starts_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Jogadores de cada sala (o progresso aparece para o adversário em tempo real)
create table if not exists public.x1_players (
  id           uuid primary key default gen_random_uuid(),
  room_code    text not null references public.x1_rooms(code) on delete cascade,
  name         text not null,
  attempts     int  not null default 0,
  progress     int  not null default 0,      -- Classic: quadrados verdes no último palpite (0 a 7)
  finished     boolean not null default false,
  won          boolean not null default false,
  finished_at  timestamptz,
  joined_at    timestamptz not null default now()
);
create index if not exists x1_players_room on public.x1_players(room_code);

-- Resposta e pista da rodada: só a função do servidor lê
create table if not exists public.x1_secrets (
  room_code  text primary key references public.x1_rooms(code) on delete cascade,
  target_id  text not null,
  clue       jsonb not null default '{}'::jsonb
);

-- Senha de cada jogador (impede que alguém jogue no lugar do outro)
create table if not exists public.x1_tokens (
  player_id  uuid primary key references public.x1_players(id) on delete cascade,
  token      text not null
);

-- Segurança: o navegador só pode LER salas e jogadores. Ninguém lê respostas nem senhas.
alter table public.x1_rooms   enable row level security;
alter table public.x1_players enable row level security;
alter table public.x1_secrets enable row level security;
alter table public.x1_tokens  enable row level security;

drop policy if exists "x1 ler salas" on public.x1_rooms;
create policy "x1 ler salas" on public.x1_rooms for select to anon, authenticated using (true);
drop policy if exists "x1 ler jogadores" on public.x1_players;
create policy "x1 ler jogadores" on public.x1_players for select to anon, authenticated using (true);

-- Permissões explícitas (funciona mesmo com "Grant API access to new tables" desmarcado)
revoke all on public.x1_rooms, public.x1_players, public.x1_secrets, public.x1_tokens from anon, authenticated;
grant select on public.x1_rooms, public.x1_players to anon, authenticated;
grant all on public.x1_rooms, public.x1_players, public.x1_secrets, public.x1_tokens to service_role;

-- Tempo real: avisa os navegadores quando salas e jogadores mudam
do $$
begin
  begin alter publication supabase_realtime add table public.x1_rooms;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.x1_players; exception when duplicate_object then null; end;
end $$;

-- Limpeza: apaga salas com mais de 1 dia (rodada pela própria função ao criar uma sala)
create or replace function public.x1_cleanup() returns void language sql security definer set search_path = public as $$
  delete from public.x1_rooms where created_at < now() - interval '1 day';
$$;
revoke all on function public.x1_cleanup() from public, anon, authenticated;
grant execute on function public.x1_cleanup() to service_role;
