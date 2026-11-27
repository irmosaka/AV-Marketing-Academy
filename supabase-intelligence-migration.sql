-- AV Intelligence portal foundation
-- Run once in Supabase SQL Editor after reviewing the existing academy schema.
-- Does not drop or alter legacy academy tables. Assessment/certificate modules are retired at the product layer.
create extension if not exists pgcrypto;

create table if not exists public.articles (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 slug text not null unique,
 summary text not null default '',
 content_md text not null default '',
 category text not null check (category in ('tv','audio','smart','product','marketing','sales','market','competitor')),
 status text not null default 'draft' check (status in ('draft','review','published','archived')),
 author_id uuid references public.profiles(id) on delete set null,
 reviewer_id uuid references public.profiles(id) on delete set null,
 reviewed_at timestamptz,
 published_at timestamptz,
 review_due_at date,
 source_notes jsonb not null default '[]'::jsonb,
 tags text[] not null default '{}',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists articles_status_category_idx on public.articles(status,category);
create index if not exists articles_updated_idx on public.articles(updated_at desc);

create table if not exists public.article_versions (
 id uuid primary key default gen_random_uuid(),
 article_id uuid not null references public.articles(id) on delete cascade,
 version_no integer not null,
 title text not null,
 summary text not null default '',
 content_md text not null default '',
 changed_by uuid references public.profiles(id) on delete set null,
 change_note text not null default '',
 created_at timestamptz not null default now(),
 unique(article_id,version_no)
);

create table if not exists public.documents (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 description text not null default '',
 file_name text not null,
 file_path text not null unique,
 mime_type text,
 category text not null default 'general',
 status text not null default 'draft' check (status in ('draft','published','archived')),
 confidentiality text not null default 'internal' check (confidentiality in ('internal','restricted')),
 owner_id uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists documents_status_created_idx on public.documents(status,created_at desc);

create table if not exists public.data_sources (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 description text not null default '',
 source_type text not null default 'xlsx' check (source_type in ('xlsx','csv','manual','system')),
 owner_id uuid references public.profiles(id) on delete set null,
 confidentiality text not null default 'restricted' check (confidentiality in ('internal','restricted')),
 created_at timestamptz not null default now()
);

create table if not exists public.datasets (
 id uuid primary key default gen_random_uuid(),
 source_id uuid references public.data_sources(id) on delete set null,
 name text not null,
 slug text not null unique,
 description text not null default '',
 schema_json jsonb not null default '{}'::jsonb,
 current_version integer not null default 0,
 status text not null default 'draft' check (status in ('draft','active','archived')),
 owner_id uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.dataset_versions (
 id uuid primary key default gen_random_uuid(),
 dataset_id uuid not null references public.datasets(id) on delete cascade,
 version_no integer not null,
 storage_path text,
 row_count bigint not null default 0,
 column_count integer not null default 0,
 validation_report jsonb not null default '{}'::jsonb,
 data_snapshot jsonb,
 imported_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(dataset_id,version_no)
);

create table if not exists public.dashboards (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 slug text not null unique,
 description text not null default '',
 category text not null default 'general',
 layout_config jsonb not null default '{"widgets":[]}'::jsonb,
 is_published boolean not null default false,
 confidentiality text not null default 'internal' check (confidentiality in ('internal','restricted')),
 owner_id uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
 id bigint generated always as identity primary key,
 actor_id uuid references public.profiles(id) on delete set null,
 action text not null,
 entity_type text not null,
 entity_id text,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

-- AI-ready metadata and retrieval records. Embedding vectors are intentionally deferred
-- until the embedding provider/model and vector dimensions are selected.
create table if not exists public.ai_documents (
 id uuid primary key default gen_random_uuid(),
 entity_type text not null check (entity_type in ('article','document','dataset')),
 entity_id uuid not null,
 content_hash text not null,
 source_version text not null,
 processing_status text not null default 'pending' check (processing_status in ('pending','processing','ready','failed','excluded')),
 visibility text not null default 'internal' check (visibility in ('internal','restricted')),
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(entity_type,entity_id,content_hash)
);
create table if not exists public.ai_chunks (
 id uuid primary key default gen_random_uuid(),
 ai_document_id uuid not null references public.ai_documents(id) on delete cascade,
 chunk_no integer not null,
 content text not null,
 token_estimate integer,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 unique(ai_document_id,chunk_no)
);
create table if not exists public.ai_runs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references public.profiles(id) on delete set null,
 task_type text not null,
 model_provider text,
 model_name text,
 status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
 input_ref jsonb not null default '{}'::jsonb,
 output_json jsonb,
 citations jsonb not null default '[]'::jsonb,
 assumptions jsonb not null default '[]'::jsonb,
 usage jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
create table if not exists public.ai_feedback (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references public.ai_runs(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete set null,
 rating smallint check (rating between 1 and 5),
 feedback text not null default '',
 created_at timestamptz not null default now()
);

-- Generic timestamp maintenance
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
do $$ declare t text; begin
 foreach t in array array['articles','documents','datasets','dashboards','ai_documents'] loop
  execute format('drop trigger if exists set_updated_at on public.%I',t);
  execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t);
 end loop;
end $$;

alter table public.articles enable row level security;
alter table public.article_versions enable row level security;
alter table public.documents enable row level security;
alter table public.data_sources enable row level security;
alter table public.datasets enable row level security;
alter table public.dataset_versions enable row level security;
alter table public.dashboards enable row level security;
alter table public.audit_logs enable row level security;
alter table public.ai_documents enable row level security;
alter table public.ai_chunks enable row level security;
alter table public.ai_runs enable row level security;
alter table public.ai_feedback enable row level security;

-- Authenticated-only policies. No anonymous access is granted.
-- Roles currently present in academy_role: learner, instructor, admin.
-- Instructor is the content-authoring role; admin retains approval/publication authority.

-- Make this policy section safely re-runnable.
drop policy if exists articles_read_visible on public.articles;
drop policy if exists articles_staff_insert on public.articles;
drop policy if exists articles_staff_update on public.articles;
drop policy if exists article_versions_staff on public.article_versions;
drop policy if exists article_versions_read on public.article_versions;
drop policy if exists article_versions_insert on public.article_versions;
drop policy if exists article_versions_update on public.article_versions;
drop policy if exists article_versions_delete_admin on public.article_versions;
drop policy if exists documents_read_visible on public.documents;
drop policy if exists documents_staff_insert on public.documents;
drop policy if exists documents_staff_update on public.documents;
drop policy if exists data_sources_admin_all on public.data_sources;
drop policy if exists datasets_read_active on public.datasets;
drop policy if exists datasets_admin_all on public.datasets;
drop policy if exists dataset_versions_admin_all on public.dataset_versions;
drop policy if exists dashboards_read_visible on public.dashboards;
drop policy if exists dashboards_admin_all on public.dashboards;
drop policy if exists audit_logs_admin_read on public.audit_logs;
drop policy if exists ai_documents_read_staff on public.ai_documents;
drop policy if exists ai_documents_staff_manage on public.ai_documents;
drop policy if exists ai_documents_admin_all on public.ai_documents;
drop policy if exists ai_chunks_read_staff on public.ai_chunks;
drop policy if exists ai_chunks_staff_manage on public.ai_chunks;
drop policy if exists ai_chunks_admin_all on public.ai_chunks;
drop policy if exists ai_runs_read_own_or_admin on public.ai_runs;
drop policy if exists ai_feedback_own on public.ai_feedback;

-- Articles: learners see published content; instructors author their own drafts;
-- only admins can publish, archive, or edit another author's article.
create policy articles_read_visible on public.articles
for select to authenticated
using (
  status = 'published'
  or author_id = auth.uid()
  or public.current_academy_role() = 'admin'
);

create policy articles_staff_insert on public.articles
for insert to authenticated
with check (
  public.is_academy_staff()
  and author_id = auth.uid()
  and status in ('draft','review')
);

create policy articles_staff_update on public.articles
for update to authenticated
using (
  public.current_academy_role() = 'admin'
  or (public.current_academy_role() = 'instructor'
      and author_id = auth.uid()
      and status in ('draft','review'))
)
with check (
  public.current_academy_role() = 'admin'
  or (public.current_academy_role() = 'instructor'
      and author_id = auth.uid()
      and status in ('draft','review'))
);

-- Version history follows the parent article's ownership. Only admins may delete versions.
create policy article_versions_read on public.article_versions
for select to authenticated
using (
  public.current_academy_role() = 'admin'
  or exists (
    select 1 from public.articles a
    where a.id = article_versions.article_id
      and a.author_id = auth.uid()
  )
);
create policy article_versions_insert on public.article_versions
for insert to authenticated
with check (
  public.is_academy_staff()
  and changed_by = auth.uid()
  and exists (
    select 1 from public.articles a
    where a.id = article_versions.article_id
      and a.author_id = auth.uid()
      and a.status in ('draft','review')
  )
);
create policy article_versions_update on public.article_versions
for update to authenticated
using (
  public.current_academy_role() = 'admin'
  or exists (
    select 1 from public.articles a
    where a.id = article_versions.article_id
      and a.author_id = auth.uid()
      and a.status in ('draft','review')
  )
)
with check (
  public.current_academy_role() = 'admin'
  or exists (
    select 1 from public.articles a
    where a.id = article_versions.article_id
      and a.author_id = auth.uid()
      and a.status in ('draft','review')
  )
);
create policy article_versions_delete_admin on public.article_versions
for delete to authenticated
using (public.current_academy_role() = 'admin');

-- Documents: instructors can manage only their own records; admins manage all.
create policy documents_read_visible on public.documents
for select to authenticated
using (
  public.current_academy_role() = 'admin'
  or owner_id = auth.uid()
  or (status = 'published' and confidentiality = 'internal')
);
create policy documents_staff_insert on public.documents
for insert to authenticated
with check (public.is_academy_staff() and owner_id = auth.uid());
create policy documents_staff_update on public.documents
for update to authenticated
using (
  public.current_academy_role() = 'admin'
  or (public.current_academy_role() = 'instructor' and owner_id = auth.uid())
)
with check (
  public.current_academy_role() = 'admin'
  or (public.current_academy_role() = 'instructor' and owner_id = auth.uid())
);

-- Business data and dashboard administration remain admin-only for the first release.
create policy data_sources_admin_all on public.data_sources
for all to authenticated
using (public.current_academy_role() = 'admin')
with check (public.current_academy_role() = 'admin');

create policy datasets_read_active on public.datasets
for select to authenticated
using (
  public.current_academy_role() = 'admin'
  or (status = 'active' and confidentiality = 'internal')
);
create policy datasets_admin_all on public.datasets
for all to authenticated
using (public.current_academy_role() = 'admin')
with check (public.current_academy_role() = 'admin');

create policy dataset_versions_admin_all on public.dataset_versions
for all to authenticated
using (public.current_academy_role() = 'admin')
with check (public.current_academy_role() = 'admin');

create policy dashboards_read_visible on public.dashboards
for select to authenticated
using (
  public.current_academy_role() = 'admin'
  or (is_published and confidentiality = 'internal')
);
create policy dashboards_admin_all on public.dashboards
for all to authenticated
using (public.current_academy_role() = 'admin')
with check (public.current_academy_role() = 'admin');

create policy audit_logs_admin_read on public.audit_logs
for select to authenticated
using (public.current_academy_role() = 'admin');
-- Audit records are written only by trusted server-side functions.

-- AI source/chunk tables are admin-only until source-level authorization is enforced
-- by the future retrieval service. This intentionally fails closed.
create policy ai_documents_admin_all on public.ai_documents
for all to authenticated
using (public.current_academy_role() = 'admin')
with check (public.current_academy_role() = 'admin');
create policy ai_chunks_admin_all on public.ai_chunks
for all to authenticated
using (public.current_academy_role() = 'admin')
with check (public.current_academy_role() = 'admin');

create policy ai_runs_read_own_or_admin on public.ai_runs
for select to authenticated
using (user_id = auth.uid() or public.current_academy_role() = 'admin');
-- AI execution records are created only by trusted server-side functions.

create policy ai_feedback_own on public.ai_feedback
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Keep SECURITY DEFINER helpers callable by authenticated sessions only.
revoke all on function public.current_academy_role() from public, anon;
revoke all on function public.is_academy_staff() from public, anon;
grant execute on function public.current_academy_role() to authenticated;
grant execute on function public.is_academy_staff() to authenticated;

-- Private file bucket. Access is mediated by Storage RLS and the documents table.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('portal-documents','portal-documents',false,52428800,
 array['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint','text/csv','image/png','image/jpeg','image/webp'])
on conflict (id) do update set
 public = false,
 file_size_limit = excluded.file_size_limit,
 allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists portal_documents_staff_upload on storage.objects;
drop policy if exists portal_documents_read_authorized on storage.objects;
drop policy if exists portal_documents_admin_delete on storage.objects;

create policy portal_documents_staff_upload on storage.objects
for insert to authenticated
with check (
  bucket_id = 'portal-documents'
  and public.is_academy_staff()
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy portal_documents_read_authorized on storage.objects
for select to authenticated
using (
  bucket_id = 'portal-documents'
  and (
    public.current_academy_role() = 'admin'
    or exists (
      select 1
      from public.documents d
      where d.file_path = storage.objects.name
        and (
          d.owner_id = auth.uid()
          or (d.status = 'published' and d.confidentiality = 'internal')
        )
    )
  )
);

create policy portal_documents_admin_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'portal-documents'
  and public.current_academy_role() = 'admin'
);
