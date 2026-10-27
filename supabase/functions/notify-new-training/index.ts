import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: Record<string, unknown>, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Access-Control-Allow-Origin": origin },
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function emailMessage(sender: string, recipient: string, subject: string, message: string, origin: string) {
  const boundary = `one-cainta-${crypto.randomUUID()}`;
  const safeSubject = `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject.replace(/[\r\n]/g, " "))))}?=`;
  const safeMessage = escapeHtml(message);
  const text = `${subject}\n\n${message}\n\nOpen One Cainta: ${origin}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#233b4d;line-height:1.6"><p><strong>ONE CAINTA · DISASTER PREPAREDNESS</strong></p><h2>${escapeHtml(subject)}</h2><p>${safeMessage}</p><p><a href="${escapeHtml(origin)}">Open One Cainta</a> to browse the session and enroll.</p></div>`;
  const mime = [
    `From: ${sender}`,
    `To: ${recipient}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${boundary}--`,
  ].join("\r\n");
  return base64Url(mime);
}

Deno.serve(async request => {
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

  let body: { programId?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "A valid JSON request body is required." }, origin);
  }
  const programId = body.programId === undefined ? "" : typeof body.programId === "string" ? body.programId : null;
  if (programId === null || programId.length > 100) {
    return jsonResponse(400, { error: "Provide a valid training program ID." }, origin);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: userError } = await caller.auth.getUser(authorization.slice("Bearer ".length));
  if (userError || !userResult.user) {
    return jsonResponse(401, { error: "The Admin session is invalid or expired." }, origin);
  }
  const { data: profile, error: profileError } = await caller.from("user_profiles")
    .select("role").eq("id", userResult.user.id).single();
  if (profileError || profile?.role !== "admin") {
    return jsonResponse(403, { error: "Only an Admin can send training email notifications." }, origin);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let notificationsQuery = serviceClient.from("user_notifications")
    .select("id,user_id,program_id,title,message")
    .is("email_sent_at", null)
    .order("created_at", { ascending: true })
    .limit(500);
  if (programId) notificationsQuery = notificationsQuery.eq("program_id", programId);
  const { data: notifications, error: notificationsError } = await notificationsQuery;
  if (notificationsError) {
    console.error("Unable to load pending training email notifications:", notificationsError.message);
    return jsonResponse(500, { error: "Pending training email notifications could not be loaded." }, origin);
  }
  if (!notifications.length) return jsonResponse(200, { sent: 0 }, origin);

  const gmailClientId = Deno.env.get("GMAIL_CLIENT_ID");
  const gmailClientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  const gmailRefreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN");
  const gmailSender = Deno.env.get("GMAIL_SENDER");
  if (!gmailClientId || !gmailClientSecret || !gmailRefreshToken || !gmailSender) {
    return jsonResponse(503, {
      error: "Gmail notifications are not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and GMAIL_SENDER in Supabase secrets.",
      sent: 0,
    }, origin);
  }

  const userIds = [...new Set(notifications.map(notification => notification.user_id))];
  const { data: recipients, error: recipientsError } = await serviceClient.from("user_profiles")
    .select("id,email").in("id", userIds);
  if (recipientsError) {
    console.error("Unable to load training email recipients:", recipientsError.message);
    return jsonResponse(500, { error: "Training email recipients could not be loaded." }, origin);
  }
  const recipientsById = new Map(recipients.map(recipient => [recipient.id, recipient.email]));
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: gmailClientId,
      client_secret: gmailClientSecret,
      refresh_token: gmailRefreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenResponse.ok) {
    console.error("Gmail OAuth token refresh failed with status:", tokenResponse.status);
    return jsonResponse(502, { error: "Gmail authentication failed. Verify the Gmail OAuth secrets." }, origin);
  }
  const tokenResult: { access_token?: string } = await tokenResponse.json();
  if (!tokenResult.access_token) {
    console.error("Gmail OAuth response did not contain an access token.");
    return jsonResponse(502, { error: "Gmail did not issue an access token." }, origin);
  }

  let sent = 0;
  for (const notification of notifications) {
    const recipient = recipientsById.get(notification.user_id);
    if (!recipient) continue;
    const gmailResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: emailMessage(gmailSender, recipient, notification.title, notification.message, configuredOrigin),
      }),
    });
    if (!gmailResponse.ok) {
      console.error("Gmail API rejected a training notification with status:", gmailResponse.status);
      return jsonResponse(502, { error: "Gmail rejected a training notification. Check the Gmail API and sender settings.", sent }, origin);
    }
    const { error: updateError } = await serviceClient.from("user_notifications")
      .update({ email_sent_at: new Date().toISOString() }).eq("id", notification.id);
    if (updateError) {
      console.error("Unable to record training email delivery:", updateError.message);
      return jsonResponse(500, { error: "The message was sent, but its delivery status could not be recorded.", sent }, origin);
    }
    sent += 1;
  }
  return jsonResponse(200, { sent });
});
