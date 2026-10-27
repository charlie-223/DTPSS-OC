create or replace function public.handle_new_readyph_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  email_is_confirmed boolean;
  should_auto_approve boolean;
begin
  email_is_confirmed := new.email_confirmed_at is not null;
  if tg_op = 'INSERT' then
    should_auto_approve := email_is_confirmed;
  else
    should_auto_approve := old.email_confirmed_at is null and email_is_confirmed;
  end if;

  insert into public.user_profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when should_auto_approve then 'user' else 'pending' end
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when excluded.full_name = '' then public.user_profiles.full_name
          else excluded.full_name
        end,
        role = case
          when public.user_profiles.role = 'pending' and should_auto_approve then 'user'
          else public.user_profiles.role
        end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_readyph on auth.users;
create trigger on_auth_user_created_readyph
  after insert on auth.users
  for each row
  execute function public.handle_new_readyph_user();

drop trigger if exists on_auth_user_email_changed_readyph on auth.users;
create trigger on_auth_user_email_changed_readyph
  after update of email, email_confirmed_at on auth.users
  for each row
  execute function public.handle_new_readyph_user();

insert into public.user_profiles (id, email, full_name, role)
select
  auth_user.id,
  coalesce(auth_user.email, ''),
  coalesce(auth_user.raw_user_meta_data ->> 'full_name', ''),
  'user'
from auth.users as auth_user
where auth_user.email_confirmed_at is not null
  and not exists (
    select 1
    from public.user_profiles as profile
    where profile.id = auth_user.id
  )
on conflict (id) do nothing;
