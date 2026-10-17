-- Run once in the Supabase SQL Editor. Safe to run again.
-- State is one atomic JSONB snapshot, preserving the existing game's data format.
begin;
create table if not exists public.scrim_state (
  id boolean primary key default true check (id),
  customs jsonb not null check (jsonb_typeof(customs) = 'array'),
  teams jsonb not null check (jsonb_typeof(teams) = 'array'),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.scrim_backups (
  id bigint generated always as identity primary key,
  label text not null,
  state jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.scrim_state enable row level security;
alter table public.scrim_backups enable row level security;
revoke all on public.scrim_state, public.scrim_backups from public, anon, authenticated, service_role;

create or replace function public.scrim_initialize(initial_customs jsonb, initial_teams jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  insert into public.scrim_state(id, customs, teams) values (true, initial_customs, initial_teams)
    on conflict (id) do nothing;
  select to_jsonb(s) into result from public.scrim_state s where id = true;
  return result;
end;
$$;

create or replace function public.scrim_read()
returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(s) from public.scrim_state s where id = true;
$$;

create or replace function public.scrim_write(expected_revision bigint, collection text, items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_state public.scrim_state; result jsonb;
begin
  select * into current_state from public.scrim_state where id = true for update;
  if not found then raise exception 'SCRIM_NOT_INITIALIZED'; end if;
  if current_state.revision <> expected_revision then raise exception 'SCRIM_CONFLICT'; end if;
  if collection not in ('teams', 'customs') or jsonb_typeof(items) is distinct from 'array' then
    raise exception 'SCRIM_INVALID_COLLECTION';
  end if;
  if collection = 'customs' then
    if exists (
      select 1 from jsonb_array_elements(current_state.customs) old
      where not exists (select 1 from jsonb_array_elements(items) new where new->>'id' = old->>'id')
    ) then raise exception 'SCRIM_CUSTOM_DELETE_FORBIDDEN'; end if;
    update public.scrim_state set customs = items, revision = revision + 1, updated_at = now() where id = true;
  else
    update public.scrim_state set teams = items, revision = revision + 1, updated_at = now() where id = true;
  end if;
  select to_jsonb(s) into result from public.scrim_state s where id = true;
  return result;
end;
$$;

create or replace function public.scrim_backup(expected_revision bigint, backup_label text)
returns void language plpgsql security definer set search_path = '' as $$
declare current_state public.scrim_state;
begin
  select * into current_state from public.scrim_state where id = true for update;
  if not found then raise exception 'SCRIM_NOT_INITIALIZED'; end if;
  if current_state.revision <> expected_revision then raise exception 'SCRIM_CONFLICT'; end if;
  insert into public.scrim_backups(label, state) values (backup_label, to_jsonb(current_state));
end;
$$;
revoke all on function public.scrim_initialize(jsonb,jsonb), public.scrim_read(), public.scrim_write(bigint,text,jsonb), public.scrim_backup(bigint,text) from public, anon, authenticated;
grant execute on function public.scrim_initialize(jsonb,jsonb), public.scrim_read(), public.scrim_write(bigint,text,jsonb), public.scrim_backup(bigint,text) to service_role;
commit;
notify pgrst, 'reload schema';
