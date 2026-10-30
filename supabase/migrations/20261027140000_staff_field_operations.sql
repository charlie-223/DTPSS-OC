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
    'evaluationSettings',
    'staffActivities'
  ));

create or replace function public.staff_has_assigned_program(p_program_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_records as program
    where program.collection = 'programs'
      and program.record_id = p_program_id
      and program.payload ->> 'instructorId' = (select auth.uid())::text
  )
$$;

create or replace function public.staff_can_read_assigned_participant(p_program_id text, p_zone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_records as program
    where program.collection = 'programs'
      and program.record_id = p_program_id
      and program.payload ->> 'instructorId' = (select auth.uid())::text
      and (
        coalesce(program.payload ->> 'zone', '') = ''
        or p_zone = program.payload ->> 'zone'
      )
  )
$$;

create or replace function public.staff_has_assigned_scenario(p_scenario_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_records as program
    where program.collection = 'programs'
      and program.payload ->> 'scenarioId' = p_scenario_id
      and program.payload ->> 'instructorId' = (select auth.uid())::text
  )
$$;

revoke all on function public.staff_has_assigned_program(text) from public, anon;
revoke all on function public.staff_can_read_assigned_participant(text, text) from public, anon;
revoke all on function public.staff_has_assigned_scenario(text) from public, anon;
grant execute on function public.staff_has_assigned_program(text) to authenticated;
grant execute on function public.staff_can_read_assigned_participant(text, text) to authenticated;
grant execute on function public.staff_has_assigned_scenario(text) to authenticated;

drop policy if exists "Staff can read assigned session participants" on public.workspace_records;
create policy "Staff can read assigned session participants"
  on public.workspace_records
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'staff'
    and collection = 'participants'
    and (select public.staff_can_read_assigned_participant(payload ->> 'programId', payload ->> 'zone'))
  );

drop policy if exists "Staff can read assigned session scenarios" on public.workspace_records;
create policy "Staff can read assigned session scenarios"
  on public.workspace_records
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'staff'
    and collection = 'scenarios'
    and (select public.staff_has_assigned_scenario(record_id))
  );

drop policy if exists "Staff can read own assigned field operation records" on public.workspace_records;
create policy "Staff can read own assigned field operation records"
  on public.workspace_records
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'staff'
    and collection = 'staffActivities'
    and payload ->> 'instructorId' = (select auth.uid())::text
    and (select public.staff_has_assigned_program(payload ->> 'programId'))
  );

create or replace function public.prevent_staff_assignment_scope_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.collection = 'programs'
     and (select public.current_user_role()) = 'staff'
     and (
       new.payload ->> 'zone' is distinct from old.payload ->> 'zone'
       or new.payload ->> 'scenarioId' is distinct from old.payload ->> 'scenarioId'
     ) then
    raise exception 'Staff cannot change the assigned zone or simulation scenario.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_staff_assignment_scope_changes on public.workspace_records;
create trigger prevent_staff_assignment_scope_changes
  before update on public.workspace_records
  for each row
  execute function public.prevent_staff_assignment_scope_changes();

revoke all on function public.prevent_staff_assignment_scope_changes() from public, anon;

create or replace function public.sync_staff_operations(p_upserts jsonb, p_deletes jsonb)
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
  participant_record public.workspace_records%rowtype;
  program_record jsonb;
  walk_in_participant_id text;
  activity_exists boolean;
  walk_in_resident jsonb;
begin
  if coalesce(actor_role, '') not in ('admin', 'staff') then
    raise exception 'An active Admin or Staff account is required to manage field operation records.';
  end if;

  if coalesce(jsonb_typeof(p_upserts), '') <> 'array'
     or coalesce(jsonb_typeof(p_deletes), '') <> 'array'
     or jsonb_array_length(p_upserts) > 5000
     or jsonb_array_length(p_deletes) > 5000 then
    raise exception 'Field operation update has an invalid shape or exceeds the allowed size.';
  end if;

  for item in select value from jsonb_array_elements(p_upserts)
  loop
    if jsonb_typeof(item) <> 'object'
       or item ->> 'record_id' is null
       or jsonb_typeof(item -> 'payload') <> 'object'
       or item -> 'payload' ->> 'id' is distinct from item ->> 'record_id'
       or coalesce(item -> 'payload' ->> 'operationType', '') not in (
         'Attendance check-in',
         'Walk-in registration',
         'Scenario control',
         'Facilitator intervention',
         'Simulation response',
         'Instructor self-assessment',
         'Peer review',
         'Field incident',
         'Headcount & AAR'
       )
       or item -> 'payload' ->> 'programId' is null then
      raise exception 'Field operation update contains an invalid record.';
    end if;

    if not exists (
      select 1
      from public.workspace_records as program
      where program.collection = 'programs'
        and program.record_id = item -> 'payload' ->> 'programId'
        and (
          actor_role = 'admin'
          or program.payload ->> 'instructorId' = actor_id::text
        )
    ) then
      raise exception 'Field operation records must belong to a valid session assigned to the Staff account.';
    end if;

    select * into existing_record
    from public.workspace_records
    where collection = 'staffActivities'
      and record_id = item ->> 'record_id';
    activity_exists := found;

    if actor_role = 'staff' then
      if item -> 'payload' ->> 'instructorId' is distinct from actor_id::text then
        raise exception 'Staff can write only their own field operation records.';
      end if;

      if activity_exists and (
        existing_record.payload ->> 'instructorId' is distinct from actor_id::text
        or existing_record.payload ->> 'programId' is distinct from item -> 'payload' ->> 'programId'
        or existing_record.payload ->> 'operationType' is distinct from item -> 'payload' ->> 'operationType'
      ) then
        raise exception 'Staff can update only their own records for the original assigned session.';
      end if;
    end if;

    if item -> 'payload' ->> 'operationType' = 'Walk-in registration' then
      walk_in_participant_id := item -> 'payload' ->> 'walkInParticipantId';
      if coalesce(walk_in_participant_id, '') = ''
         or coalesce(item -> 'payload' ->> 'attendeeName', '') = ''
         or coalesce(item -> 'payload' ->> 'phone', '') = ''
         or coalesce(item -> 'payload' ->> 'zone', '') = ''
         or coalesce(item -> 'payload' ->> 'attendeeGender', '') not in ('Female', 'Male', 'Another identity', 'Prefer not to say') then
        raise exception 'Walk-in registration requires a name, phone, gender selection, zone, and participant record ID.';
      end if;
      if activity_exists
         and existing_record.payload ->> 'operationType' = 'Walk-in registration'
         and existing_record.payload ->> 'walkInParticipantId' is distinct from walk_in_participant_id then
        raise exception 'The participant linked to a walk-in registration cannot be changed.';
      end if;

      select payload into program_record
      from public.workspace_records
      where collection = 'programs'
        and record_id = item -> 'payload' ->> 'programId';

      if program_record ->> 'status' <> 'Scheduled'
         or program_record ->> 'date' < current_date::text then
        raise exception 'Walk-in registration is available only for upcoming scheduled sessions.';
      end if;

      if not activity_exists and exists (
        select 1
        from public.workspace_records
        where collection = 'participants'
          and record_id = walk_in_participant_id
      ) then
        raise exception 'The walk-in participant ID is already in use.';
      end if;

      select * into participant_record
      from public.workspace_records
      where collection = 'participants'
        and record_id = walk_in_participant_id;
      if found and (
        participant_record.payload ->> 'programId' is distinct from item -> 'payload' ->> 'programId'
        or participant_record.payload ->> 'userId' is not null
      ) then
        raise exception 'The walk-in participant record does not belong to this session.';
      end if;

      if not activity_exists then
        perform pg_advisory_xact_lock(hashtextextended(item -> 'payload' ->> 'programId', 0));
        if coalesce(program_record ->> 'capacity', '') ~ '^[0-9]+$'
           and (
             select count(*)
             from public.workspace_records as enrollment
             where enrollment.collection = 'participants'
               and enrollment.payload ->> 'programId' = item -> 'payload' ->> 'programId'
               and enrollment.payload ->> 'status' = 'Confirmed'
           ) >= (program_record ->> 'capacity')::integer then
          raise exception 'This training session has reached its participant capacity.';
        end if;
      end if;

      walk_in_resident := jsonb_build_object(
        'id', walk_in_participant_id,
        'name', item -> 'payload' ->> 'attendeeName',
        'age', case
          when coalesce(item -> 'payload' ->> 'attendeeAge', '') ~ '^[0-9]+$'
          then to_jsonb((item -> 'payload' ->> 'attendeeAge')::integer)
          else 'null'::jsonb
        end,
        'gender', item -> 'payload' ->> 'attendeeGender',
        'email', coalesce(item -> 'payload' ->> 'email', ''),
        'phone', item -> 'payload' ->> 'phone',
        'address', coalesce(item -> 'payload' ->> 'attendeeAddress', ''),
        'zone', item -> 'payload' ->> 'zone',
        'barangay', coalesce(program_record ->> 'barangay', ''),
        'municipality', 'Cainta',
        'province', 'Rizal',
        'participantType', 'Ordinary Resident',
        'specialNeeds', case
          when jsonb_typeof(item -> 'payload' -> 'specialNeeds') = 'array'
          then item -> 'payload' -> 'specialNeeds'
          else '[]'::jsonb
        end,
        'specialNeedsNotes', '',
        'programId', item -> 'payload' ->> 'programId',
        'status', 'Confirmed',
        'emergencyContact', '',
        'registeredAt', current_date::text
      );

      insert into public.workspace_records (collection, record_id, payload, updated_at)
      values ('participants', walk_in_participant_id, walk_in_resident, now())
      on conflict (collection, record_id) do update
        set payload = excluded.payload,
            updated_at = excluded.updated_at;
    end if;

    if nullif(item -> 'payload' ->> 'scenarioId', '') is not null
       and not exists (
         select 1
         from public.workspace_records as program
         where program.collection = 'programs'
           and program.record_id = item -> 'payload' ->> 'programId'
           and program.payload ->> 'scenarioId' = item -> 'payload' ->> 'scenarioId'
           and (actor_role = 'admin' or program.payload ->> 'instructorId' = actor_id::text)
       ) then
      raise exception 'The selected scenario is not assigned to this training session.';
    end if;

    if item -> 'payload' ->> 'operationType' = 'Walk-in registration'
       and exists (
         select 1
         from public.workspace_records as program
         where program.collection = 'programs'
           and program.record_id = item -> 'payload' ->> 'programId'
           and coalesce(program.payload ->> 'zone', '') <> ''
           and item -> 'payload' ->> 'zone' is distinct from program.payload ->> 'zone'
       ) then
      raise exception 'Walk-in registrations must be recorded in the Staff account assigned zone.';
    end if;

    if nullif(item -> 'payload' ->> 'participantId', '') is not null
       and not exists (
         select 1
         from public.workspace_records as participant
         join public.workspace_records as program
           on program.collection = 'programs'
          and program.record_id = item -> 'payload' ->> 'programId'
         where participant.collection = 'participants'
           and participant.record_id = item -> 'payload' ->> 'participantId'
           and participant.payload ->> 'programId' = item -> 'payload' ->> 'programId'
           and (
             coalesce(program.payload ->> 'zone', '') = ''
             or participant.payload ->> 'zone' = program.payload ->> 'zone'
           )
       ) then
      raise exception 'The selected participant is not enrolled in this training session.';
    end if;

    insert into public.workspace_records (collection, record_id, payload, updated_at)
    values ('staffActivities', item ->> 'record_id', item -> 'payload', now())
    on conflict (collection, record_id) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at;
  end loop;

  if actor_role <> 'admin' and jsonb_array_length(p_deletes) > 0 then
    raise exception 'Only Admin accounts can delete field operation records.';
  end if;

  for item in select value from jsonb_array_elements(p_deletes)
  loop
    if jsonb_typeof(item) <> 'object' or item ->> 'record_id' is null then
      raise exception 'Field operation delete contains an invalid record.';
    end if;
    delete from public.workspace_records
    where collection = 'staffActivities'
      and record_id = item ->> 'record_id';
  end loop;
end;
$$;

revoke all on function public.sync_staff_operations(jsonb, jsonb) from public, anon;
grant execute on function public.sync_staff_operations(jsonb, jsonb) to authenticated;
