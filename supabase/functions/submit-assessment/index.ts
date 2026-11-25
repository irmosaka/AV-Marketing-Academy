// Supabase Edge Function: submit-assessment
// Deploy with: supabase functions deploy submit-assessment
// Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY as function secrets.
// The service-role key is server-only and must never be exposed to the browser.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return reply({ error: "Authentication required" }, 401);

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return reply({ error: "Invalid session" }, 401);

    const { assessmentId, answers } = await req.json();
    if (typeof assessmentId !== "string" || !answers || typeof answers !== "object" || Array.isArray(answers)) {
      return reply({ error: "Invalid request payload" }, 400);
    }

    const db = createClient(url, service, { auth: { persistSession: false } });
    const { data: assessment, error: aErr } = await db.from("assessments")
      .select("id,course_id,pass_score,published,attempts_allowed")
      .eq("id", assessmentId).single();
    if (aErr || !assessment || !assessment.published) return reply({ error: "Assessment unavailable" }, 404);

    const { data: requiredLessons, error: lErr } = await db.from("lessons")
      .select("id").eq("course_id", assessment.course_id).eq("is_required", true).eq("published", true);
    if (lErr) throw lErr;
    const lessonIds = (requiredLessons ?? []).map((x) => x.id);
    if (lessonIds.length === 0) return reply({ error: "No published required lessons configured" }, 409);

    const { data: completed, error: pErr } = await db.from("lesson_progress")
      .select("lesson_id").eq("user_id", userData.user.id).in("lesson_id", lessonIds);
    if (pErr) throw pErr;
    if ((completed ?? []).length !== lessonIds.length) {
      return reply({ error: "Complete all required lessons before taking the assessment" }, 409);
    }

    const { data: questions, error: qErr } = await db.from("assessment_questions")
      .select("id,options,answer_key").eq("assessment_id", assessmentId);
    if (qErr) throw qErr;
    if (!questions?.length) return reply({ error: "No questions configured" }, 409);

    if (Object.keys(answers).length !== questions.length) {
      return reply({ error: "Answer every question" }, 400);
    }

    let correct = 0;
    const safeAnswers: Record<string, string> = {};
    for (const q of questions) {
      const selected = answers[q.id];
      const validKeys = Array.isArray(q.options) ? q.options.map((o: any) => o?.key) : [];
      if (typeof selected !== "string" || !validKeys.includes(selected)) {
        return reply({ error: "Invalid answer option" }, 400);
      }
      safeAnswers[q.id] = selected;
      if (selected === q.answer_key) correct++;
    }

    if (assessment.attempts_allowed !== null) {
      const { count, error: countErr } = await db.from("assessment_attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userData.user.id).eq("assessment_id", assessmentId);
      if (countErr) throw countErr;
      if ((count ?? 0) >= assessment.attempts_allowed) {
        return reply({ error: "Attempt limit reached" }, 409);
      }
    }

    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= assessment.pass_score;
    const { data: attempt, error: insertErr } = await db.from("assessment_attempts")
      .insert({
        user_id: userData.user.id,
        assessment_id: assessmentId,
        score,
        passed,
        answers: safeAnswers,
      }).select("id,score,passed,submitted_at").single();
    if (insertErr) throw insertErr;

    let certificate = null;
    if (passed) {
      const { data: course } = await db.from("courses")
        .select("id,certificate_enabled").eq("id", assessment.course_id).single();
      if (course?.certificate_enabled) {
        const { data: existing } = await db.from("certificates")
          .select("certificate_code,status").eq("user_id", userData.user.id)
          .eq("course_id", assessment.course_id).maybeSingle();
        if (!existing) {
          const { data: issued, error: certErr } = await db.from("certificates")
            .insert({
              user_id: userData.user.id,
              course_id: assessment.course_id,
              assessment_attempt_id: attempt.id,
            }).select("certificate_code,issued_at,status").single();
          if (certErr) throw certErr;
          certificate = issued;
        } else {
          certificate = existing;
        }
      }
    }

    return reply({ attempt, certificate }, 200);
  } catch (err) {
    console.error("submit-assessment failed", err);
    return reply({ error: "Unable to submit assessment" }, 500);
  }
});

function reply(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
