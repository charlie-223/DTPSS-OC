create table if not exists public.workspace_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  event_key text not null,
  entity_type text not null check (entity_type in ('program', 'scenario', 'staff-report', 'resident-feedback')),
  entity_id text not null,
  title text not null,
  message text not null,
  target_page text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  push_sent_at timestamptz,
  unique (user_id, event_key)
);

create index if not exists workspace_notifications_user_created_idx
  on public.workspace_notifications (user_id, created_at desc);

alter table public.workspace_notifications enable row level security;

drop policy if exists "Users can read own workspace notifications" on public.workspace_notifications;
create policy "Users can read own workspace notifications"
  on public.workspace_notifications
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.current_user_role()) in ('admin', 'staff', 'user')
  );

drop policy if exists "Users can update read status of own workspace notifications" on public.workspace_notifications;
create policy "Users can update read status of own workspace notifications"
  on public.workspace_notifications
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.current_user_role()) in ('admin', 'staff', 'user')
  )
  with check (
    user_id = (select auth.uid())
    and (select public.current_user_role()) in ('admin', 'staff', 'user')
  );

grant select on public.workspace_notifications to authenticated;
grant update (read_at) on public.workspace_notifications to authenticated;
grant select, insert, update on public.workspace_notifications to service_role;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 2048),
  p256dh text not null check (length(p256dh) <= 256),
  auth text not null check (length(auth) <= 256),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users can manage own push subscriptions" on public.push_subscriptions;
create policy "Users can manage own push subscriptions"
  on public.push_subscriptions
  for all
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.current_user_role()) in ('staff', 'user')
  )
  with check (
    user_id = (select auth.uid())
    and (select public.current_user_role()) in ('staff', 'user')
  );

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, delete on public.push_subscriptions to service_role;

create or replace function public.create_workspace_notification(
  p_user_id uuid,
  p_event_key text,
  p_entity_type text,
  p_entity_id text,
  p_title text,
  p_message text,
  p_target_page text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.workspace_notifications (
    user_id, event_key, entity_type, entity_id, title, message, target_page
  )
  values (
    p_user_id, p_event_key, p_entity_type, p_entity_id, p_title, p_message, p_target_page
  )
  on conflict (user_id, event_key) do nothing
$$;

revoke all on function public.create_workspace_notification(uuid, text, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.notify_workspace_record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_key text;
  entity_title text;
  entity_message text;
  target_page text;
  recipient record;
begin
  if tg_op = 'UPDATE' and new.payload is not distinct from old.payload then
    return new;
  end if;

  event_key := new.collection || ':' || new.record_id || ':' || md5(new.payload::text);

  if new.collection = 'programs' then
    if coalesce(new.payload ->> 'status', '') <> 'Scheduled' then
      return new;
    end if;
    entity_title := 'Training program: ' || coalesce(new.payload ->> 'title', 'Preparedness session');
    entity_message := concat_ws(
      ' · ',
      coalesce(new.payload ->> 'disasterType', 'General preparedness'),
      nullif(new.payload ->> 'date', ''),
      nullif(new.payload ->> 'time', ''),
      nullif(new.payload ->> 'location', '')
    );
    for recipient in
      select profile.id, profile.role
      from public.user_profiles as profile
      where profile.role in ('admin', 'user')
         or (
           profile.role = 'staff'
           and profile.id::text = new.payload ->> 'instructorId'
         )
    loop
      target_page := case recipient.role
        when 'admin' then 'programs'
        when 'staff' then 'programs'
        else 'browse-drills'
      end;
      perform public.create_workspace_notification(
        recipient.id, event_key, 'program', new.record_id,
        entity_title, entity_message, target_page
      );
    end loop;
  elsif new.collection = 'scenarios' then
    entity_title := 'Simulation scenario: ' || coalesce(new.payload ->> 'title', 'New preparedness scenario');
    entity_message := concat_ws(
      ' · ',
      coalesce(new.payload ->> 'hazard', 'Preparedness exercise'),
      nullif(new.payload ->> 'severity', ''),
      nullif(new.payload ->> 'affectedZone', '')
    );
    for recipient in
      select profile.id, profile.role
      from public.user_profiles as profile
      where profile.role in ('admin', 'user')
         or (
           profile.role = 'staff'
           and exists (
             select 1
             from public.workspace_records as program
             where program.collection = 'programs'
               and program.payload ->> 'scenarioId' = new.record_id
               and program.payload ->> 'instructorId' = profile.id::text
           )
         )
    loop
      target_page := case recipient.role
        when 'admin' then 'scenarios'
        when 'staff' then 'scenarios'
        else 'browse-drills'
      end;
      perform public.create_workspace_notification(
        recipient.id, event_key, 'scenario', new.record_id,
        entity_title, entity_message, target_page
      );
    end loop;
  elsif new.collection = 'staffActivities'
        and new.payload ->> 'operationType' in ('Field incident', 'Headcount & AAR') then
    entity_title := coalesce(
      nullif(new.payload ->> 'operationType', ''),
      'Staff field report'
    ) || ': ' || coalesce(new.payload ->> 'attendeeName', 'Assigned session');
    entity_message := coalesce(
      nullif(new.payload ->> 'details', ''),
      nullif(new.payload ->> 'aarNotes', ''),
      'A Staff field update was submitted.'
    );
    for recipient in
      select profile.id
      from public.user_profiles as profile
      where profile.role = 'admin'
    loop
      perform public.create_workspace_notification(
        recipient.id, event_key, 'staff-report', new.record_id,
        entity_title, entity_message, 'reports'
      );
    end loop;
  elsif new.collection = 'trainingFeedback' then
    entity_title := 'Resident instructor evaluation received';
    entity_message := 'A resident submitted a ' || coalesce(new.payload ->> 'rating', 'new') || '-star session rating.';
    for recipient in
      select profile.id, profile.role
      from public.user_profiles as profile
      where profile.role = 'admin'
         or (
           profile.role = 'staff'
           and profile.id::text = new.payload ->> 'instructorId'
         )
    loop
      target_page := 'evaluations';
      perform public.create_workspace_notification(
        recipient.id, event_key, 'resident-feedback', new.record_id,
        entity_title, entity_message, target_page
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_workspace_record_change on public.workspace_records;
create trigger notify_workspace_record_change
  after insert or update on public.workspace_records
  for each row
  when (new.collection in ('programs', 'scenarios', 'staffActivities', 'trainingFeedback'))
  execute function public.notify_workspace_record_change();
