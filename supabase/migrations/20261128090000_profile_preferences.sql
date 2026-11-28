-- AV Intelligence: profile preferences
-- Apply once in Supabase SQL Editor. This migration does not alter profile roles or existing content.

alter table public.profiles
  add column if not exists avatar_id text not null default 'avatar-01',
  add column if not exists theme text not null default 'dark';

alter table public.profiles
  drop constraint if exists profiles_avatar_id_check,
  add constraint profiles_avatar_id_check
    check (avatar_id = any (array[
      'avatar-01','avatar-02','avatar-03','avatar-04','avatar-05','avatar-06',
      'avatar-07','avatar-08','avatar-09','avatar-10','avatar-11','avatar-12'
    ])),
  drop constraint if exists profiles_theme_check,
  add constraint profiles_theme_check check (theme in ('dark','light'));

create or replace function public.get_my_preferences()
returns table (avatar_id text, theme text)
language sql
stable
security definer
set search_path = public
as $$
  select p.avatar_id, p.theme
  from public.profiles as p
  where p.id = auth.uid()
$$;

create or replace function public.set_my_preferences(
  p_avatar_id text,
  p_theme text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_avatar_id is null or p_avatar_id <> all (array[
    'avatar-01','avatar-02','avatar-03','avatar-04','avatar-05','avatar-06',
    'avatar-07','avatar-08','avatar-09','avatar-10','avatar-11','avatar-12'
  ]) then
    raise exception 'Invalid avatar selection';
  end if;

  if p_theme is null or p_theme not in ('dark','light') then
    raise exception 'Invalid theme selection';
  end if;

  update public.profiles
     set avatar_id = p_avatar_id,
         theme = p_theme,
         updated_at = now()
   where id = v_user_id;

  if not found then
    insert into public.profiles (id, avatar_id, theme)
    values (v_user_id, p_avatar_id, p_theme)
    on conflict (id) do update
      set avatar_id = excluded.avatar_id,
          theme = excluded.theme,
          updated_at = now();
  end if;
end;
$$;

revoke all on function public.get_my_preferences() from public, anon;
revoke all on function public.set_my_preferences(text, text) from public, anon;
grant execute on function public.get_my_preferences() to authenticated;
grant execute on function public.set_my_preferences(text, text) to authenticated;
