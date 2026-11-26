-- Per-user project cap (security review, 2026-11-26). Without it a signed-in
-- user could insert unlimited rows of up to 256 KB each and fill the database.
-- Browser inserts (role "authenticated") fail with SQLSTATE 54000
-- (program_limit_exceeded) once the caller owns 200 projects; store.js turns
-- that into "delete one, then save again". Service-role and postgres writes
-- (admin tools, tests, retention jobs) are not limited.
--
-- Runs after projects_before_insert (triggers fire in name order), so
-- owner_id has already been pinned to auth.uid(). The advisory lock
-- serialises one user's concurrent inserts so the cap can't be overshot.

create function public.projects_enforce_cap() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cap constant integer := 200;
  owned integer;
begin
  if current_user in ('authenticated', 'anon') then
    perform pg_advisory_xact_lock(hashtextextended('projects_cap:' || new.owner_id::text, 0));
    select count(*) into owned from public.projects where owner_id = new.owner_id;
    if owned >= cap then
      raise exception 'project limit reached (% projects per account)', cap
        using errcode = '54000', hint = 'Delete a project you no longer need, then save again.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.projects_enforce_cap() from public, anon, authenticated;

create trigger projects_cap_before_insert before insert on public.projects
  for each row execute function public.projects_enforce_cap();
