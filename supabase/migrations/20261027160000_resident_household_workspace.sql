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
    'staffActivities',
    'trainingFeedback',
    'residentHouseholds',
    'residentCheckins'
  ));

drop policy if exists "Residents can read own household and safety records" on public.workspace_records;
create policy "Residents can read own household and safety records"
  on public.workspace_records
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'user'
    and collection in ('residentHouseholds', 'residentCheckins')
    and payload ->> 'userId' = (select auth.uid())::text
  );

create or replace function public.sync_resident_workspace(p_upserts jsonb, p_deletes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  actor_role text := (select public.current_user_role());
  actor_id uuid := (select auth.uid());
  actor_email text := (select auth.jwt() ->> 'email');
  safe_payload jsonb;
  household_age integer;
  household_member_count integer;
  valid_needs text[] := array[
    'Senior citizen',
    'Person with disability',
    'Pregnant',
    'Serious medical condition'
  ];
  valid_checklist text[] := array[
    'water',
    'food',
    'first-aid',
    'light',
    'documents',
    'power',
    'clothing',
    'contacts',
    'routes',
    'needs'
  ];
  valid_lessons text[] := array['earthquake', 'fire', 'flood-typhoon'];
begin
  if actor_role <> 'user' or actor_id is null then
    raise exception 'An authenticated Resident account is required to manage household safety records.';
  end if;
  if coalesce(jsonb_typeof(p_upserts), '') <> 'array'
     or coalesce(jsonb_typeof(p_deletes), '') <> 'array' then
    raise exception 'Resident workspace update has an invalid shape.';
  end if;
  if jsonb_array_length(p_upserts) > 20
     or jsonb_array_length(p_deletes) > 0 then
    raise exception 'Resident workspace update has an invalid shape or exceeds the allowed size.';
  end if;

  for item in select value from jsonb_array_elements(p_upserts)
  loop
    if jsonb_typeof(item) <> 'object'
       or item ->> 'record_id' is distinct from actor_id::text
       or jsonb_typeof(item -> 'payload') <> 'object'
       or item -> 'payload' ->> 'id' is distinct from actor_id::text
       or item -> 'payload' ->> 'userId' is distinct from actor_id::text
       or coalesce(item ->> 'collection', '') not in ('residentHouseholds', 'residentCheckins') then
      raise exception 'Resident workspace update contains an invalid owner or record.';
    end if;

    if item ->> 'collection' = 'residentCheckins' then
      if coalesce(item -> 'payload' ->> 'status', '') not in ('Safe', 'Needs Assistance', 'Evacuated') then
        raise exception 'Choose Safe, Needs Assistance, or Evacuated as your household status.';
      end if;
      safe_payload := jsonb_build_object(
        'id', actor_id::text,
        'userId', actor_id::text,
        'status', item -> 'payload' ->> 'status',
        'updatedAt', now()
      );
    else
      household_age := case
        when coalesce(item -> 'payload' ->> 'age', '') ~ '^[0-9]{1,3}$'
          then (item -> 'payload' ->> 'age')::integer
        else null
      end;
      household_member_count := case
        when coalesce(item -> 'payload' ->> 'householdMembers', '') ~ '^[0-9]{1,2}$'
          then (item -> 'payload' ->> 'householdMembers')::integer
        else null
      end;
      if coalesce(item -> 'payload' ->> 'name', '') = ''
         or length(item -> 'payload' ->> 'name') > 100
         or (
           coalesce(item -> 'payload' ->> 'age', '') <> ''
           and (household_age is null or household_age not between 1 and 120)
         )
         or (coalesce(item -> 'payload' ->> 'gender', '') <> ''
           and item -> 'payload' ->> 'gender' not in ('Female', 'Male', 'Another identity', 'Prefer not to say'))
         or length(coalesce(item -> 'payload' ->> 'phone', '')) > 30
         or length(coalesce(item -> 'payload' ->> 'address', '')) > 200
         or length(coalesce(item -> 'payload' ->> 'zone', '')) > 100
         or length(coalesce(item -> 'payload' ->> 'barangay', '')) > 100
         or household_member_count is null
         or household_member_count not between 1 and 30
         or length(coalesce(item -> 'payload' ->> 'emergencyContact', '')) > 150
         or length(coalesce(item -> 'payload' ->> 'assistanceNotes', '')) > 300 then
        raise exception 'Household profile contains missing or invalid personal details.';
      end if;
      if coalesce(jsonb_typeof(item -> 'payload' -> 'specialNeeds'), '') <> 'array'
         or coalesce(jsonb_typeof(item -> 'payload' -> 'checklist'), '') <> 'array'
         or coalesce(jsonb_typeof(item -> 'payload' -> 'completedLessons'), '') <> 'array' then
        raise exception 'Household assistance, checklist, or lesson records must be arrays.';
      end if;
      if jsonb_array_length(item -> 'payload' -> 'specialNeeds') > 4
         or jsonb_array_length(item -> 'payload' -> 'checklist') > 10
         or jsonb_array_length(item -> 'payload' -> 'completedLessons') > 3 then
        raise exception 'Household assistance, checklist, or lesson record exceeds the allowed size.';
      end if;
      if exists (
           select 1
           from jsonb_array_elements_text(item -> 'payload' -> 'specialNeeds') as entries(item_value)
           where item_value is null or item_value <> all(valid_needs)
         )
         or exists (
           select 1
           from jsonb_array_elements_text(item -> 'payload' -> 'checklist') as entries(item_value)
           where item_value is null or item_value <> all(valid_checklist)
         )
         or exists (
           select 1
           from jsonb_array_elements_text(item -> 'payload' -> 'completedLessons') as entries(item_value)
           where item_value is null or item_value <> all(valid_lessons)
         ) then
        raise exception 'Household assistance, checklist, or lesson records contain unsupported values.';
      end if;

      safe_payload := jsonb_build_object(
        'id', actor_id::text,
        'userId', actor_id::text,
        'name', item -> 'payload' ->> 'name',
        'age', case
          when coalesce(item -> 'payload' ->> 'age', '') ~ '^[0-9]{1,3}$'
          then to_jsonb((item -> 'payload' ->> 'age')::integer)
          else 'null'::jsonb
        end,
        'gender', coalesce(item -> 'payload' ->> 'gender', ''),
        'phone', coalesce(item -> 'payload' ->> 'phone', ''),
        'email', coalesce(actor_email, ''),
        'address', coalesce(item -> 'payload' ->> 'address', ''),
        'barangay', coalesce(item -> 'payload' ->> 'barangay', ''),
        'zone', coalesce(item -> 'payload' ->> 'zone', ''),
        'municipality', 'Cainta',
        'province', 'Rizal',
        'householdMembers', household_member_count,
        'specialNeeds', item -> 'payload' -> 'specialNeeds',
        'assistanceNotes', coalesce(item -> 'payload' ->> 'assistanceNotes', ''),
        'emergencyContact', coalesce(item -> 'payload' ->> 'emergencyContact', ''),
        'checklist', item -> 'payload' -> 'checklist',
        'completedLessons', item -> 'payload' -> 'completedLessons',
        'updatedAt', now()
      );
    end if;

    insert into public.workspace_records (collection, record_id, payload, updated_at)
    values (item ->> 'collection', actor_id::text, safe_payload, now())
    on conflict (collection, record_id) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at;

    if item ->> 'collection' = 'residentHouseholds' then
      update public.workspace_records as participant
      set payload = participant.payload || jsonb_build_object(
            'name', safe_payload ->> 'name',
            'age', safe_payload -> 'age',
            'gender', safe_payload ->> 'gender',
            'phone', safe_payload ->> 'phone',
            'email', safe_payload ->> 'email',
            'address', safe_payload ->> 'address',
            'barangay', safe_payload ->> 'barangay',
            'zone', safe_payload ->> 'zone',
            'municipality', safe_payload ->> 'municipality',
            'province', safe_payload ->> 'province',
            'specialNeeds', safe_payload -> 'specialNeeds',
            'specialNeedsNotes', safe_payload ->> 'assistanceNotes'
          ),
          updated_at = now()
      where participant.collection = 'participants'
        and participant.payload ->> 'userId' = actor_id::text;
    end if;
  end loop;
end;
$$;

revoke all on function public.sync_resident_workspace(jsonb, jsonb) from public, anon;
grant execute on function public.sync_resident_workspace(jsonb, jsonb) to authenticated;
