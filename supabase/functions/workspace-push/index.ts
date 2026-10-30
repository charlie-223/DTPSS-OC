import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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

Deno.serve(async request => {
  const origin = request.headers.get("origin") ?? "";
  const configuredOrigin = (Deno.env.get("APP_ORIGIN") ?? "").replace(/\/+$/, "");
  const allowedOrigins = new Set([
    configuredOrigin,
    "https://polite-salamander-82ba90.netlify.app",
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
    return jsonResponse(401, { error: "An authenticated workspace account is required." }, origin);
  }

  let body: { action?: unknown; entityType?: unknown; entityId?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "A valid JSON request body is required." }, origin);
  }
  if (!["public-key", "dispatch"].includes(String(body.action))) {
    return jsonResponse(400, { error: "Choose a supported notification action." }, origin);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: userError } = await caller.auth.getUser(authorization.slice("Bearer ".length));
  if (userError || !userResult.user) {
    return jsonResponse(401, { error: "The workspace session is invalid or expired." }, origin);
  }
  const { data: profile, error: profileError } = await caller.from("user_profiles")
    .select("role").eq("id", userResult.user.id).single();
  if (profileError || !["admin", "staff", "user"].includes(profile?.role || "")) {
    return jsonResponse(403, { error: "An active Admin, Staff, or Resident account is required." }, origin);
  }

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "";
  if (body.action === "public-key") {
    if (!publicKey || !privateKey || !vapidSubject) {
      return jsonResponse(200, {
        configured: false,
        error: "Phone notifications are not configured by the system administrator yet.",
      }, origin);
    }
    return jsonResponse(200, { configured: true, publicKey }, origin);
  }

  if (profile.role !== "admin") {
    return jsonResponse(403, { error: "Only an Admin can dispatch training or scenario notifications." }, origin);
  }
  const entityType = body.entityType === "program" || body.entityType === "scenario" ? body.entityType : null;
  const entityId = typeof body.entityId === "string" ? body.entityId : "";
  if (!entityType || !entityId || entityId.length > 100) {
    return jsonResponse(400, { error: "Provide a valid training program or simulation scenario ID." }, origin);
  }
  if (!publicKey || !privateKey || !vapidSubject) {
    return jsonResponse(200, {
      configured: false,
      sent: 0,
      message: "In-app notifications were saved. Phone push notifications require VAPID secrets.",
    }, origin);
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: notifications, error: notificationsError } = await service.from("workspace_notifications")
    .select("id,user_id,title,message,target_page")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .is("push_sent_at", null)
    .limit(1000);
  if (notificationsError) {
    console.error("Unable to load role-scoped notifications for push:", notificationsError.message);
    return jsonResponse(500, { error: "The notification records could not be loaded." }, origin);
  }
  if (!notifications.length) return jsonResponse(200, { configured: true, sent: 0 }, origin);

  const recipientIds = [...new Set(notifications.map(notification => notification.user_id))];
  const { data: mobileUsers, error: mobileUsersError } = await service.from("user_profiles")
    .select("id").in("id", recipientIds).in("role", ["staff", "user"]);
  if (mobileUsersError) {
    console.error("Unable to load mobile notification recipients:", mobileUsersError.message);
    return jsonResponse(500, { error: "Mobile notification recipients could not be loaded." }, origin);
  }
  const userIds = mobileUsers.map(user => user.id);
  if (!userIds.length) return jsonResponse(200, { configured: true, sent: 0 }, origin);
  const { data: subscriptions, error: subscriptionsError } = await service.from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth").in("user_id", userIds);
  if (subscriptionsError) {
    console.error("Unable to load registered push devices:", subscriptionsError.message);
    return jsonResponse(500, { error: "Registered push devices could not be loaded." }, origin);
  }
  if (!subscriptions.length) return jsonResponse(200, { configured: true, sent: 0 }, origin);

  webpush.setVapidDetails(vapidSubject, publicKey, privateKey);
  const subscriptionsByUser = new Map<string, typeof subscriptions>();
  for (const subscription of subscriptions) {
    const userSubscriptions = subscriptionsByUser.get(subscription.user_id) ?? [];
    userSubscriptions.push(subscription);
    subscriptionsByUser.set(subscription.user_id, userSubscriptions);
  }

  let sent = 0;
  const attemptedNotificationIds = new Set<string>();
  const failedEndpoints: string[] = [];
  const allowedPushHosts = new Set([
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "push.services.mozilla.com",
    "web.push.apple.com",
    "notify.windows.com",
  ]);
  for (const notification of notifications) {
    const userSubscriptions = subscriptionsByUser.get(notification.user_id) ?? [];
    for (const subscription of userSubscriptions) {
      let endpointUrl: URL;
      try {
        endpointUrl = new URL(subscription.endpoint);
      } catch {
        console.error("A stored push subscription has an invalid endpoint URL.");
        failedEndpoints.push(subscription.endpoint);
        continue;
      }
      if (endpointUrl.protocol !== "https:" || !allowedPushHosts.has(endpointUrl.hostname.toLowerCase())) {
        console.error("A stored push subscription used an unsupported push service host.");
        failedEndpoints.push(subscription.endpoint);
        continue;
      }
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, JSON.stringify({
          title: notification.title,
          body: notification.message,
          url: `/#${notification.target_page}`,
          tag: notification.id,
        }));
        sent += 1;
        attemptedNotificationIds.add(notification.id);
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error
          ? Number(error.statusCode)
          : 0;
        if (statusCode === 404 || statusCode === 410) {
          const { error: removeError } = await service.from("push_subscriptions")
            .delete().eq("id", subscription.id);
          if (removeError) console.error("Unable to remove an expired push endpoint:", removeError.message);
        } else {
          console.error("Unable to deliver a workspace push notification:", error);
          failedEndpoints.push(subscription.endpoint);
        }
      }
    }
  }

  if (attemptedNotificationIds.size) {
    const { error: updateError } = await service.from("workspace_notifications")
      .update({ push_sent_at: new Date().toISOString() })
      .in("id", [...attemptedNotificationIds]);
    if (updateError) {
      console.error("Unable to mark push notifications as delivered:", updateError.message);
      return jsonResponse(500, { error: "Push notifications were sent but their delivery status could not be saved.", sent }, origin);
    }
  }
  if (failedEndpoints.length) {
    return jsonResponse(502, {
      error: "Some phone notifications could not be delivered.",
      sent,
      failed: failedEndpoints.length,
    }, origin);
  }
  return jsonResponse(200, { configured: true, sent }, origin);
});
