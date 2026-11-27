import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGINS = new Set(["https://irmosaka.github.io"]);

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function jsonResponse(body: unknown, status = 200, origin = "") {
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (ALLOWED_ORIGINS.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

const allowedRoles = new Set(["learner", "instructor", "admin"]);

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";

  if (req.method === "OPTIONS") {
    if (!ALLOWED_ORIGINS.has(origin)) return new Response("Origin not allowed", { status: 403 });
    return new Response("ok", {
      headers: { ...corsHeaders, "Access-Control-Allow-Origin": origin },
    });
  }

  if (!ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ error: "Origin not allowed." }, 403, origin);
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, origin);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Server function is not configured." }, 500, origin);
  }

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "Authentication required." }, 401, origin);

    // Verify the caller's JWT with Supabase Auth; never trust a role sent by the browser.
    const publicApiKey = Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "";
    if (!publicApiKey) return jsonResponse({ error: "Public API configuration is missing." }, 500, origin);
    const callerClient = createClient(SUPABASE_URL, publicApiKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
    if (callerError || !callerData.user) {
      return jsonResponse({ error: "Invalid or expired session." }, 401, origin);
    }

    // This privileged client is server-only and is used only after caller verification.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", callerData.user.id)
      .maybeSingle();

    if (profileError || callerProfile?.role !== "admin") {
      return jsonResponse({ error: "Administrator access required." }, 403, origin);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "Invalid request body." }, 400, origin);
    }

    if (body.action === "list") {
      const allUsers: any[] = [];
      const perPage = 500;
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        const batch = data.users ?? [];
        allUsers.push(...batch);
        if (batch.length < perPage) break;
      }

      const { data: profiles, error: profilesError } = await adminClient
        .from("profiles")
        .select("id, display_name, role");
      if (profilesError) throw profilesError;

      const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
      const users = allUsers.map((u) => {
        const p = profileMap.get(u.id);
        return {
          id: u.id,
          email: u.email ?? "",
          display_name: p?.display_name ?? (u.user_metadata?.display_name as string | undefined) ?? "",
          role: p?.role ?? "learner",
          email_confirmed_at: u.email_confirmed_at ?? null,
          invited_at: u.invited_at ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
          created_at: u.created_at,
        };
      }).sort((a, b) => String(a.email).localeCompare(String(b.email)));

      return jsonResponse({ users }, 200, origin);
    }

    if (body.action === "invite") {
      const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const role = typeof body.role === "string" ? body.role : "";

      if (displayName.length < 2 || displayName.length > 120) {
        return jsonResponse({ error: "نام باید بین ۲ تا ۱۲۰ نویسه باشد." }, 400, origin);
      }
      if (!isValidEmail(email)) {
        return jsonResponse({ error: "ایمیل معتبر وارد کنید." }, 400, origin);
      }
      if (!allowedRoles.has(role)) {
        return jsonResponse({ error: "نقش انتخاب‌شده معتبر نیست." }, 400, origin);
      }

      // Invite flow: the recipient creates their own password from the email link.
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
        email,
        {
          data: { display_name: displayName },
          redirectTo: "https://irmosaka.github.io/AV-Marketing-Academy/",
        },
      );
      if (inviteError) {
        const msg = /already|registered|exists/i.test(inviteError.message)
          ? "برای این ایمیل قبلاً حساب کاربری ایجاد شده است."
          : inviteError.message;
        return jsonResponse({ error: msg }, 409, origin);
      }
      if (!inviteData.user) {
        return jsonResponse({ error: "حساب کاربر ایجاد شد اما پاسخ دعوت‌نامه کامل نبود؛ فهرست کاربران را بررسی کنید." }, 502, origin);
      }

      // The auth trigger may create a learner profile. Upsert makes the requested role deterministic.
      const { error: upsertError } = await adminClient.from("profiles").upsert({
        id: inviteData.user.id,
        display_name: displayName,
        role,
      }, { onConflict: "id" });
      if (upsertError) {
        return jsonResponse({
          error: "حساب ایجاد شد، اما ثبت نقش در پروفایل کامل نشد. مدیر باید پروفایل را بررسی کند.",
          user_created: true,
          user_id: inviteData.user.id,
        }, 500, origin);
      }

      return jsonResponse({
        success: true,
        user_id: inviteData.user.id,
        email,
        role,
      }, 200, origin);
    }

    if (body.action === "set_role") {
      const targetId = typeof body.user_id === "string" ? body.user_id : "";
      const role = typeof body.role === "string" ? body.role : "";
      if (!targetId || !allowedRoles.has(role)) {
        return jsonResponse({ error: "شناسه کاربر یا نقش معتبر نیست." }, 400, origin);
      }
      if (targetId === callerData.user.id) {
        return jsonResponse({ error: "برای جلوگیری از قفل‌شدن پنل، تغییر نقش حساب خودتان از این بخش مجاز نیست." }, 400, origin);
      }

      const { data: target, error: targetError } = await adminClient
        .from("profiles").select("id, role").eq("id", targetId).maybeSingle();
      if (targetError) throw targetError;
      if (!target) return jsonResponse({ error: "پروفایل کاربر پیدا نشد." }, 404, origin);

      if (target.role === "admin" && role !== "admin") {
        const { count, error: countError } = await adminClient
          .from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
        if (countError) throw countError;
        if ((count ?? 0) <= 1) {
          return jsonResponse({ error: "نقش آخرین مدیر سامانه قابل تنزل نیست." }, 409, origin);
        }
      }

      const { error: updateError } = await adminClient
        .from("profiles").update({ role }).eq("id", targetId);
      if (updateError) throw updateError;
      return jsonResponse({ success: true, user_id: targetId, role }, 200, origin);
    }

    return jsonResponse({ error: "Unknown action." }, 400, origin);
  } catch (error) {
    // Do not log JWTs, credentials, or request bodies.
    console.error("admin-users function error:", error instanceof Error ? error.message : "unknown");
    return jsonResponse({ error: "خطای داخلی در سرویس مدیریت کاربران رخ داد." }, 500, origin);
  }
});
