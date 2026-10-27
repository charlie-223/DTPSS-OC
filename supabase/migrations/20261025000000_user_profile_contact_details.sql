alter table public.user_profiles
  add column if not exists phone text not null default '';

update public.user_profiles as profile
set phone = coalesce(auth_user.raw_user_meta_data ->> 'phone', '')
from auth.users as auth_user
where auth_user.id = profile.id
  and profile.phone = '';

drop policy if exists "Users can update their own personal profile details"
  on public.user_profiles;

create policy "Users can update their own personal profile details"
  on public.user_profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select public.current_user_role())
  );

grant update (full_name, phone) on public.user_profiles to authenticated;
