import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: Record<string, string | boolean>, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Access-Control-Allow-Origin": origin },
  });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  const configuredOrigin = (Deno.env.get("APP_ORIGIN") ?? "").replace(/\/+$/, "");
  const allowedOrigins = new Set([
    configuredOrigin,
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ].filter(Boolean));

  if (request.method === "OPTIONS") {
    if (!allowedOrigins.has(origin)) {
      return new Response(null, { status: 403 });
    }
    return new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Origin": origin } });
  }
  if (request.method !== "POST" || !allowedOrigins.has(origin)) {
    return jsonResponse(403, { error: "Request origin or method is not allowed." }, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase URL or service-role key is not configured for check-account.");
    return jsonResponse(500, { error: "Account check is not configured." }, origin);
  }

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "A valid JSON request body is required." }, origin);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(400, { error: "Provide a valid email address." }, origin);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const emailPattern = email.replace(/[\\%_]/g, "\\$&");
  const { data: profile, error } = await adminClient.from("user_profiles")
    .select("id")
    .ilike("email", emailPattern)
    .maybeSingle();

  if (error) {
    console.error("Unable to check account existence:", error.message);
    return jsonResponse(500, { error: "Account check could not be completed." }, origin);
  }
  return jsonResponse(200, { exists: Boolean(profile) }, origin);
});
