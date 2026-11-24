-- Retention (Milestone 2, T6). Clock = projects.last_edited_at.
--   6 months after the last edit  -> flagged_for_deletion_at is set (in-app warning)
--   30 days after being flagged   -> the row is permanently deleted
-- Any user edit clears the flag (projects_before_update trigger). Both jobs take
-- p_now so tests can pin the boundaries; pg_cron calls them with the default.
-- They run as their owner (postgres), so the client-column trigger rules do not
-- apply to them. Only the service role and postgres may execute them.

create function public.flag_expired_projects(p_now timestamptz default now()) returns integer
language sql
security definer
set search_path = ''
as $$
  with flagged as (
    update public.projects
       set flagged_for_deletion_at = p_now
     where flagged_for_deletion_at is null
       and last_edited_at <= p_now - interval '6 months'
    returning 1
  )
  select count(*)::integer from flagged;
$$;

create function public.purge_flagged_projects(p_now timestamptz default now()) returns integer
language sql
security definer
set search_path = ''
as $$
  with purged as (
    delete from public.projects
     where flagged_for_deletion_at is not null
       and flagged_for_deletion_at <= p_now - interval '30 days'
    returning 1
  )
  select count(*)::integer from purged;
$$;

revoke all on function public.flag_expired_projects(timestamptz) from public, anon, authenticated;
revoke all on function public.purge_flagged_projects(timestamptz) from public, anon, authenticated;
grant execute on function public.flag_expired_projects(timestamptz) to service_role;
grant execute on function public.purge_flagged_projects(timestamptz) to service_role;

-- Daily, 02:15 / 02:30 UTC (07:45 / 08:00 IST). Purge runs after flag, and a
-- fresh flag is 30 days from purge age, so nothing is flagged and deleted the
-- same night.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule('flag-expired-projects', '15 2 * * *', 'select public.flag_expired_projects()');
select cron.schedule('purge-flagged-projects', '30 2 * * *', 'select public.purge_flagged_projects()');
