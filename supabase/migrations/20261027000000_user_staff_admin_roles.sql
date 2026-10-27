drop trigger if exists prevent_last_super_admin_demotion on public.user_profiles;
drop function if exists public.prevent_last_super_admin_demotion();

update public.user_profiles
set role = 'admin'
where role = 'super_admin';

alter table public.user_profiles
  drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role in ('pending', 'user', 'staff', 'admin'));

create or replace function public.prevent_last_admin_demotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(483920145);

  if old.role = 'admin'
     and new.role <> 'admin'
     and (select auth.uid()) = old.id then
    raise exception 'An Admin cannot demote their own account.';
  end if;

  if old.role = 'admin'
     and new.role <> 'admin'
     and not exists (
       select 1
       from public.user_profiles as profile
       where profile.role = 'admin'
         and profile.id <> old.id
     ) then
    raise exception 'The last Admin cannot be demoted.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_last_admin_demotion on public.user_profiles;

create trigger prevent_last_admin_demotion
  before update of role on public.user_profiles
  for each row
  execute function public.prevent_last_admin_demotion();

drop policy if exists "AAL2 profile read access" on public.user_profiles;
drop policy if exists "AAL2 Super Admin profile updates" on public.user_profiles;
drop policy if exists "Verified users can read their own profile; Super Admins can read all profiles" on public.user_profiles;
drop policy if exists "Verified Super Admins can change administrator profiles" on public.user_profiles;
drop policy if exists "Users can read their own profile; Super Admins can read all profiles" on public.user_profiles;
drop policy if exists "Only Super Admins can change administrator profiles" on public.user_profiles;
drop policy if exists "Users can read own profiles; Admins can read all profiles" on public.user_profiles;
drop policy if exists "Admins can change account roles" on public.user_profiles;
drop policy if exists "AAL2 users can read shared workspace records" on public.workspace_records;
drop policy if exists "AAL2 admins can add shared workspace records" on public.workspace_records;
drop policy if exists "AAL2 admins can update shared workspace records" on public.workspace_records;
drop policy if exists "AAL2 admins can delete shared workspace records" on public.workspace_records;
drop policy if exists "Verified users can read shared workspace records" on public.workspace_records;
drop policy if exists "Verified admins can add shared workspace records" on public.workspace_records;
drop policy if exists "Verified admins can update shared workspace records" on public.workspace_records;
drop policy if exists "Verified admins can delete shared workspace records" on public.workspace_records;
drop policy if exists "Authorized users can read shared workspace records" on public.workspace_records;
drop policy if exists "Admins can add shared workspace records" on public.workspace_records;
drop policy if exists "Admins can update shared workspace records" on public.workspace_records;
drop policy if exists "Admins can delete shared workspace records" on public.workspace_records;
drop policy if exists "Admins can read shared workspace records" on public.workspace_records;
drop policy if exists "Staff can read assigned training programs" on public.workspace_records;
drop policy if exists "Staff can update assigned training programs" on public.workspace_records;
drop policy if exists "Users and Admins can read shared workspace records" on public.workspace_records;
drop policy if exists "Admins and Staff can update permitted workspace records" on public.workspace_records;

create policy "Users can read own profiles; Admins can read all profiles"
  on public.user_profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or (select public.current_user_role()) = 'admin');

create policy "Admins can change account roles"
  on public.user_profiles
  for update
  to authenticated
  using ((select public.current_user_role()) = 'admin')
  with check ((select public.current_user_role()) = 'admin');

create or replace function public.current_user_owns_participant(p_participant_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_records as participant
    where participant.collection = 'participants'
      and participant.record_id = p_participant_id
      and participant.payload ->> 'userId' = (select auth.uid())::text
  )
$$;

revoke all on function public.current_user_owns_participant(text) from public, anon;
grant execute on function public.current_user_owns_participant(text) to authenticated;

create policy "Users and Admins can read shared workspace records"
  on public.workspace_records
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'admin'
    or (
      (select public.current_user_role()) = 'user'
      and collection in ('programs', 'scenarios')
    )
    or (
      (select public.current_user_role()) = 'user'
      and collection = 'participants'
      and payload ->> 'userId' = (select auth.uid())::text
    )
    or (
      (select public.current_user_role()) = 'user'
      and collection = 'evaluations'
      and (select public.current_user_owns_participant(payload ->> 'participantId'))
    )
  );

create policy "Staff can read assigned training programs"
  on public.workspace_records
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'staff'
    and collection = 'programs'
    and payload ->> 'instructorId' = (select auth.uid())::text
  );

create policy "Admins can add shared workspace records"
  on public.workspace_records
  for insert
  to authenticated
  with check ((select public.current_user_role()) = 'admin');

create policy "Admins and Staff can update permitted workspace records"
  on public.workspace_records
  for update
  to authenticated
  using (
    (select public.current_user_role()) = 'admin'
    or (
      (select public.current_user_role()) = 'staff'
      and collection = 'programs'
      and payload ->> 'instructorId' = (select auth.uid())::text
    )
  )
  with check (
    (select public.current_user_role()) = 'admin'
    or (
      (select public.current_user_role()) = 'staff'
      and collection = 'programs'
      and payload ->> 'instructorId' = (select auth.uid())::text
    )
  );

create policy "Admins can delete shared workspace records"
  on public.workspace_records
  for delete
  to authenticated
  using ((select public.current_user_role()) = 'admin');

create index if not exists workspace_records_program_instructor_idx
  on public.workspace_records ((payload ->> 'instructorId'))
  where collection = 'programs';

update public.workspace_records as participant
set payload = jsonb_set(participant.payload, '{userId}', to_jsonb(auth_user.id::text), true)
from auth.users as auth_user
join public.user_profiles as profile
  on profile.id = auth_user.id
 and profile.role = 'user'
where participant.collection = 'participants'
  and lower(participant.payload ->> 'email') = lower(auth_user.email)
  and not (participant.payload ? 'userId');

update public.workspace_records
set payload = jsonb_set(
  payload,
  '{disasterType}',
  to_jsonb(case
    when payload ->> 'type' in ('Earthquake', 'Flood', 'Fire', 'Typhoon') then payload ->> 'type'
    else 'General preparedness'
  end),
  true
)
where collection = 'programs'
  and not (payload ? 'disasterType');

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  program_id text not null,
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  email_sent_at timestamptz,
  unique (user_id, program_id)
);

alter table public.user_notifications enable row level security;

drop policy if exists "Users can read own training notifications" on public.user_notifications;
drop policy if exists "Users can update read status of own training notifications" on public.user_notifications;

create policy "Users can read own training notifications"
  on public.user_notifications
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can update read status of own training notifications"
  on public.user_notifications
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select on public.user_notifications to authenticated;
grant update (read_at) on public.user_notifications to authenticated;
grant select, insert, update on public.user_notifications to service_role;

create index if not exists user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);

create or replace function public.sync_workspace_records(p_upserts jsonb, p_deletes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  actor_role text := (select public.current_user_role());
  actor_id uuid := (select auth.uid());
  existing_record public.workspace_records%rowtype;
  program_record jsonb;
begin
  if coalesce(actor_role, '') not in ('admin', 'staff', 'user') then
    raise exception 'An active Admin, Staff, or User account is required to change workspace records.';
  end if;

  if coalesce(jsonb_typeof(p_upserts), '') <> 'array'
     or coalesce(jsonb_typeof(p_deletes), '') <> 'array' then
    raise exception 'Workspace update has an invalid shape or exceeds the allowed size.';
  end if;
  if jsonb_array_length(p_upserts) > 5000 or jsonb_array_length(p_deletes) > 5000 then
    raise exception 'Workspace update has an invalid shape or exceeds the allowed size.';
  end if;

  for item in select value from jsonb_array_elements(p_upserts)
  loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item ->> 'collection', '') not in ('programs', 'scenarios', 'participants', 'evaluations', 'reports')
       or item ->> 'record_id' is null
       or jsonb_typeof(item -> 'payload') <> 'object'
       or item -> 'payload' ->> 'id' is distinct from item ->> 'record_id' then
      raise exception 'Workspace update contains an invalid record.';
    end if;

    if actor_role = 'staff' and (
         item ->> 'collection' <> 'programs'
         or item -> 'payload' ->> 'instructorId' is distinct from actor_id::text
         or not exists (
           select 1
           from public.workspace_records as program
           where program.collection = 'programs'
             and program.record_id = item ->> 'record_id'
             and program.payload ->> 'instructorId' = actor_id::text
         )
       ) then
      raise exception 'Staff can update only existing training programs assigned to their instructor account.';
    end if;

    if actor_role = 'user' then
      if item ->> 'collection' <> 'participants'
         or item -> 'payload' ->> 'userId' is distinct from actor_id::text
         or lower(item -> 'payload' ->> 'email') is distinct from lower(auth.jwt() ->> 'email') then
        raise exception 'User accounts can manage only their own training enrollments.';
      end if;

      select * into existing_record
      from public.workspace_records
      where collection = 'participants'
        and record_id = item ->> 'record_id';

      if found then
        if existing_record.payload ->> 'userId' is distinct from actor_id::text
           or item -> 'payload' - 'status' is distinct from existing_record.payload - 'status'
           or item -> 'payload' ->> 'status' <> 'Cancelled'
           or existing_record.payload ->> 'status' not in ('Pending', 'Confirmed') then
          raise exception 'You can only cancel your own existing training enrollment.';
        end if;
      else
        if item -> 'payload' ->> 'status' <> 'Pending' then
          raise exception 'New self-enrollments must begin as pending approval.';
        end if;
        perform pg_advisory_xact_lock(hashtextextended(item -> 'payload' ->> 'programId', 0));
        select payload into program_record
        from public.workspace_records
        where collection = 'programs'
          and record_id = item -> 'payload' ->> 'programId';
        if program_record is null
           or program_record ->> 'status' <> 'Scheduled'
           or program_record ->> 'date' < current_date::text then
          raise exception 'This training session is not open for enrollment.';
        end if;
        if exists (
          select 1
          from public.workspace_records as own_enrollment
          where own_enrollment.collection = 'participants'
            and own_enrollment.payload ->> 'userId' = actor_id::text
            and own_enrollment.payload ->> 'programId' = item -> 'payload' ->> 'programId'
            and own_enrollment.payload ->> 'status' <> 'Cancelled'
        ) then
          raise exception 'You already have an active enrollment for this training session.';
        end if;
        if coalesce(program_record ->> 'capacity', '') ~ '^[0-9]+$'
           and (
             select count(*)
             from public.workspace_records as enrollment
             where enrollment.collection = 'participants'
               and enrollment.payload ->> 'programId' = item -> 'payload' ->> 'programId'
               and enrollment.payload ->> 'status' <> 'Cancelled'
           ) >= (program_record ->> 'capacity')::integer then
          raise exception 'This training session has reached its participant capacity.';
        end if;
      end if;
    end if;

    if actor_role = 'staff' then
      update public.workspace_records
      set payload = item -> 'payload',
          updated_at = now()
      where collection = 'programs'
        and record_id = item ->> 'record_id';

      if not found then
        raise exception 'The assigned training program could not be found.';
      end if;
    else
      if actor_role = 'admin'
         and item ->> 'collection' = 'programs'
         and not exists (
           select 1 from public.workspace_records as existing_program
           where existing_program.collection = 'programs'
             and existing_program.record_id = item ->> 'record_id'
         ) then
        insert into public.user_notifications (user_id, program_id, title, message)
        select profile.id,
               item ->> 'record_id',
               'New training: ' || coalesce(item -> 'payload' ->> 'title', 'Preparedness session'),
               coalesce(item -> 'payload' ->> 'disasterType', 'General preparedness')
                 || ' training on ' || coalesce(item -> 'payload' ->> 'date', 'a date to be announced')
                 || ' at ' || coalesce(item -> 'payload' ->> 'location', 'a location to be announced')
        from public.user_profiles as profile
        where profile.role = 'user'
        on conflict (user_id, program_id) do nothing;
      end if;
      insert into public.workspace_records (collection, record_id, payload, updated_at)
      values (item ->> 'collection', item ->> 'record_id', item -> 'payload', now())
      on conflict (collection, record_id) do update
        set payload = excluded.payload,
            updated_at = excluded.updated_at;
    end if;
  end loop;

  if actor_role = 'staff' and jsonb_array_length(p_deletes) > 0 then
    raise exception 'Staff cannot delete workspace records.';
  end if;

  for item in select value from jsonb_array_elements(p_deletes)
  loop
    if actor_role <> 'admin' then
      raise exception 'Only Admin accounts can delete workspace records.';
    end if;
    if jsonb_typeof(item) <> 'object'
       or coalesce(item ->> 'collection', '') not in ('programs', 'scenarios', 'participants', 'evaluations', 'reports')
       or item ->> 'record_id' is null then
      raise exception 'Workspace delete contains an invalid record.';
    end if;
    delete from public.workspace_records
    where collection = item ->> 'collection'
      and record_id = item ->> 'record_id';
  end loop;
end;
$$;

revoke insert, update, delete on public.workspace_records from authenticated;
grant select on public.workspace_records to authenticated;
revoke all on function public.sync_workspace_records(jsonb, jsonb) from public, anon;
grant execute on function public.sync_workspace_records(jsonb, jsonb) to authenticated;

create or replace function public.record_workspace_activity()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null
     or coalesce((select public.current_user_role()), '') not in ('user', 'staff', 'admin') then
    raise exception 'An active One Cainta account is required to record workspace activity.';
  end if;

  update public.user_profiles
  set last_seen_at = now()
  where id = actor_id;

  if not found then
    raise exception 'The One Cainta account profile could not be found.';
  end if;
end;
$$;

revoke all on function public.record_workspace_activity() from public, anon;
grant execute on function public.record_workspace_activity() to authenticated;
