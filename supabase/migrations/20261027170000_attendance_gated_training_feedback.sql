create or replace function public.resident_attended_sessions()
returns table (participant_id text, program_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct
    attendance.payload ->> 'participantId',
    attendance.payload ->> 'programId'
  from public.workspace_records as attendance
  join public.workspace_records as enrollment
    on enrollment.collection = 'participants'
    and enrollment.record_id = attendance.payload ->> 'participantId'
  where (select public.current_user_role()) = 'user'
    and attendance.collection = 'staffActivities'
    and attendance.payload ->> 'operationType' = 'Attendance check-in'
    and attendance.payload ->> 'status' = 'Present'
    and enrollment.payload ->> 'userId' = (select auth.uid())::text
    and enrollment.payload ->> 'programId' = attendance.payload ->> 'programId'
    and enrollment.payload ->> 'status' = 'Confirmed'
$$;

revoke all on function public.resident_attended_sessions() from public, anon;
grant execute on function public.resident_attended_sessions() to authenticated;

create or replace function public.require_resident_training_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.collection = 'trainingFeedback'
     and (select public.current_user_role()) = 'user'
     and not exists (
       select 1
       from public.workspace_records as enrollment
       join public.workspace_records as attendance
         on attendance.collection = 'staffActivities'
         and attendance.payload ->> 'operationType' = 'Attendance check-in'
         and attendance.payload ->> 'status' = 'Present'
         and attendance.payload ->> 'participantId' = enrollment.record_id
         and attendance.payload ->> 'programId' = enrollment.payload ->> 'programId'
       where enrollment.collection = 'participants'
         and enrollment.record_id = new.payload ->> 'participantId'
         and enrollment.payload ->> 'userId' = (select auth.uid())::text
         and enrollment.payload ->> 'programId' = new.payload ->> 'programId'
         and enrollment.payload ->> 'status' = 'Confirmed'
     ) then
    raise exception 'Instructor evaluation is available only to residents whose attendance was confirmed by Staff.';
  end if;

  return new;
end;
$$;

drop trigger if exists require_resident_training_attendance on public.workspace_records;
create trigger require_resident_training_attendance
  before insert or update on public.workspace_records
  for each row
  execute function public.require_resident_training_attendance();
