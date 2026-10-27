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
    if (!allowedOrigins.has(origin)) return new Response(null, { status: 403 });
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

  let body: { action?: unknown; userId?: unknown; role?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "A valid JSON request body is required." }, origin);
  }
  const action = body.action;
  const userId = typeof body.userId === "string" ? body.userId : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (action !== "delete" && action !== "update-role") {
    return jsonResponse(400, { error: "Choose a supported account action." }, origin);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return jsonResponse(400, { error: "Provide a valid workspace account ID." }, origin);
  }
  if (!password || password.length > 1024) {
    return jsonResponse(400, { error: "Enter your Admin password to confirm this change." }, origin);
  }
  const requestedRole = typeof body.role === "string" ? body.role : "";
  if (action === "update-role" &&
      !["pending", "user", "staff", "admin"].includes(requestedRole)) {
    return jsonResponse(400, { error: "Choose a valid workspace role." }, origin);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: userError } = await caller.auth.getUser(authorization.slice("Bearer ".length));
  if (userError || !userResult.user) {
    return jsonResponse(401, { error: "The administrator session is invalid or expired." }, origin);
  }
  if (userResult.user.id === userId) {
    return jsonResponse(400, { error: "You cannot delete your own signed-in account." }, origin);
  }
  const { data: callerProfile, error: callerProfileError } = await caller.from("user_profiles")
    .select("role").eq("id", userResult.user.id).single();
  if (callerProfileError || callerProfile?.role !== "admin") {
    return jsonResponse(403, { error: "Only an Admin can manage workspace accounts." }, origin);
  }

  const passwordVerifier = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: passwordError } = await passwordVerifier.auth.signInWithPassword({
    email: userResult.user.email ?? "",
    password,
  });
  if (passwordError) {
    return jsonResponse(401, { error: "The Admin password is incorrect. Check it and try again." }, origin);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: targetProfile, error: targetProfileError } = await adminClient.from("user_profiles")
    .select("role").eq("id", userId).single();
  if (targetProfileError || !targetProfile) {
    return jsonResponse(404, { error: "The workspace account could not be found." }, origin);
  }
  if (action === "update-role") {
    if (userId === userResult.user.id) {
      return jsonResponse(400, { error: "You cannot change your own Admin role." }, origin);
    }
    const { data: updatedProfile, error: roleError } = await adminClient.from("user_profiles")
      .update({ role: requestedRole }).eq("id", userId).select("id,role").single();
    if (roleError || !updatedProfile) {
      console.error("Unable to update workspace account role:", roleError?.message ?? "Profile not found");
      return jsonResponse(400, { error: roleError?.message ?? "The account role could not be updated." }, origin);
    }
    return jsonResponse(200, { message: "Workspace account role updated.", role: updatedProfile.role }, origin);
  }

  if (targetProfile.role === "admin") {
    return jsonResponse(400, { error: "Change this account's role before deleting it. Admin accounts cannot be deleted directly." }, origin);
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error("Unable to delete workspace account:", deleteError.message);
    return jsonResponse(500, { error: "The account could not be deleted. Try again or contact the project owner." }, origin);
  }
  return jsonResponse(200, { message: "Workspace account deleted." }, origin);
});
