-- Workspace Dashboard — security hardening. Run AFTER schema.sql and the
-- README's additional migration. Safe to re-run.

-- 1) Sign-ups can no longer choose their own role.
--    schema.sql trusted raw_user_meta_data->>'role', which any visitor can set
--    via supabase.auth.signUp({ options: { data: { role: 'admin' } } }) using the
--    public anon key. Admin-created users still get their role, because
--    api/admin.js PATCHes profiles.role with the service_role key afterwards.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select count(*) = 0 into first_user from public.profiles;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when first_user then 'admin' else 'employee' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 2) Users can no longer promote themselves.
--    The profiles_update policy lets a user update their own row — every
--    column, role included. Only admins (or the service role / SQL editor)
--    may change a role.
-- SECURITY INVOKER on purpose: current_user must be the caller's role
-- (authenticated / service_role), not the function owner.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.role is distinct from old.role
     and not (public.is_admin() or current_user in ('service_role', 'postgres', 'supabase_admin')) then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_role on public.profiles;
create trigger guard_profile_role before update on public.profiles
  for each row execute function public.guard_profile_role();
