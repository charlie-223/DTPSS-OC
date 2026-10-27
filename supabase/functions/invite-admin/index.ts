import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: Record<string, string>, origin: string) {
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

  const authorization = request.headers.get("authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization?.startsWith("Bearer ") || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(401, { error: "An authenticated Admin session is required." }, origin);
  }

  let body: { email?: unknown; fullName?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "A valid JSON request body is required." }, origin);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const role = body.role === undefined ? "admin" : typeof body.role === "string" ? body.role : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length > 100) {
    return jsonResponse(400, { error: "Provide a valid email address and a name of at most 100 characters." }, origin);
  }
  if (role !== "user" && role !== "staff" && role !== "admin") {
    return jsonResponse(400, { error: "Choose the User, Staff, or Admin role." }, origin);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: userError } = await caller.auth.getUser(authorization.slice("Bearer ".length));
  if (userError || !userResult.user) {
    return jsonResponse(401, { error: "The administrator session is invalid or expired." }, origin);
  }
  const { data: profile, error: profileError } = await caller.from("user_profiles")
    .select("role").eq("id", userResult.user.id).single();
  if (profileError || profile?.role !== "admin") {
    return jsonResponse(403, { error: "Only an Admin can invite workspace accounts." }, origin);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: invitation, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: configuredOrigin || undefined,
  });
  if (inviteError || !invitation.user) {
    const message = inviteError?.message ?? "The invitation did not return an account.";
    return jsonResponse(400, { error: message }, origin);
  }

  const { error: roleError } = await adminClient.from("user_profiles")
    .update({ role }).eq("id", invitation.user.id);
  if (roleError) {
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(invitation.user.id);
    if (cleanupError) {
      console.error("Invitation profile setup failed and account cleanup failed:", cleanupError.message);
      return jsonResponse(500, { error: "The invitation could not be assigned the requested role. A project owner must remove the pending account." }, origin);
    }
    console.error("Unable to assign role to invited account:", roleError.message);
    return jsonResponse(500, { error: "The invitation could not be assigned the requested role. No account was created." }, origin);
  }
  const roleLabel = role === "staff" ? "Staff instructor" : role === "user" ? "User" : "Admin";
  return jsonResponse(200, { message: `${roleLabel} invitation sent.` }, origin);
});
