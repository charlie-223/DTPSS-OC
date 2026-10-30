alter table public.workspace_records
  drop constraint if exists workspace_records_collection_check;

alter table public.workspace_records
  add constraint workspace_records_collection_check
  check (collection in (
    'programs',
    'scenarios',
    'participants',
    'evaluations',
    'reports',
    'materials',
    'evaluationSettings'
  ));

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
       or coalesce(item ->> 'collection', '') not in ('programs', 'scenarios', 'participants', 'evaluations', 'reports', 'materials', 'evaluationSettings')
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
       or coalesce(item ->> 'collection', '') not in ('programs', 'scenarios', 'participants', 'evaluations', 'reports', 'materials', 'evaluationSettings')
       or item ->> 'record_id' is null then
      raise exception 'Workspace delete contains an invalid record.';
    end if;
    delete from public.workspace_records
    where collection = item ->> 'collection'
      and record_id = item ->> 'record_id';
  end loop;
end;
$$;

revoke all on function public.sync_workspace_records(jsonb, jsonb) from public, anon;
grant execute on function public.sync_workspace_records(jsonb, jsonb) to authenticated;
