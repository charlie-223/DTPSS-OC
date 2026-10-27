alter table public.user_profiles
  drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role in ('pending', 'user', 'admin', 'super_admin'));

drop policy if exists "Admins can read shared workspace records"
  on public.workspace_records;
drop policy if exists "Authorized users can read shared workspace records"
  on public.workspace_records;

create policy "Authorized users can read shared workspace records"
  on public.workspace_records
  for select
  to authenticated
  using ((select public.current_user_role()) in ('user', 'admin', 'super_admin'));
