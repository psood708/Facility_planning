-- Saved projects (Milestone 2). One row per facility project, owned by one user.
-- Security model: the browser talks to PostgREST with the user's JWT; row level
-- security (enabled AND forced) limits every operation to the owner's rows, and
-- triggers pin the columns a client must never set (R4/R5). Retention: the clock
-- is last_edited_at; the flag/purge jobs (next migration) are the only writers
-- of flagged_for_deletion_at.

create table public.projects (
  id                       uuid primary key default gen_random_uuid(),
  owner_id                 uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                     text not null,
  notes                    text not null default '',
  inputs                   jsonb not null,
  data_hash                text not null,
  engine_version           text not null,
  results_snapshot         jsonb,
  created_at               timestamptz not null default now(),
  last_edited_at           timestamptz not null default now(),
  flagged_for_deletion_at  timestamptz,

  -- Mirrors project-state.js LIMITS; the database is the last line of defence.
  constraint projects_name_len       check (char_length(name) between 1 and 120 and name = btrim(name)),
  constraint projects_notes_len      check (char_length(notes) <= 2000),
  constraint projects_inputs_shape   check (jsonb_typeof(inputs) = 'object' and octet_length(inputs::text) <= 262144),
  constraint projects_snapshot_shape check (results_snapshot is null
                                            or (jsonb_typeof(results_snapshot) = 'object' and octet_length(results_snapshot::text) <= 262144)),
  constraint projects_data_hash_fmt  check (data_hash ~ '^[0-9a-f]{64}$'),
  constraint projects_engine_fmt     check (engine_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  constraint projects_flag_after_edit check (flagged_for_deletion_at is null or flagged_for_deletion_at >= last_edited_at)
);

comment on column public.projects.last_edited_at is 'Retention clock: set on insert and on every user update. Opening a project does not change it.';
comment on column public.projects.flagged_for_deletion_at is 'Set by the flag job 6 months after last edit; row is purged 30 days later. Any user edit clears it.';

-- Listing a user's projects, newest edit first.
create index projects_owner_last_edited_idx on public.projects (owner_id, last_edited_at desc);
-- Retention jobs: unflagged rows past the cutoff, and flagged rows past grace.
create index projects_unflagged_last_edited_idx on public.projects (last_edited_at) where flagged_for_deletion_at is null;
create index projects_flagged_idx on public.projects (flagged_for_deletion_at) where flagged_for_deletion_at is not null;

-- ---------------------------------------------------------------- triggers

-- Browser requests run as role "authenticated" (or "anon"); the retention
-- jobs run as postgres and are not restricted here.
create function public.projects_before_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    -- R4: whatever owner the client sent, the row belongs to the caller.
    new.owner_id := auth.uid();
    if new.owner_id is null then
      raise exception 'not signed in' using errcode = '42501';
    end if;
    new.created_at := now();
    new.last_edited_at := now();
    new.flagged_for_deletion_at := null;
  end if;
  return new;
end;
$$;

create function public.projects_before_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    -- R5: these columns are never client-writable.
    if new.owner_id is distinct from old.owner_id then
      raise exception 'owner_id cannot be changed' using errcode = '42501';
    end if;
    if new.created_at is distinct from old.created_at then
      raise exception 'created_at cannot be changed' using errcode = '42501';
    end if;
    if new.last_edited_at is distinct from old.last_edited_at then
      raise exception 'last_edited_at cannot be changed' using errcode = '42501';
    end if;
    if new.flagged_for_deletion_at is distinct from old.flagged_for_deletion_at then
      raise exception 'flagged_for_deletion_at cannot be changed' using errcode = '42501';
    end if;
    -- Any edit (including "Keep this project") restarts the retention clock.
    new.last_edited_at := now();
    new.flagged_for_deletion_at := null;
  end if;
  return new;
end;
$$;

create trigger projects_before_insert before insert on public.projects
  for each row execute function public.projects_before_insert();
create trigger projects_before_update before update on public.projects
  for each row execute function public.projects_before_update();

revoke all on function public.projects_before_insert() from public, anon, authenticated;
revoke all on function public.projects_before_update() from public, anon, authenticated;

-- ---------------------------------------------------------------- access

alter table public.projects enable row level security;
alter table public.projects force row level security;

revoke all on table public.projects from public;
revoke all on table public.projects from anon;
revoke all on table public.projects from authenticated;
grant select, insert, update, delete on table public.projects to authenticated;

create policy projects_select_own on public.projects
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy projects_insert_own on public.projects
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy projects_update_own on public.projects
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy projects_delete_own on public.projects
  for delete to authenticated
  using (owner_id = (select auth.uid()));
