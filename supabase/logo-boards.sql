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
alter table public.scrim_logo_boards enable row level security;
revoke all on public.scrim_logo_boards from public, anon, authenticated, service_role;
create or replace function public.scrim_logo_board(operation text, board_id uuid default null, share_token text default null, payload jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare board public.scrim_logo_boards; result jsonb; slot integer;
begin
 if operation='list' then
   select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'token',s.token,'accepting',s.accepting,'updated_at',s.updated_at,'teamCount',jsonb_array_length(s.data->'teams'),'missing',(select count(*) from jsonb_array_elements(s.data->'assignments') a where a='-1'::jsonb)) order by s.updated_at desc),'[]'::jsonb) into result from public.scrim_logo_boards s;
   return result;
 elsif operation='create' then
   insert into public.scrim_logo_boards(name,data) values(payload->>'name',payload->'data') returning * into board;
   return to_jsonb(board);
 end if;
 select * into board from public.scrim_logo_boards s where
   (share_token is not null and s.token=share_token) or (share_token is null and s.id=board_id) for update;
 if not found then raise exception 'LOGO_NOT_FOUND'; end if;
 if operation='read' then return to_jsonb(board);
 elsif operation='public' then
   select coalesce(jsonb_agg(jsonb_build_object('index',ordinality-1,'name',team->>'name','assigned',(board.data->'assignments'->((ordinality-1)::int)) <> '-1'::jsonb) order by ordinality),'[]'::jsonb) into result from jsonb_array_elements(board.data->'teams') with ordinality t(team,ordinality);
   return jsonb_build_object('name',board.name,'accepting',board.accepting,'teams',result);
 elsif operation='close' then
   update public.scrim_logo_boards set accepting=(payload->>'accepting')::boolean,updated_at=now() where id=board.id returning * into board;
   return to_jsonb(board);
 elsif operation='submit' then
   if not board.accepting then raise exception 'LOGO_CLOSED'; end if;
   slot=(payload->>'slot')::integer;
   if slot is null or slot<0 or slot>=jsonb_array_length(board.data->'teams') then raise exception 'LOGO_BAD_SLOT'; end if;
   if board.data->'assignments'->slot <> '-1'::jsonb then raise exception 'LOGO_ASSIGNED'; end if;
   if octet_length(board.data::text)+octet_length((payload->'logo')::text)>24000000 then raise exception 'LOGO_FULL'; end if;
   board.data=jsonb_set(board.data,array['assignments',slot::text],to_jsonb(jsonb_array_length(board.data->'logos')));
   board.data=jsonb_set(board.data,'{logos}',(board.data->'logos')||jsonb_build_array(payload->'logo'));
   update public.scrim_logo_boards set data=board.data,updated_at=now() where id=board.id;
   return '{"saved":true}'::jsonb;
 end if;
 raise exception 'LOGO_BAD_OPERATION';
end;
$$;
revoke all on function public.scrim_logo_board(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.scrim_logo_board(text,uuid,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
