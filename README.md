# AV Knowledge & Intelligence

پرتال داخلی دانش و هوشمندی کسب‌وکار صوتی، تصویری و مارکتینگ.

## Product direction
- Internal-only workspace with Supabase authentication.
- Controlled knowledge publishing: draft/review/published/archived.
- Independent BI module backed by structured, versioned datasets.
- Private document repository hosted in Supabase Storage.
- AI-ready data model; AI inference and agents are future phases.
- Mobile-first Persian RTL interface.

## Repository structure
- `index.html`: application shell and authentication/recovery screens.
- `app.css`: responsive design system and mobile-first layouts.
- `app.js`: Supabase client, auth flow, module navigation and data views.
- `supabase-config.js`: public Supabase URL + publishable key (client-safe; protected by RLS).
- `supabase-config.example.js`: configuration template.
- `supabase-intelligence-migration.sql`: additive database migration for the new product.
- `supabase-schema.sql`: legacy academy schema; retained for safe migration history.

## Setup / deployment
1. In Supabase SQL Editor, review and run `supabase-intelligence-migration.sql` once.
2. Confirm the existing `profiles` table and `academy_role` values are present. Admin and instructor profiles must be assigned by a trusted administrator.
3. In Supabase Authentication URL Configuration, set Site URL to the GitHub Pages URL and add that exact URL to Redirect URLs. For GitHub Pages project sites, add `https://OWNER.github.io/REPOSITORY/`.
4. GitHub Pages should deploy from `main` / root.
5. Supabase publishable key is intended for browser use. Never put service_role or secret keys in this repository.
6. Run a controlled test with a learner, instructor and admin account before organizational rollout.

## Important current limitations
- Existing accounts and profile roles are retained.
- The UI hides retired quiz/certificate flows, but legacy tables and the old assessment Edge Function are intentionally not dropped or deleted.
- Article creation currently saves drafts. Review/approval publishing UI and full audit event coverage are next implementation steps.
- BI dashboard builder, Excel ingestion/validation pipeline and dataset versioning UI are planned next.
- File upload and signed download use the private `portal-documents` bucket and require the SQL migration.
- AI tables store source/version/chunk/run/feedback metadata. Embedding dimensions and provider-specific vector storage are deferred until model selection; this avoids locking the platform to one AI vendor.
- This static GitHub Pages frontend uses Supabase Auth + RLS. Any privileged processing, Excel parsing at scale, AI calls, and cross-user administration must run server-side (Edge Functions), never with a service-role key in the browser.

## Security checklist
- Enable MFA where supported by organizational policy.
- Verify RLS on every exposed table and Storage bucket.
- Do not use public buckets for internal documents.
- Do not trust UI role checks; database policies are authoritative.
- Restrict file types and size; scan uploaded files before production use.
- Define retention and backup policies for datasets and documents.


## مدیریت کاربران از داخل پرتال

ماژول مدیریت کاربران از طریق Edge Function امن `admin-users` کار می‌کند؛ کلید service-role فقط در Secrets سمت Supabase قرار می‌گیرد و هرگز به مرورگر یا GitHub Pages ارسال نمی‌شود.

### استقرار یک‌باره Edge Function

پیش‌نیاز: Supabase CLI روی سیستم و دسترسی مالک/مدیر پروژه.

```bash
supabase login
supabase link --project-ref tihmefrvlstiskdygwlb
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase functions deploy admin-users
```

- مقدار `YOUR_SERVICE_ROLE_KEY` را فقط در ترمینال خودت جایگزین کن؛ آن را در چت، فایل یا GitHub قرار نده.
- `SUPABASE_URL` و `SUPABASE_ANON_KEY` در محیط Edge Function به‌صورت پیش‌فرض در دسترس‌اند.
- Origin مجاز فعلی تابع `https://irmosaka.github.io` است و redirect دعوت‌نامه روی `https://irmosaka.github.io/AV-Marketing-Academy/` تنظیم شده است.
- در Supabase Dashboard > Authentication > URL Configuration مطمئن شو آدرس `https://irmosaka.github.io/AV-Marketing-Academy/` در Redirect URLs وجود دارد.
- ارسال دعوت‌نامه به SMTP/Email Provider فعال و قابل تحویل در پروژه Supabase نیاز دارد. اگر ایمیل ارسال نشود، ابتدا SMTP و قالب Invite User را بررسی کن.
- مدیر واردشده از پنل سایت می‌تواند فهرست کاربران را ببیند، کاربر جدید دعوت کند و نقش سایر کاربران را تغییر دهد. تغییر نقش حساب خودش و تنزل آخرین مدیر عمداً مسدود شده است.
- تابع برای هر درخواست JWT را اعتبارسنجی می‌کند و نقش `admin` را مستقیماً از جدول `profiles` می‌خواند؛ پنهان‌بودن دکمه در UI به‌تنهایی مبنای امنیت نیست.

### نکته دیتابیس

این قابلیت از جدول و enum موجود `profiles` / `academy_role` و سه نقش `learner`, `instructor`, `admin` استفاده می‌کند. برای افزودن این ماژول، جدول جدید یا تغییر enum لازم نیست. Migration قبلی را برای این قابلیت دوباره اجرا نکن؛ ابتدا Edge Function را Deploy و سپس از حساب مدیر وارد سایت شو و تست کن.
