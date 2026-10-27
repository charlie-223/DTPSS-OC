import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: Record<string, unknown>, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Access-Control-Allow-Origin": origin },
  });
}

function getTokenClaims(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
}

function hasPasswordAuthentication(claims: Record<string, unknown>): boolean {
  return Array.isArray(claims.amr)
    && claims.amr.some(method => method && typeof method === "object" && (method as Record<string, unknown>).method === "password");
}

function createCode(): string {
  const range = 1_000_000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return String(value[0] % range).padStart(6, "0");
}

async function hashCode(code: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(code));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async request => {
  const origin = request.headers.get("origin") ?? "";
  const appOrigin = (Deno.env.get("APP_ORIGIN") ?? "").replace(/\/+$/, "");
  const allowedOrigins = new Set([
    appOrigin,
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ].filter(Boolean));

  if (request.method === "OPTIONS") {
    if (!allowedOrigins.has(origin)) return new Response(null, { status: 403 });
    return new Response("ok", { headers: { ...headers, "Access-Control-Allow-Origin": origin } });
  }
  if (request.method !== "POST" || !allowedOrigins.has(origin)) {
    return jsonResponse(403, { error: "Request origin or method is not allowed." }, origin);
  }

  const authorization = request.headers.get("authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization?.startsWith("Bearer ") || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(401, { error: "An authenticated account session is required." }, origin);
  }

  let body: { action?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "A valid JSON request body is required." }, origin);
  }
  if (!["status", "send", "verify"].includes(String(body.action))) {
    return jsonResponse(400, { error: "Choose a valid email verification action." }, origin);
  }

  const accessToken = authorization.slice("Bearer ".length);
  let claims: Record<string, unknown> | null;
  try {
    claims = getTokenClaims(accessToken);
  } catch (error) {
    console.error("Unable to read email MFA session claims:", error);
    return jsonResponse(401, { error: "The account session could not be verified." }, origin);
  }
  const sessionId = typeof claims?.session_id === "string" ? claims.session_id : null;
  if (!sessionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    return jsonResponse(401, { error: "The account session is invalid. Sign in again." }, origin);
  }
  const passwordAuthenticated = claims !== null && hasPasswordAuthentication(claims);
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: userError } = await caller.auth.getUser(accessToken);
  const user = userResult.user;
  if (userError || !user?.email || !user.email_confirmed_at) {
    return jsonResponse(401, { error: "A valid, email-confirmed account session is required." }, origin);
  }

  if (body.action === "status") {
    if (!passwordAuthenticated) {
      return jsonResponse(200, { verified: false, passwordRequired: true }, origin);
    }
    const { data: challenge, error } = await admin.from("email_mfa_challenges")
      .select("verified_at,expires_at")
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .maybeSingle();
    if (error) {
      console.error("Unable to check email MFA status:", error);
      return jsonResponse(500, { error: "Could not check the email verification status." }, origin);
    }
    const verified = Boolean(challenge?.verified_at);
    return jsonResponse(200, { verified }, origin);
  }

  if (!passwordAuthenticated) {
    return jsonResponse(403, { error: "Sign in with your email and password before verifying a security code." }, origin);
  }

  if (body.action === "send") {
    const secret = Deno.env.get("MFA_OTP_SECRET");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("EMAIL_FROM");
    if (!secret || secret.length < 32 || !resendKey || !fromEmail) {
      console.error("Email MFA is missing MFA_OTP_SECRET, RESEND_API_KEY, or EMAIL_FROM.");
      return jsonResponse(500, { error: "Email security codes are not configured. Contact the site administrator." }, origin);
    }

    const code = createCode();
    const otpHash = await hashCode(code, secret);
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const { data: reserved, error: reserveError } = await admin.rpc("request_email_mfa_code", {
      p_user_id: user.id,
      p_session_id: sessionId,
      p_otp_hash: otpHash,
      p_expires_at: expiresAt,
    });
    if (reserveError) {
      const tooSoon = /wait before requesting another/i.test(reserveError.message);
      const rateLimited = /too many email security codes/i.test(reserveError.message);
      if (!tooSoon && !rateLimited) console.error("Unable to reserve email MFA code:", reserveError);
      return jsonResponse(tooSoon || rateLimited ? 429 : 500, {
        error: tooSoon
          ? "Please wait one minute before requesting another code."
          : rateLimited
            ? "Too many codes were requested. Please try again in 10 minutes."
            : "Could not prepare an email security code.",
      }, origin);
    }
    if (reserved !== true) {
      return jsonResponse(200, { verified: true }, origin);
    }

    let message: Response;
    try {
      message = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + resendKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [user.email],
          subject: "Your One Cainta sign-in code",
          text: `Your One Cainta security code is ${code}. It expires in 5 minutes. If you did not try to sign in, you can ignore this email.`,
          html: `<p>Your One Cainta security code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 5 minutes. If you did not try to sign in, you can ignore this email.</p>`,
        }),
      });
    } catch (error) {
      console.error("Unable to contact the email provider:", error);
      const { error: cleanupError } = await admin.from("email_mfa_challenges")
        .delete().eq("user_id", user.id).eq("session_id", sessionId);
      if (cleanupError) console.error("Unable to clear unsent email MFA code:", cleanupError);
      return jsonResponse(502, { error: "The email provider could not be reached. Try again." }, origin);
    }
    if (!message.ok) {
      const detail = await message.text();
      console.error("Email provider rejected the MFA message:", message.status, detail);
      const { error: cleanupError } = await admin.from("email_mfa_challenges")
        .delete().eq("user_id", user.id).eq("session_id", sessionId);
      if (cleanupError) console.error("Unable to clear unsent email MFA code:", cleanupError);
      return jsonResponse(502, { error: "The security code could not be delivered. Check email configuration and try again." }, origin);
    }
    return jsonResponse(200, { message: `A security code was sent to ${user.email}. It expires in 5 minutes.` }, origin);
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) {
    return jsonResponse(400, { error: "Enter the 6-digit code from your email." }, origin);
  }
  const secret = Deno.env.get("MFA_OTP_SECRET");
  if (!secret || secret.length < 32) {
    console.error("Email MFA is missing MFA_OTP_SECRET.");
    return jsonResponse(500, { error: "Email security codes are not configured. Contact the site administrator." }, origin);
  }
  const { data: verified, error: verifyError } = await admin.rpc("verify_email_mfa_code", {
    p_user_id: user.id,
    p_session_id: sessionId,
    p_otp_hash: await hashCode(code, secret),
  });
  if (verifyError) {
    console.error("Unable to verify email MFA code:", verifyError);
    return jsonResponse(500, { error: "Could not verify the email security code." }, origin);
  }
  return jsonResponse(200, { verified: verified === true }, origin);
});
