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
    'trainingFeedback'
  ));

create policy "Users can read their own training feedback"
  on public.workspace_records
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'user'
    and collection = 'trainingFeedback'
    and payload ->> 'userId' = (select auth.uid())::text
  );

create policy "Staff can read assigned training feedback"
  on public.workspace_records
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'staff'
    and collection = 'trainingFeedback'
    and payload ->> 'instructorId' = (select auth.uid())::text
    and (select public.staff_has_assigned_program(payload ->> 'programId'))
  );

create index if not exists workspace_records_training_feedback_program_idx
  on public.workspace_records ((payload ->> 'programId'), (payload ->> 'instructorId'))
  where collection = 'trainingFeedback';

create unique index if not exists workspace_records_training_feedback_user_program_idx
  on public.workspace_records ((payload ->> 'userId'), (payload ->> 'programId'))
  where collection = 'trainingFeedback';

create or replace function public.sync_training_feedback(p_upserts jsonb, p_deletes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  actor_role text := (select public.current_user_role());
  actor_id uuid := (select auth.uid());
  participant_record public.workspace_records%rowtype;
  program_record public.workspace_records%rowtype;
  existing_record public.workspace_records%rowtype;
  safe_payload jsonb;
begin
  if coalesce(actor_role, '') not in ('user', 'admin') then
    raise exception 'An active Resident or Admin account is required to manage training feedback.';
  end if;
  if coalesce(jsonb_typeof(p_upserts), '') <> 'array'
     or coalesce(jsonb_typeof(p_deletes), '') <> 'array'
     or jsonb_array_length(p_upserts) > 5000
     or jsonb_array_length(p_deletes) > 5000 then
    raise exception 'Training feedback update has an invalid shape or exceeds the allowed size.';
  end if;
  if actor_role = 'admin' and jsonb_array_length(p_upserts) > 0 then
    raise exception 'Admin accounts can review or remove feedback but cannot submit resident ratings.';
  end if;
  if actor_role = 'user' and jsonb_array_length(p_deletes) > 0 then
    raise exception 'Resident accounts cannot delete submitted training feedback.';
  end if;

  for item in select value from jsonb_array_elements(p_upserts)
  loop
    if actor_role <> 'user'
       or jsonb_typeof(item) <> 'object'
       or item ->> 'record_id' is null
       or jsonb_typeof(item -> 'payload') <> 'object'
       or item -> 'payload' ->> 'id' is distinct from item ->> 'record_id'
       or coalesce(item -> 'payload' ->> 'programId', '') = ''
       or coalesce(item -> 'payload' ->> 'participantId', '') = ''
       or coalesce(item -> 'payload' ->> 'rating', '') !~ '^[1-5]$'
       or btrim(coalesce(item -> 'payload' ->> 'comment', '')) = ''
       or length(coalesce(item -> 'payload' ->> 'comment', '')) > 1000 then
      raise exception 'Training feedback update contains an invalid rating or record.';
    end if;

    select * into participant_record
    from public.workspace_records
    where collection = 'participants'
      and record_id = item -> 'payload' ->> 'participantId';
    if not found
       or participant_record.payload ->> 'userId' is distinct from actor_id::text
       or participant_record.payload ->> 'programId' is distinct from item -> 'payload' ->> 'programId'
       or participant_record.payload ->> 'status' <> 'Confirmed' then
      raise exception 'Feedback can be submitted only for your confirmed training enrollment.';
    end if;

    select * into program_record
    from public.workspace_records
    where collection = 'programs'
      and record_id = item -> 'payload' ->> 'programId';
    if not found
       or program_record.payload ->> 'status' <> 'Completed'
       or coalesce(program_record.payload ->> 'instructorId', '') = '' then
      raise exception 'Feedback is available only after a completed session with an assigned instructor.';
    end if;

    select * into existing_record
    from public.workspace_records
    where collection = 'trainingFeedback'
      and record_id = item ->> 'record_id';
    if found and (
      existing_record.payload ->> 'userId' is distinct from actor_id::text
      or existing_record.payload ->> 'programId' is distinct from item -> 'payload' ->> 'programId'
      or existing_record.payload ->> 'participantId' is distinct from item -> 'payload' ->> 'participantId'
    ) then
      raise exception 'You can update only your existing feedback for the original session.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
      actor_id::text || ':' || program_record.record_id,
      0
    ));

    if exists (
      select 1
      from public.workspace_records as feedback
      where feedback.collection = 'trainingFeedback'
        and feedback.record_id <> item ->> 'record_id'
        and feedback.payload ->> 'userId' = actor_id::text
        and feedback.payload ->> 'programId' = item -> 'payload' ->> 'programId'
    ) then
      raise exception 'You have already submitted feedback for this training session.';
    end if;

    safe_payload := jsonb_build_object(
      'id', item ->> 'record_id',
      'userId', actor_id::text,
      'participantId', participant_record.record_id,
      'programId', program_record.record_id,
      'instructorId', program_record.payload ->> 'instructorId',
      'rating', (item -> 'payload' ->> 'rating')::integer,
      'comment', coalesce(item -> 'payload' ->> 'comment', ''),
      'date', current_date::text
    );

    insert into public.workspace_records (collection, record_id, payload, updated_at)
    values ('trainingFeedback', item ->> 'record_id', safe_payload, now())
    on conflict (collection, record_id) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at;
  end loop;

  for item in select value from jsonb_array_elements(p_deletes)
  loop
    if actor_role <> 'admin'
       or jsonb_typeof(item) <> 'object'
       or item ->> 'record_id' is null then
      raise exception 'Only Admin accounts can remove a valid training feedback record.';
    end if;
    delete from public.workspace_records
    where collection = 'trainingFeedback'
      and record_id = item ->> 'record_id';
  end loop;
end;
$$;

revoke all on function public.sync_training_feedback(jsonb, jsonb) from public, anon;
grant execute on function public.sync_training_feedback(jsonb, jsonb) to authenticated;
