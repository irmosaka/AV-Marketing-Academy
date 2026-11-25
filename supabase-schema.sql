-- AV & Marketing Academy | Supabase foundation
-- Apply in Supabase SQL Editor. Review before production deployment.
create extension if not exists pgcrypto;

create type public.academy_role as enum ('learner','instructor','admin');
create type public.course_status as enum ('draft','published','archived');
create type public.certificate_status as enum ('valid','revoked');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role public.academy_role not null default 'learner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null default '',
  category text not null,
  level text not null default 'foundation',
  status public.course_status not null default 'draft',
  sort_order integer not null default 0,
  certificate_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  summary text not null default '',
  content_md text not null default '',
  sort_order integer not null default 0,
  is_required boolean not null default true,
  estimated_minutes integer not null default 10 check (estimated_minutes > 0),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  unique(course_id, sort_order)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  pass_score integer not null default 80 check (pass_score between 1 and 100),
  question_count integer not null default 10 check (question_count > 0),
  attempts_allowed integer check (attempts_allowed is null or attempts_allowed > 0),
  published boolean not null default false
);

create table public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  prompt text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array'),
  answer_key text not null,
  explanation text not null default '',
  sort_order integer not null default 0,
  unique(assessment_id, sort_order)
);

create table public.lesson_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key(user_id, lesson_id)
);

create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  passed boolean not null,
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now()
);

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  certificate_code text not null unique default ('AVM-' || upper(encode(gen_random_bytes(6),'hex'))),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete restrict,
  assessment_attempt_id uuid not null references public.assessment_attempts(id) on delete restrict,
  status public.certificate_status not null default 'valid',
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  unique(user_id, course_id)
);

create table public.practical_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  submission_url text,
  submission_note text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_id uuid references public.profiles(id),
  reviewer_note text not null default '',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create or replace function public.current_academy_role()
returns public.academy_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_academy_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_academy_role() in ('instructor','admin'), false)
$$;

-- A newly authenticated account always starts as learner.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name',''), 'learner')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_academy on auth.users;
create trigger on_auth_user_created_academy
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.lessons enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.certificates enable row level security;
alter table public.practical_reviews enable row level security;

create policy "profiles read own or staff" on public.profiles
for select to authenticated using (id = auth.uid() or public.is_academy_staff());
create policy "profiles update own basic fields" on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- Do not grant clients permission to update profiles.role. Set staff roles manually
-- from the Supabase dashboard/SQL editor by a trusted project administrator.

create policy "published courses readable" on public.courses
for select to anon, authenticated using (status = 'published' or public.is_academy_staff());
create policy "staff manage courses" on public.courses
for all to authenticated using (public.is_academy_staff()) with check (public.is_academy_staff());

create policy "published lessons readable" on public.lessons
for select to anon, authenticated using (
  published and exists(select 1 from public.courses c where c.id = course_id and c.status = 'published')
  or public.is_academy_staff()
);
create policy "staff manage lessons" on public.lessons
for all to authenticated using (public.is_academy_staff()) with check (public.is_academy_staff());

create policy "published assessments readable" on public.assessments
for select to authenticated using (published or public.is_academy_staff());
create policy "staff manage assessments" on public.assessments
for all to authenticated using (public.is_academy_staff()) with check (public.is_academy_staff());

-- Question answer_key is sensitive. Do not expose this table directly to learner clients.
create policy "staff manage questions" on public.assessment_questions
for all to authenticated using (public.is_academy_staff()) with check (public.is_academy_staff());

create policy "learner reads own progress" on public.lesson_progress
for select to authenticated using (user_id = auth.uid() or public.is_academy_staff());
create policy "learner writes own progress" on public.lesson_progress
for insert to authenticated with check (user_id = auth.uid());
create policy "staff manages progress" on public.lesson_progress
for all to authenticated using (public.is_academy_staff()) with check (public.is_academy_staff());

create policy "learner reads own attempts" on public.assessment_attempts
for select to authenticated using (user_id = auth.uid() or public.is_academy_staff());
-- Attempt inserts should be performed through a validated server-side function,
-- not by trusting a score submitted from the browser.

create policy "learner reads own certificates" on public.certificates
for select to authenticated using (user_id = auth.uid() or public.is_academy_staff());
create policy "staff manages certificates" on public.certificates
for all to authenticated using (public.current_academy_role() = 'admin')
with check (public.current_academy_role() = 'admin');

create policy "learner reads own practical reviews" on public.practical_reviews
for select to authenticated using (user_id = auth.uid() or public.is_academy_staff());
create policy "learner submits own practical work" on public.practical_reviews
for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
create policy "staff reviews practical work" on public.practical_reviews
for update to authenticated using (public.is_academy_staff()) with check (public.is_academy_staff());

create or replace function public.verify_certificate(p_code text)
returns table(certificate_code text, learner_name text, course_title text, issued_at timestamptz, status public.certificate_status)
language sql stable security definer
set search_path = public
as $$
  select c.certificate_code, p.display_name, co.title, c.issued_at, c.status
  from public.certificates c
  join public.profiles p on p.id = c.user_id
  join public.courses co on co.id = c.course_id
  where c.certificate_code = upper(trim(p_code))
$$;

grant execute on function public.verify_certificate(text) to anon, authenticated;


-- Column-level protection: learners may edit their display name only.
-- This prevents a user from promoting their own profile to instructor/admin.
revoke update on public.profiles from authenticated;
grant update(display_name, updated_at) on public.profiles to authenticated;
