import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type ProgramRecord = {
  record_id: string;
  payload: {
    title?: string;
    status?: string;
    date?: string;
    time?: string;
    location?: string;
    instructorId?: string;
  };
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function matchesSecret(received: string, expected: string) {
  if (received.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

Deno.serve(async request => {
  if (request.method !== "POST" || request.headers.has("origin")) {
    return jsonResponse(403, { error: "This endpoint accepts server-scheduled requests only." });
  }

  const cronSecret = Deno.env.get("TRAINING_REMINDER_CRON_SECRET") ?? "";
  const receivedSecret = request.headers.get("x-cron-secret") ?? "";
  if (!cronSecret || !matchesSecret(receivedSecret, cronSecret)) {
    return jsonResponse(401, { error: "The scheduled reminder request is not authorized." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !publicKey || !privateKey || !vapidSubject) {
    console.error("The scheduled reminder service is missing Supabase or VAPID configuration.");
    return jsonResponse(500, { error: "The scheduled reminder service is not configured." });
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const programs: ProgramRecord[] = [];
  try {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await service.from("workspace_records")
        .select("record_id,payload")
        .eq("collection", "programs")
        .eq("payload->>status", "Scheduled")
        .order("record_id")
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      programs.push(...data as ProgramRecord[]);
      if (data.length < 1000) break;
    }
  } catch (error) {
    console.error("Unable to load sessions for scheduled reminders:", error);
    return jsonResponse(500, { error: "Scheduled training sessions could not be loaded." });
  }

  const now = Date.now();
  const catchUpWindowMs = 10 * 60 * 1000;
  const reminderTypes = [
    { key: "24h", offsetMs: 24 * 60 * 60 * 1000, label: "24-hour" },
    { key: "1h", offsetMs: 60 * 60 * 1000, label: "1-hour" },
  ];
  const dueEvents: Array<{
    eventKey: string;
    program: ProgramRecord;
    reminderLabel: string;
    startAt: Date;
  }> = [];

  for (const program of programs) {
    const date = program.payload.date ?? "";
    const time = program.payload.time ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
    const startAt = new Date(`${date}T${time}:00+08:00`);
    if (!Number.isFinite(startAt.getTime()) || startAt.getTime() <= now) continue;

    for (const reminder of reminderTypes) {
      const reminderAt = startAt.getTime() - reminder.offsetMs;
      if (reminderAt <= now && reminderAt >= now - catchUpWindowMs) {
        dueEvents.push({
          eventKey: `training-reminder:${program.record_id}:${date}T${time}:${reminder.key}`,
          program,
          reminderLabel: reminder.label,
          startAt,
        });
      }
    }
  }

  if (!dueEvents.length) return jsonResponse(200, { checked: programs.length, reminders: 0, sent: 0 });

  webpush.setVapidDetails(vapidSubject, publicKey, privateKey);
  const allowedPushHosts = new Set([
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "web.push.apple.com",
    "notify.windows.com",
  ]);
  let notificationCount = 0;
  let sent = 0;
  let failed = 0;

  for (const event of dueEvents) {
    const { data: enrollments, error: enrollmentError } = await service.from("workspace_records")
      .select("payload")
      .eq("collection", "participants")
      .eq("payload->>programId", event.program.record_id)
      .eq("payload->>status", "Confirmed")
      .limit(1000);
    if (enrollmentError) {
      console.error(`Unable to load confirmed attendees for ${event.program.record_id}:`, enrollmentError.message);
      failed += 1;
      continue;
    }

    const recipientIds = new Set<string>();
    for (const enrollment of enrollments) {
      const userId = typeof enrollment.payload?.userId === "string" ? enrollment.payload.userId : "";
      if (userId) recipientIds.add(userId);
    }
    const instructorId = event.program.payload.instructorId;
    if (instructorId) recipientIds.add(instructorId);
    if (!recipientIds.size) continue;

    const { data: profiles, error: profileError } = await service.from("user_profiles")
      .select("id,role")
      .in("id", [...recipientIds])
      .in("role", ["staff", "user"]);
    if (profileError) {
      console.error(`Unable to load reminder recipients for ${event.program.record_id}:`, profileError.message);
      failed += 1;
      continue;
    }

    const startLabel = new Intl.DateTimeFormat("en-PH", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Manila",
    }).format(event.startAt);
    const programTitle = event.program.payload.title || "Preparedness training session";
    const title = `Training reminder: ${programTitle}`;
    const location = event.program.payload.location || "venue to be announced";
    const message = `Your session is scheduled to start at ${startLabel} in ${location}. This is your ${event.reminderLabel} reminder.`;
    const notificationRows = profiles.map(profile => ({
      user_id: profile.id,
      event_key: event.eventKey,
      entity_type: "program",
      entity_id: event.program.record_id,
      title,
      message,
      target_page: profile.role === "staff" ? "programs" : "my-sessions",
    }));
    if (!notificationRows.length) continue;

    const { error: insertError } = await service.from("workspace_notifications")
      .upsert(notificationRows, { onConflict: "user_id,event_key", ignoreDuplicates: true });
    if (insertError) {
      console.error(`Unable to create reminder notifications for ${event.program.record_id}:`, insertError.message);
      failed += 1;
      continue;
    }

    const { data: notifications, error: notificationError } = await service.from("workspace_notifications")
      .select("id,user_id,title,message,target_page")
      .eq("event_key", event.eventKey)
      .is("push_sent_at", null);
    if (notificationError) {
      console.error(`Unable to load reminder notifications for ${event.program.record_id}:`, notificationError.message);
      failed += 1;
      continue;
    }
    notificationCount += notifications.length;
    if (!notifications.length) continue;

    const userIds = [...new Set(notifications.map(notification => notification.user_id))];
    const { data: subscriptions, error: subscriptionError } = await service.from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth")
      .in("user_id", userIds);
    if (subscriptionError) {
      console.error(`Unable to load reminder devices for ${event.program.record_id}:`, subscriptionError.message);
      failed += 1;
      continue;
    }

    const subscriptionsByUser = new Map<string, typeof subscriptions>();
    for (const subscription of subscriptions) {
      const userSubscriptions = subscriptionsByUser.get(subscription.user_id) ?? [];
      userSubscriptions.push(subscription);
      subscriptionsByUser.set(subscription.user_id, userSubscriptions);
    }

    const sentNotificationIds = new Set<string>();
    for (const notification of notifications) {
      for (const subscription of subscriptionsByUser.get(notification.user_id) ?? []) {
        let endpointUrl: URL;
        try {
          endpointUrl = new URL(subscription.endpoint);
        } catch {
          console.error("A stored reminder subscription has an invalid endpoint URL.");
          failed += 1;
          continue;
        }
        if (endpointUrl.protocol !== "https:" || !allowedPushHosts.has(endpointUrl.hostname.toLowerCase())) {
          console.error("A stored reminder subscription used an unsupported push service host.");
          failed += 1;
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
          sentNotificationIds.add(notification.id);
        } catch (error) {
          const statusCode = typeof error === "object" && error !== null && "statusCode" in error
            ? Number(error.statusCode)
            : 0;
          if (statusCode === 404 || statusCode === 410) {
            const { error: removeError } = await service.from("push_subscriptions")
              .delete().eq("id", subscription.id);
            if (removeError) console.error("Unable to remove an expired reminder endpoint:", removeError.message);
          } else {
            console.error("Unable to deliver a scheduled training reminder:", error);
            failed += 1;
          }
        }
      }
    }

    if (sentNotificationIds.size) {
      const { error: updateError } = await service.from("workspace_notifications")
        .update({ push_sent_at: new Date().toISOString() })
        .in("id", [...sentNotificationIds]);
      if (updateError) {
        console.error("Reminder push was sent but delivery status could not be saved:", updateError.message);
        failed += 1;
      }
    }
  }

  return jsonResponse(failed ? 502 : 200, {
    checked: programs.length,
    reminders: dueEvents.length,
    notifications: notificationCount,
    sent,
    failed,
  });
});
