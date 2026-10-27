do $$
declare
  admin_account_id uuid;
  user_account_id uuid;
begin
  select auth_user.id
  into admin_account_id
  from auth.users as auth_user
  join public.user_profiles as profile on profile.id = auth_user.id
  where lower(auth_user.email) = 'caintaone24@gmail.com';

  select auth_user.id
  into user_account_id
  from auth.users as auth_user
  join public.user_profiles as profile on profile.id = auth_user.id
  where lower(auth_user.email) = 'youtacharlie@gmail.com';

  if admin_account_id is null or user_account_id is null then
    raise exception 'Both requested accounts must exist and have profiles before their roles can be assigned.';
  end if;

  if admin_account_id = user_account_id then
    raise exception 'The requested Admin and User accounts must be different.';
  end if;

  update public.user_profiles
  set role = 'admin'
  where id = admin_account_id;

  update public.user_profiles
  set role = 'user'
  where id = user_account_id;

  if not exists (
    select 1
    from public.user_profiles
    where id = admin_account_id
      and role = 'admin'
  ) or not exists (
    select 1
    from public.user_profiles
    where id = user_account_id
      and role = 'user'
  ) then
    raise exception 'The requested account roles could not be verified.';
  end if;
end;
$$;
