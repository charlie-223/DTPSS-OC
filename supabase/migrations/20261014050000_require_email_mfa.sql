create table if not exists public.email_mfa_challenges (
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  last_sent_at timestamptz not null default now(),
  verified_at timestamptz,
  primary key (user_id, session_id)
);

alter table public.email_mfa_challenges enable row level security;
revoke all on public.email_mfa_challenges from public, anon, authenticated;
grant select, insert, update, delete on public.email_mfa_challenges to service_role;

create or replace function public.current_session_email_mfa_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.email_mfa_challenges as challenge
    where challenge.user_id = (select auth.uid())
      and challenge.session_id::text = (select auth.jwt() ->> 'session_id')
      and challenge.verified_at is not null
      and (select auth.jwt() -> 'amr') @> '[{"method":"password"}]'::jsonb
      and exists (
        select 1
        from auth.sessions as auth_session
        where auth_session.id = challenge.session_id
          and auth_session.user_id = challenge.user_id
      )
  )
$$;

revoke all on function public.current_session_email_mfa_verified() from public, anon;
grant execute on function public.current_session_email_mfa_verified() to authenticated;

create or replace function public.request_email_mfa_code(
  p_user_id uuid,
  p_session_id uuid,
  p_otp_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_challenge public.email_mfa_challenges%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  delete from public.email_mfa_challenges
  where last_sent_at < now() - interval '90 days';

  select * into previous_challenge
  from public.email_mfa_challenges
  where user_id = p_user_id and session_id = p_session_id
  for update;

  if found and previous_challenge.verified_at is not null then
    return false;
  end if;
  if found and previous_challenge.last_sent_at > now() - interval '60 seconds' then
    raise exception 'Please wait before requesting another email code.';
  end if;
  if (
    select count(*)
    from public.email_mfa_challenges
    where user_id = p_user_id
      and last_sent_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'Too many email security codes requested.';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '10 minutes' then
    raise exception 'The email code expiry is invalid.';
  end if;

  insert into public.email_mfa_challenges (user_id, session_id, otp_hash, expires_at, attempts, last_sent_at, verified_at)
  values (p_user_id, p_session_id, p_otp_hash, p_expires_at, 0, now(), null)
  on conflict (user_id, session_id) do update
    set otp_hash = excluded.otp_hash,
        expires_at = excluded.expires_at,
        attempts = 0,
        last_sent_at = now(),
        verified_at = null;

  return true;
end;
$$;

create or replace function public.verify_email_mfa_code(
  p_user_id uuid,
  p_session_id uuid,
  p_otp_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenge public.email_mfa_challenges%rowtype;
begin
  select * into challenge
  from public.email_mfa_challenges
  where user_id = p_user_id and session_id = p_session_id
  for update;

  if not found or challenge.verified_at is not null
     or challenge.expires_at <= now() or challenge.attempts >= 5 then
    return false;
  end if;

  if challenge.otp_hash <> p_otp_hash then
    update public.email_mfa_challenges
    set attempts = attempts + 1
    where user_id = p_user_id and session_id = p_session_id;
    return false;
  end if;

  update public.email_mfa_challenges
  set verified_at = now()
  where user_id = p_user_id and session_id = p_session_id;

  return true;
end;
$$;

revoke all on function public.request_email_mfa_code(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.verify_email_mfa_code(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.request_email_mfa_code(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.verify_email_mfa_code(uuid, uuid, text) to service_role;

drop policy if exists "AAL2 profile read access" on public.user_profiles;
drop policy if exists "AAL2 Super Admin profile updates" on public.user_profiles;
drop policy if exists "AAL2 users can read shared workspace records" on public.workspace_records;
drop policy if exists "AAL2 admins can add shared workspace records" on public.workspace_records;
drop policy if exists "AAL2 admins can update shared workspace records" on public.workspace_records;
drop policy if exists "AAL2 admins can delete shared workspace records" on public.workspace_records;
drop policy if exists "Users can read their own profile; Super Admins can read all profiles"
  on public.user_profiles;
create policy "Verified users can read their own profile; Super Admins can read all profiles"
  on public.user_profiles
  for select
  to authenticated
  using (
    (select public.current_session_email_mfa_verified())
    and (
      id = (select auth.uid())
      or (select public.current_user_role()) = 'super_admin'
    )
  );

drop policy if exists "Only Super Admins can change administrator profiles"
  on public.user_profiles;
create policy "Verified Super Admins can change administrator profiles"
  on public.user_profiles
  for update
  to authenticated
  using (
    (select public.current_session_email_mfa_verified())
    and (select public.current_user_role()) = 'super_admin'
  )
  with check (
    (select public.current_session_email_mfa_verified())
    and (select public.current_user_role()) = 'super_admin'
  );

drop policy if exists "Authorized users can read shared workspace records"
  on public.workspace_records;
create policy "Verified users can read shared workspace records"
  on public.workspace_records
  for select
  to authenticated
  using (
    (select public.current_session_email_mfa_verified())
    and (select public.current_user_role()) in ('user', 'admin', 'super_admin')
  );

drop policy if exists "Admins can add shared workspace records"
  on public.workspace_records;
create policy "Verified admins can add shared workspace records"
  on public.workspace_records
  for insert
  to authenticated
  with check (
    (select public.current_session_email_mfa_verified())
    and (select public.current_user_role()) in ('admin', 'super_admin')
  );

drop policy if exists "Admins can update shared workspace records"
  on public.workspace_records;
create policy "Verified admins can update shared workspace records"
  on public.workspace_records
  for update
  to authenticated
  using (
    (select public.current_session_email_mfa_verified())
    and (select public.current_user_role()) in ('admin', 'super_admin')
  )
  with check (
    (select public.current_session_email_mfa_verified())
    and (select public.current_user_role()) in ('admin', 'super_admin')
  );

drop policy if exists "Admins can delete shared workspace records"
  on public.workspace_records;
create policy "Verified admins can delete shared workspace records"
  on public.workspace_records
  for delete
  to authenticated
  using (
    (select public.current_session_email_mfa_verified())
    and (select public.current_user_role()) in ('admin', 'super_admin')
  );

create or replace function public.sync_workspace_records(p_upserts jsonb, p_deletes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
begin
  if not (select public.current_session_email_mfa_verified()) then
    raise exception 'Verify the email security code before accessing workspace records.';
  end if;
  if (select public.current_user_role()) not in ('admin', 'super_admin') then
    raise exception 'An active ReadyPH administrator role is required.';
  end if;

  if coalesce(jsonb_typeof(p_upserts), '') <> 'array'
     or coalesce(jsonb_typeof(p_deletes), '') <> 'array'
     or jsonb_array_length(p_upserts) > 5000 or jsonb_array_length(p_deletes) > 5000 then
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
    insert into public.workspace_records (collection, record_id, payload, updated_at)
    values (item ->> 'collection', item ->> 'record_id', item -> 'payload', now())
    on conflict (collection, record_id) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at;
  end loop;

  for item in select value from jsonb_array_elements(p_deletes)
  loop
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

revoke all on function public.sync_workspace_records(jsonb, jsonb) from public, anon;
grant execute on function public.sync_workspace_records(jsonb, jsonb) to authenticated;

delete from auth.sessions;
drop function if exists public.current_session_is_aal2();
