-- Run in Supabase SQL Editor. This migration preserves existing custom/team data.
begin;
create table if not exists public.scrim_logo_boards (
 id uuid primary key default gen_random_uuid(),
 token text unique not null default encode(gen_random_bytes(32),'hex'),
 name text not null,
 data jsonb not null,
 accepting boolean not null default true,
 updated_at timestamptz not null default now()
);
alter table public.scrim_logo_boards add column if not exists created_at timestamptz;
alter table public.scrim_logo_boards add column if not exists expires_at timestamptz;
-- Existing backups expire two hours after their last stored timestamp at migration time.
update public.scrim_logo_boards set created_at=coalesce(created_at,updated_at),expires_at=coalesce(expires_at,updated_at+interval '2 hours') where created_at is null or expires_at is null;
alter table public.scrim_logo_boards alter column created_at set default now();
alter table public.scrim_logo_boards alter column created_at set not null;
alter table public.scrim_logo_boards alter column expires_at set default (now()+interval '2 hours');
alter table public.scrim_logo_boards alter column expires_at set not null;
create index if not exists scrim_logo_boards_expires_idx on public.scrim_logo_boards(expires_at);
update public.scrim_logo_boards s set accepting=exists(select 1 from jsonb_array_elements(s.data->'assignments') a where a='-1'::jsonb);
alter table public.scrim_logo_boards enable row level security;
revoke all on public.scrim_logo_boards from public, anon, authenticated, service_role;
create or replace function public.scrim_logo_board(operation text, board_id uuid default null, share_token text default null, payload jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare board public.scrim_logo_boards; result jsonb; slot integer;
begin
 delete from public.scrim_logo_boards where expires_at<=clock_timestamp();
 if operation='cleanup' then return '{"cleaned":true}'::jsonb; end if;
 if operation='list' then
   select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'token',s.token,'accepting',s.accepting,'updated_at',s.updated_at,'expires_at',s.expires_at,'teamCount',jsonb_array_length(s.data->'teams'),'missing',(select count(*) from jsonb_array_elements(s.data->'assignments') a where a='-1'::jsonb)) order by s.updated_at desc),'[]'::jsonb) into result from public.scrim_logo_boards s;
   return result;
 elsif operation='create' then
   insert into public.scrim_logo_boards(name,data,accepting) values(payload->>'name',payload->'data',exists(select 1 from jsonb_array_elements(payload->'data'->'assignments') a where a='-1'::jsonb)) returning * into board;
   return to_jsonb(board);
 end if;
 select * into board from public.scrim_logo_boards s where
   (share_token is not null and s.token=share_token) or (share_token is null and s.id=board_id) for update;
 if not found or board.expires_at<=clock_timestamp() then raise exception 'LOGO_NOT_FOUND'; end if;
 if operation='read' then return to_jsonb(board);
 elsif operation='public' then
   select coalesce(jsonb_agg(jsonb_build_object('index',ordinality-1,'name',team->>'name','assigned',(board.data->'assignments'->((ordinality-1)::int)) <> '-1'::jsonb) order by ordinality),'[]'::jsonb) into result from jsonb_array_elements(board.data->'teams') with ordinality t(team,ordinality);
   return jsonb_build_object('name',board.name,'accepting',board.accepting,'expires_at',board.expires_at,'teams',result);
 elsif operation='close' then
   raise exception 'LOGO_AUTOMATIC';
 elsif operation='submit' then
   if not board.accepting then raise exception 'LOGO_CLOSED'; end if;
   slot=(payload->>'slot')::integer;
   if slot is null or slot<0 or slot>=jsonb_array_length(board.data->'teams') then raise exception 'LOGO_BAD_SLOT'; end if;
   if board.data->'assignments'->slot <> '-1'::jsonb then raise exception 'LOGO_ASSIGNED'; end if;
   if octet_length(board.data::text)+octet_length((payload->'logo')::text)>100000000 then raise exception 'LOGO_FULL'; end if;
   board.data=jsonb_set(board.data,array['assignments',slot::text],to_jsonb(jsonb_array_length(board.data->'logos')));
   board.data=jsonb_set(board.data,'{logos}',(board.data->'logos')||jsonb_build_array(payload->'logo'));
   update public.scrim_logo_boards set data=board.data,accepting=exists(select 1 from jsonb_array_elements(board.data->'assignments') a where a='-1'::jsonb),updated_at=now() where id=board.id;
   return '{"saved":true}'::jsonb;
 end if;
 raise exception 'LOGO_BAD_OPERATION';
end;
$$;
revoke all on function public.scrim_logo_board(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.scrim_logo_board(text,uuid,text,jsonb) to service_role;
-- Cleanup runs on Supabase even when the web service is asleep.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('scrim-logo-backup-expiry','* * * * *',
  $cleanup$delete from public.scrim_logo_boards where expires_at<=clock_timestamp();$cleanup$);
commit;
notify pgrst,'reload schema';
