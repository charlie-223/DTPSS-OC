(() => {
  "use strict";

  const CONFIG_KEY = "readyph-supabase-config-v1";
  const THEME_KEY = "one-cainta-theme";
  const LOGIN_ATTEMPT_KEY_PREFIX = "one-cainta-login-attempts:";
  const LOGIN_MAX_ATTEMPTS = 5;
  const LOGIN_LOCK_DURATION_MS = 60_000;
  const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60_000;
  const WORKSPACE_IDLE_TIMEOUT_MS = 10 * 60_000;
  const WORKSPACE_IDLE_WARNING_MS = 60_000;
  const DEFAULT_CONFIG = Object.freeze({
    url: "https://sybjlkqrrkhxbfdumxuh.supabase.co",
    anonKey: "sb_publishable_fhHfvg4dZ0eRtRzP6ERG4Q_S95kzFkT"
  });
  const AUTH_REDIRECT_URL = "https://polite-salamander-82ba90.netlify.app/";
  const SIGNUP_CONFIRMATION_REDIRECT_URL = AUTH_REDIRECT_URL;
  const pageTitles = {
    dashboard: "Dashboard",
    programs: "Training Program Management",
    scenarios: "Simulation Scenario Builder",
    participants: "Participant Registration",
    evaluations: "Performance Evaluation",
    reports: "Disaster Drill Reporting",
    users: "Account Management",
    "my-sessions": "My Sessions",
    "my-performance": "My Performance",
    "browse-drills": "Browse Drills",
    notifications: "Notifications & SMS"
  };
  const userPortalPages = ["my-sessions", "my-performance", "browse-drills", "notifications"];

  const demoData = {
    programs: [
      { id: "p1", title: "Community Emergency Response", type: "First aid", disasterType: "General preparedness", date: futureDate(7), location: "Barangay Hall, San Isidro", capacity: 35, status: "Scheduled", description: "Basic first aid, incident reporting, and safe evacuation for community volunteers." },
      { id: "p2", title: "Earthquake Preparedness Workshop", type: "Evacuation", disasterType: "Earthquake", date: futureDate(14), location: "Municipal Training Center", capacity: 50, status: "Scheduled", description: "Drop, cover, and hold; evacuation routes; and family preparedness planning." },
      { id: "p3", title: "Flood Response and Rescue Basics", type: "Emergency response", disasterType: "Flood", date: futureDate(-5), location: "Riverside Covered Court", capacity: 25, status: "Completed", description: "Flood warning signs, safe evacuation, and basic water-rescue awareness." }
    ],
    scenarios: [
      { id: "s1", title: "Magnitude 6.8 Earthquake", hazard: "Earthquake", severity: "High", duration: 45, objectives: "Practice drop-cover-hold; account for all participants; use the designated evacuation route.", steps: "1. Sound the earthquake alarm.\n2. Participants take cover for 60 seconds.\n3. Evacuate to the assembly area.\n4. Conduct a headcount and report missing persons." },
      { id: "s2", title: "Rising River Flood Alert", hazard: "Flood", severity: "High", duration: 60, objectives: "Test early-warning communication and orderly evacuation to higher ground.", steps: "1. Issue a simulated flood advisory.\n2. Activate the community communication tree.\n3. Move participants to the identified safe zone.\n4. Check vulnerable-person support and headcount." },
      { id: "s3", title: "Residential Fire Evacuation", hazard: "Fire", severity: "Medium", duration: 30, objectives: "Practice alarm response, safe exit selection, and assembly-point accounting.", steps: "1. Activate the fire alarm.\n2. Evacuate using marked routes; do not use elevators.\n3. Gather at the assembly point.\n4. Report any simulated injury to the safety officer." }
    ],
    participants: [
      { id: "u1", name: "Maria Santos", email: "maria.santos@example.com", phone: "0917 123 4567", affiliation: "San Isidro Barangay", programId: "p1", registeredAt: todayDate(), status: "Confirmed", emergencyContact: "Ana Santos — 0917 222 3333" },
      { id: "u2", name: "Jose Reyes", email: "jose.reyes@example.com", phone: "0918 234 5678", affiliation: "Municipal Health Office", programId: "p2", registeredAt: todayDate(), status: "Confirmed", emergencyContact: "Lina Reyes — 0918 333 4444" },
      { id: "u3", name: "Angela Cruz", email: "angela.cruz@example.com", phone: "0919 345 6789", affiliation: "San Isidro Barangay", programId: "p1", registeredAt: todayDate(), status: "Pending", emergencyContact: "Mark Cruz — 0919 444 5555" },
      { id: "u4", name: "Miguel Dela Cruz", email: "miguel.delacruz@example.com", phone: "0920 456 7890", affiliation: "Community Volunteer", programId: "p2", registeredAt: todayDate(), status: "Confirmed", emergencyContact: "Rosa Dela Cruz — 0920 555 6666" }
    ],
    evaluations: [
      { id: "e1", participantId: "u1", scenarioId: "s1", date: todayDate(), preparedness: 4, response: 5, teamwork: 4, safety: 5, feedback: "Clear communication and excellent awareness of the evacuation route." },
      { id: "e2", participantId: "u2", scenarioId: "s2", date: todayDate(), preparedness: 4, response: 4, teamwork: 5, safety: 4, feedback: "Worked well with the group. Review the emergency communication checklist." }
    ],
    reports: [
      { id: "r1", title: "Community Earthquake Drill", scenarioId: "s1", date: todayDate(), location: "San Isidro Barangay Hall", attendance: 32, outcome: "Successful", incidents: "One participant required additional route guidance.", summary: "All groups reached the assembly area. Headcount completed within the target time." }
    ]
  };

  let data = emptyData();
  let userNotifications = [];
  let supabaseClient = null;
  let currentProfile = null;
  let staffProfiles = [];
  let userNotificationTimer = null;
  let currentSession = null;
  let inviteSession = null;
  let invitationRedirect = false;
  let passwordRecovery = false;
  let authMode = "login";
  let pendingConfirmationEmail = "";
  let loginLockTimer = null;
  let authCardResizeAnimation = null;
  let currentPage = "dashboard";
  let editingId = null;
  let toastTimer;
  let workspaceActivityTimer = null;
  let workspaceIdleTimer = null;
  let workspaceIdleCountdownTimer = null;
  let workspaceIdleDeadline = 0;
  let workspaceIdleLastActivityAt = 0;
  let workspaceIdleLogoutInFlight = false;
  let accountActivityTimer = null;
  let activityUpdateInFlight = false;
  let pendingAccountAction = null;
  let workspaceOffline = false;
  let offlineWorkspaceOnly = false;
  let workspaceSyncInFlight = false;
  let workspaceConflicts = [];
  const content = document.getElementById("page-content");
  const backdrop = document.getElementById("modal-backdrop");
  const pageLoader = document.getElementById("page-loader");
  const signOutBackdrop = document.getElementById("sign-out-backdrop");
  const idleTimeoutBackdrop = document.getElementById("idle-timeout-backdrop");
  const idleTimeoutCountdown = document.getElementById("idle-timeout-countdown");
  const idleTimeoutContinueButton = document.getElementById("idle-timeout-continue");
  const idleTimeoutSignOutButton = document.getElementById("idle-timeout-sign-out");
  const form = document.getElementById("record-form");
  function hidePageLoader() {
    pageLoader.classList.add("is-hidden");
    pageLoader.setAttribute("aria-hidden", "true");
  }
  const canManageWorkspace = () => currentProfile?.role === "admin";
  const canManageAssignedPrograms = () => currentProfile?.role === "staff";
  const canEditRecord = (collection, record) => canManageWorkspace() ||
    (canManageAssignedPrograms() && collection === "programs" && record?.instructorId === currentProfile.id);
  const canSyncWorkspaceChanges = (upserts, deletes, remoteData) => canManageWorkspace() ||
    (canManageAssignedPrograms() && deletes.length === 0 && upserts.every(item =>
      item.collection === "programs" &&
      remoteData.programs.some(program => program.id === item.record_id && program.instructorId === currentProfile.id) &&
      item.payload?.instructorId === currentProfile.id
    )) ||
    (currentProfile?.role === "user" && deletes.length === 0 && upserts.every(item =>
      item.collection === "participants" &&
      item.payload?.userId === currentProfile.id &&
      item.payload?.email?.toLowerCase() === currentProfile.email?.toLowerCase() &&
      (!remoteData.participants.some(person => person.id === item.record_id) ||
        remoteData.participants.some(person => person.id === item.record_id && person.userId === currentProfile.id))
    ));
  const canKeepConflictEdit = conflict => canManageWorkspace() ||
    (canManageAssignedPrograms() && conflict.collection === "programs" &&
      conflict.local?.instructorId === currentProfile.id &&
      conflict.remote?.instructorId === currentProfile.id) ||
    (currentProfile?.role === "user" && canEditUserEnrollment({
      collection: conflict.collection,
      before: conflict.remote,
      local: conflict.local
    }));
  const canViewWorkspaceConflict = conflict => canManageWorkspace() ||
    (canManageAssignedPrograms() && conflict.collection === "programs" &&
      conflict.local?.instructorId === currentProfile.id &&
      conflict.remote?.instructorId === currentProfile.id) ||
    (currentProfile?.role === "user" && conflict.collection === "participants" &&
      conflict.local?.userId === currentProfile.id &&
      conflict.local?.email?.toLowerCase() === currentProfile.email?.toLowerCase() &&
      (!conflict.remote || (conflict.remote.userId === currentProfile.id &&
        conflict.remote.email?.toLowerCase() === currentProfile.email?.toLowerCase())));
  const canApplyPendingChange = change => canManageWorkspace() ||
    (canManageAssignedPrograms() && change.collection === "programs" &&
      change.local?.instructorId === currentProfile.id) ||
    (currentProfile?.role === "user" && change.collection === "participants" &&
      change.local?.userId === currentProfile.id &&
      change.local?.email?.toLowerCase() === currentProfile.email?.toLowerCase());
  const canEditUserEnrollment = change => currentProfile?.role === "user" &&
    change.collection === "participants" &&
    change.local?.userId === currentProfile.id &&
    change.local?.email?.toLowerCase() === currentProfile.email?.toLowerCase() &&
    (change.before === null
      ? change.local.status === "Pending"
      : change.before.userId === currentProfile.id &&
        change.local.status === "Cancelled" &&
        Object.keys({ ...change.before, ...change.local })
          .filter(key => key !== "status")
          .every(key => stableSerialize(change.before[key] ?? null) === stableSerialize(change.local[key] ?? null)));
  const roleLabel = role => ({ user: "User", staff: "Staff (Instructor)", admin: "Admin" })[role] || "Pending";
  const normalizeProfile = profile => profile?.role === "super_admin" ? { ...profile, role: "admin" } : profile;
  function allowedPagesForRole(role) {
    if (role === "user") return ["dashboard", ...userPortalPages];
    if (role === "staff") return ["dashboard", "programs"];
    if (role === "admin") return Object.keys(pageTitles).filter(page => !userPortalPages.includes(page));
    return [];
  }
  function pageFromLocation(role) {
    const requestedPage = window.location.hash.slice(1);
    return allowedPagesForRole(role).includes(requestedPage) ? requestedPage : "dashboard";
  }
  function applyWorkspaceRole(profile) {
    const isCommunityUser = profile.role === "user";
    const workspaceLabels = {
      user: "COMMUNITY PORTAL",
      staff: "INSTRUCTOR WORKSPACE",
      admin: "ADMIN WORKSPACE",
    };
    const workspaceDescriptions = {
      user: "Community preparedness",
      staff: "Assigned training programs",
      admin: "Preparedness operations",
    };
    const allowedPages = allowedPagesForRole(profile.role);
    const appShell = document.getElementById("app-shell");
    appShell.classList.toggle("user-portal", isCommunityUser);
    appShell.dataset.workspaceRole = profile.role;
    document.getElementById("workspace-label").textContent = workspaceLabels[profile.role];
    document.querySelector(".brand small").textContent = workspaceDescriptions[profile.role];
    document.querySelector(".main-nav").setAttribute("aria-label", `${roleLabel(profile.role)} workspace navigation`);
    const userNavLabels = { dashboard: "My Dashboard" };
    document.querySelectorAll(".nav-link").forEach(button => {
      const page = button.dataset.page;
      button.classList.toggle("hidden", !allowedPages.includes(page) || (page === "users" && workspaceOffline));
      button.querySelector(".nav-label").textContent = isCommunityUser ? (userNavLabels[page] || pageTitles[page]) : pageTitles[page];
      if (page === "notifications" && isCommunityUser) {
        const unreadCount = userNotifications.filter(notification => !notification.read_at).length;
        button.querySelector(".nav-label").textContent = unreadCount
          ? `Notifications & SMS (${unreadCount})`
          : "Notifications & SMS";
      }
    });
    document.getElementById("user-identity").innerHTML = `<strong>${escapeHTML(profile.full_name || profile.email)}</strong><small>${roleLabel(profile.role)}${isCommunityUser ? " · Community account" : ""}</small>`;
    document.getElementById("user-avatar").textContent = workspaceInitials(profile);
    document.getElementById("user-avatar").setAttribute("aria-label", `Account menu for ${profile.full_name || profile.email}`);
  }
  function workspaceInitials(profile) {
    return (profile.full_name || profile.email || "A").split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
  }
  function setProfileFeedback(elementId, message, success = false) {
    const element = document.getElementById(elementId);
    element.textContent = message;
    element.classList.toggle("is-success", success);
    element.classList.toggle("is-error", Boolean(message) && !success);
  }
  function openProfileSettings() {
    if (!currentProfile) return;
    document.getElementById("profile-full-name").value = currentProfile.full_name || "";
    document.getElementById("profile-phone").value = currentProfile.phone || "";
    document.getElementById("profile-email").value = currentProfile.email || "";
    document.getElementById("profile-settings-avatar").textContent = workspaceInitials(currentProfile);
    document.getElementById("profile-settings-role").textContent = roleLabel(currentProfile.role);
    ["profile-details-feedback", "profile-email-feedback", "profile-password-feedback"].forEach(id => setProfileFeedback(id, ""));
    document.getElementById("profile-offline-notice").classList.toggle("hidden",
      !(workspaceOffline || offlineWorkspaceOnly || !navigator.onLine));
    document.getElementById("profile-menu").classList.add("hidden");
    document.getElementById("user-avatar").setAttribute("aria-expanded", "false");
    document.getElementById("profile-settings-dialog").showModal();
  }

  function todayDate() { return new Date().toISOString().slice(0, 10); }
  function futureDate(offset) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  function uid(prefix) {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function emptyData() { return Object.fromEntries(Object.keys(demoData).map(key => [key, []])); }
  function stableSerialize(value) {
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
  function recordsEqual(left, right) { return stableSerialize(left) === stableSerialize(right); }
  function isConnectivityError(error) {
    return !navigator.onLine || error?.status === 0 ||
      /failed to fetch|network error|network request failed|load failed|internet connection/i.test(error?.message || "");
  }
  function createWorkspaceSnapshot(snapshotData = data) {
    return {
      userId: currentProfile.id,
      profile: clone(currentProfile),
      data: clone(snapshotData),
      updatedAt: new Date().toISOString()
    };
  }
  async function saveWorkspaceSnapshot() {
    if (!currentProfile || !window.OneCaintaOffline) return;
    await window.OneCaintaOffline.saveSnapshot(createWorkspaceSnapshot());
  }
  function setRecordInData(target, collection, recordId, value) {
    const existingIndex = target[collection].findIndex(record => record.id === recordId);
    if (existingIndex >= 0) target[collection].splice(existingIndex, 1);
    if (value) target[collection].push(clone(value));
  }
  async function applyPendingWorkspaceChanges() {
    if (!currentProfile || !window.OneCaintaOffline) return;
    const [changes, conflicts] = await Promise.all([
      window.OneCaintaOffline.getChanges(currentProfile.id),
      window.OneCaintaOffline.getConflicts(currentProfile.id)
    ]);
    for (const change of changes) {
      if (canApplyPendingChange(change) && Object.hasOwn(data, change.collection)) {
        setRecordInData(data, change.collection, change.recordId, change.local);
      }
    }
    for (const conflict of conflicts) {
      if (canViewWorkspaceConflict(conflict) && Object.hasOwn(data, conflict.collection)) {
        setRecordInData(data, conflict.collection, conflict.recordId, conflict.local);
      }
    }
    workspaceConflicts = conflicts.filter(canViewWorkspaceConflict);
  }
  async function updateWorkspaceSyncStatus() {
    const button = document.getElementById("sync-status-button");
    if (!button) return;
    button.hidden = !currentProfile;
    if (!currentProfile || !window.OneCaintaOffline) return;
    try {
      const [changes, conflicts] = await Promise.all([
        window.OneCaintaOffline.getChanges(currentProfile.id),
        window.OneCaintaOffline.getConflicts(currentProfile.id)
      ]);
      workspaceConflicts = conflicts.filter(canViewWorkspaceConflict);
      button.classList.toggle("is-offline", workspaceOffline || !navigator.onLine);
      button.classList.toggle("has-pending", changes.length > 0);
      button.classList.toggle("has-conflicts", workspaceConflicts.length > 0);
      const note = document.querySelector(".local-note");
      if (note) {
        note.querySelector("strong").textContent = workspaceOffline || !navigator.onLine ? "Offline workspace" : "Secure workspace";
        note.querySelector("small").textContent = workspaceOffline || !navigator.onLine
          ? "Saved changes stay on this device"
          : "Supabase cloud database";
      }
      if (workspaceSyncInFlight) {
        button.textContent = "Syncing...";
        button.title = "Syncing saved workspace changes";
      } else if (workspaceConflicts.length) {
        button.textContent = `Review conflicts (${workspaceConflicts.length})`;
        button.title = "Choose which copy to keep for each conflicting record";
      } else if (offlineWorkspaceOnly && navigator.onLine) {
        button.textContent = changes.length ? `Sign in to sync (${changes.length})` : "Sign in to refresh";
        button.title = "Sign in again while online to refresh your saved session and synchronize this device";
      } else if (changes.length) {
        button.textContent = `${changes.length} change${changes.length === 1 ? "" : "s"} waiting`;
        button.title = workspaceOffline || !navigator.onLine
          ? "Changes are saved on this device and will sync when the internet returns"
          : "Workspace changes are waiting to sync";
      } else if (workspaceOffline || !navigator.onLine) {
        button.textContent = "Offline";
        button.title = "Using workspace data saved on this device";
      } else {
        button.textContent = "Synced";
        button.title = "Workspace data is synchronized";
      }
    } catch (error) {
      console.error("Unable to check offline workspace status:", error);
      button.textContent = "Local storage unavailable";
      button.title = error.message;
    }
  }
  function conflictRecordLabel(conflict) {
    const record = conflict.local || conflict.remote || conflict.base;
    return record?.title || record?.name || `${schemas[conflict.collection]?.title || conflict.collection} ${conflict.recordId}`;
  }
  function conflictFieldsHTML(conflict, value, label) {
    if (!value) return `<p class="offline-conflict-deleted">${escapeHTML(label)}: record deleted</p>`;
    const fields = schemas[conflict.collection]?.fields || [];
    const changedFields = fields.filter(field =>
      stableSerialize(conflict.local?.[field.key] ?? null) !== stableSerialize(conflict.remote?.[field.key] ?? null)
    );
    const descriptions = changedFields.map(field => {
      const fieldValue = value[field.key];
      const text = fieldValue === undefined || fieldValue === "" ? "—" : String(fieldValue);
      return `<div class="offline-conflict-field"><strong>${escapeHTML(field.label)}</strong><span>${escapeHTML(text)}</span></div>`;
    }).join("");
    return `<p class="offline-conflict-copy-label">${escapeHTML(label)}</p><div class="offline-conflict-fields">${descriptions || "<span>No field differences</span>"}</div>`;
  }
  function renderWorkspaceConflicts() {
    const list = document.getElementById("offline-conflicts-list");
    list.innerHTML = workspaceConflicts.map(conflict => `
      <article class="offline-conflict-card">
        <h3>${escapeHTML(conflictRecordLabel(conflict))}</h3>
        <div class="offline-conflict-columns">
          <section>${conflictFieldsHTML(conflict, conflict.local, "This device")}</section>
          <section>${conflictFieldsHTML(conflict, conflict.remote, "Online copy")}</section>
        </div>
        <div class="offline-conflict-actions">
          <button class="button button-secondary" type="button" data-conflict-choice="remote" data-conflict-key="${escapeHTML(conflict.key)}">Use online copy</button>
          <button class="button button-primary" type="button" data-conflict-choice="local" data-conflict-key="${escapeHTML(conflict.key)}"${canKeepConflictEdit(conflict) ? "" : ' disabled title="Your role cannot keep this offline edit"'}>Keep this device's edit</button>
        </div>
      </article>`).join("");
    if (!workspaceConflicts.length) {
      document.getElementById("offline-conflicts-dialog").close();
    }
  }
  async function resolveWorkspaceConflict(key, choice) {
    const conflict = workspaceConflicts.find(item => item.key === key);
    if (!conflict || !currentProfile) return;
    if (choice === "local" && !canKeepConflictEdit(conflict)) {
      showToast("Your role cannot keep this offline edit.", true);
      return;
    }
    if (choice === "local") {
      await window.OneCaintaOffline.saveChange({
        userId: conflict.userId,
        key: conflict.key,
        collection: conflict.collection,
        recordId: conflict.recordId,
        base: clone(conflict.remote),
        local: clone(conflict.local),
        updatedAt: new Date().toISOString()
      });
    } else {
      setRecordInData(data, conflict.collection, conflict.recordId, conflict.remote);
      await window.OneCaintaOffline.deleteChange(conflict.userId, conflict.key);
    }
    await window.OneCaintaOffline.deleteConflict(conflict.userId, conflict.key);
    workspaceConflicts = await window.OneCaintaOffline.getConflicts(currentProfile.id);
    await saveWorkspaceSnapshot();
    render();
    renderWorkspaceConflicts();
    await updateWorkspaceSyncStatus();
    if (navigator.onLine && !workspaceOffline) await syncWorkspaceChanges();
  }
  function workspaceRecordsFromRows(rows) {
    const result = emptyData();
    rows.forEach(row => {
      if (Object.hasOwn(result, row.collection) && row.payload?.id === row.record_id) {
        result[row.collection].push(row.payload);
      }
    });
    return result;
  }
  function workspaceDataForRole(profile, workspaceData) {
    if (profile.role === "staff") {
      return {
        ...emptyData(),
        programs: workspaceData.programs.filter(program => program.instructorId === profile.id)
      };
    }
    if (profile.role !== "user") return workspaceData;
    const ownParticipants = workspaceData.participants.filter(person =>
      person.userId === profile.id
    );
    const ownParticipantIds = new Set(ownParticipants.map(person => person.id));
    return {
      ...emptyData(),
      programs: workspaceData.programs,
      scenarios: workspaceData.scenarios,
      participants: ownParticipants,
      evaluations: workspaceData.evaluations.filter(evaluation => ownParticipantIds.has(evaluation.participantId))
    };
  }
  async function fetchWorkspaceRecords() {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: records, error } = await supabaseClient.from("workspace_records")
        .select("collection,record_id,payload").order("collection").order("record_id")
        .range(offset, offset + 999);
      if (error) throw error;
      rows.push(...records);
      if (records.length < 1000) break;
    }
    return workspaceRecordsFromRows(rows);
  }
  async function refreshUserNotifications(showError = false) {
    if (currentProfile?.role !== "user" || !supabaseClient || !navigator.onLine) return;
    const { data: notifications, error } = await supabaseClient.from("user_notifications")
      .select("id,title,message,program_id,created_at,read_at")
      .order("created_at", { ascending: false }).limit(100);
    if (error) {
      console.error("Unable to load user notifications:", error);
      if (showError) showToast(`Notifications could not be loaded: ${error.message}`, true);
      return;
    }
    userNotifications = notifications;
    applyWorkspaceRole(currentProfile);
    if (currentPage === "notifications") renderUserNotifications();
  }
  async function syncWorkspaceChanges(propagateErrors = false) {
    if (workspaceSyncInFlight || !currentSession || !currentProfile || !supabaseClient || !navigator.onLine) return;
    workspaceSyncInFlight = true;
    await updateWorkspaceSyncStatus();
    try {
      const { data: fetchedProfile, error: profileError } = await supabaseClient.from("user_profiles")
        .select("id,email,full_name,phone,role,created_at").eq("id", currentSession.user.id).single();
      if (profileError?.code === "PGRST116") {
        await forceSignOut("Your One Cainta profile is no longer available.");
        return;
      }
      if (profileError?.status === 401) {
        offlineWorkspaceOnly = true;
        workspaceOffline = true;
        showToast("Your saved sign-in expired. Sign in again to sync offline changes.", true);
        return;
      }
      if (profileError) throw profileError;
      const profile = normalizeProfile(fetchedProfile);
      if (!["user", "staff", "admin"].includes(profile.role)) {
        await forceSignOut("Your One Cainta access was removed.");
        return;
      }
      currentProfile = profile;
      applyWorkspaceRole(profile);
      const remoteData = await fetchWorkspaceRecords();
      const changes = await window.OneCaintaOffline.getChanges(profile.id);
      const conflicts = await window.OneCaintaOffline.getConflicts(profile.id);
      const existingConflictKeys = new Set(conflicts.map(conflict => conflict.key));
      const upserts = [];
      const deletes = [];
      const newProgramIds = [];
      const readyToClear = [];

      for (const change of changes) {
        if (existingConflictKeys.has(change.key)) continue;
        const remote = remoteData[change.collection].find(record => record.id === change.recordId) || null;
        if (recordsEqual(remote, change.local)) {
          readyToClear.push(change);
        } else if (recordsEqual(remote, change.base)) {
          if (change.local) {
            upserts.push({ collection: change.collection, record_id: change.recordId, payload: change.local });
            if (change.collection === "programs" && !remote) newProgramIds.push(change.recordId);
          }
          else deletes.push({ collection: change.collection, record_id: change.recordId });
          readyToClear.push(change);
        } else {
          await window.OneCaintaOffline.saveConflict({ ...change, remote, detectedAt: new Date().toISOString() });
          await window.OneCaintaOffline.deleteChange(profile.id, change.key);
        }
      }

      if ((upserts.length || deletes.length) && !canSyncWorkspaceChanges(upserts, deletes, remoteData)) {
        throw new Error("Your role cannot sync one or more of these offline changes. Your saved changes are still on this device.");
      }
      if (upserts.length || deletes.length) {
        const { error } = await supabaseClient.rpc("sync_workspace_records", {
          p_upserts: upserts,
          p_deletes: deletes
        });
        if (error) throw error;
      }
      if (currentProfile.role === "admin" && newProgramIds.length) {
        for (const programId of newProgramIds) {
          const { error } = await supabaseClient.functions.invoke("notify-new-training", { body: { programId } });
          if (error) {
            console.error(`Unable to send email alerts for new training ${programId}:`, error);
            showToast(`Training was published with in-app alerts, but email delivery failed: ${error.message}. Check Gmail setup and retry email alerts from the Admin dashboard.`, true);
          }
        }
      }
      for (const change of readyToClear) {
        await window.OneCaintaOffline.deleteChange(profile.id, change.key);
      }
      for (const record of upserts) {
        setRecordInData(remoteData, record.collection, record.record_id, record.payload);
      }
      for (const record of deletes) {
        setRecordInData(remoteData, record.collection, record.record_id, null);
      }
      data = remoteData;
      workspaceOffline = false;
      await applyPendingWorkspaceChanges();
      await saveWorkspaceSnapshot();
      render();
      if (workspaceConflicts.length) {
        showToast(`${workspaceConflicts.length} offline change${workspaceConflicts.length === 1 ? "" : "s"} need review.`);
      }
    } catch (error) {
      if (isConnectivityError(error)) {
        workspaceOffline = true;
      } else {
        console.error("Unable to synchronize offline workspace changes:", error);
        showToast(`Sync needs attention: ${error.message}`, true);
        if (propagateErrors) throw error;
      }
    } finally {
      workspaceSyncInFlight = false;
      await updateWorkspaceSyncStatus();
    }
  }
  async function saveData(previousData) {
    if (!canManageWorkspace() && !canManageAssignedPrograms() && currentProfile?.role !== "user") {
      throw new Error("This account cannot change workspace records.");
    }
    if (!currentSession || !currentProfile || !window.OneCaintaOffline) throw new Error("The secure workspace is not connected.");
    if (!workspaceOffline && navigator.onLine && supabaseClient) {
      const queuedChanges = await window.OneCaintaOffline.getChanges(currentProfile.id);
      if (queuedChanges.length) await syncWorkspaceChanges();
    }
    const changes = [];
    for (const collection of Object.keys(demoData)) {
      const before = previousData[collection];
      const after = data[collection];
      const beforeById = new Map(before.map(item => [item.id, item]));
      const afterById = new Map(after.map(item => [item.id, item]));
      const changedIds = new Set([
        ...beforeById.keys(),
        ...afterById.keys()
      ]);
      for (const recordId of changedIds) {
        const previous = beforeById.get(recordId) || null;
        const local = afterById.get(recordId) || null;
        if (!recordsEqual(previous, local)) changes.push({ collection, recordId, before: previous, local });
      }
    }
    if (!changes.length) return;
    if (!canManageWorkspace() && !changes.every(change =>
      (canManageAssignedPrograms() &&
        change.collection === "programs" &&
        change.before?.instructorId === currentProfile.id &&
        change.local?.instructorId === currentProfile.id) ||
      canEditUserEnrollment(change)
    )) throw new Error("This account can change only its own training enrollments or its assigned programs.");
    const userId = currentProfile.id;
    const previousPending = new Map();
    const queuedChanges = [];
    const deleteKeys = [];
    for (const change of changes) {
      const key = `${change.collection}:${change.recordId}`;
      const existing = await window.OneCaintaOffline.getChange(userId, key);
      previousPending.set(key, existing || null);
      const base = existing ? existing.base : change.before;
      if (recordsEqual(base, change.local)) {
        deleteKeys.push(key);
      } else {
        queuedChanges.push({
          userId,
          key,
          collection: change.collection,
          recordId: change.recordId,
          base: clone(base),
          local: clone(change.local),
          updatedAt: new Date().toISOString()
        });
      }
    }
    await window.OneCaintaOffline.saveChangesAndSnapshot(queuedChanges, deleteKeys, createWorkspaceSnapshot());
    if (!navigator.onLine || workspaceOffline || !supabaseClient) {
      workspaceOffline = true;
      await updateWorkspaceSyncStatus();
      return;
    }
    try {
      await syncWorkspaceChanges(true);
    } catch (error) {
      data = clone(previousData);
      await window.OneCaintaOffline.saveChangesAndSnapshot(
        [...previousPending.values()].filter(Boolean),
        [...previousPending].filter(([, existing]) => !existing).map(([key]) => key),
        createWorkspaceSnapshot()
      );
      throw error;
    }
  }
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }
  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? escapeHTML(value) : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(date);
  }
  function accountActivityLabel(lastSeenAt) {
    const lastSeen = lastSeenAt ? new Date(lastSeenAt) : null;
    if (!lastSeen || Number.isNaN(lastSeen.getTime())) return "Not recorded yet";
    const elapsedSeconds = Math.max(0, (Date.now() - lastSeen.getTime()) / 1000);
    if (elapsedSeconds < 45) return "Active now";
    const units = [
      ["second", 60],
      ["minute", 60],
      ["hour", 24],
      ["day", 30],
      ["month", 12],
      ["year", Infinity]
    ];
    let value = elapsedSeconds;
    let unit = "second";
    for (const [nextUnit, threshold] of units) {
      unit = nextUnit;
      if (value < threshold || threshold === Infinity) break;
      value /= threshold;
    }
    return new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(-Math.floor(value), unit);
  }
  function updateAccountActivityElement(element, lastSeenAt) {
    const lastSeen = lastSeenAt ? new Date(lastSeenAt) : null;
    const isValidDate = lastSeen && !Number.isNaN(lastSeen.getTime());
    const isOnline = isValidDate && Date.now() - lastSeen.getTime() < 45_000;
    element.classList.toggle("is-online", Boolean(isOnline));
    element.classList.toggle("is-offline", !isOnline);
    element.querySelector(".account-activity-label").textContent = accountActivityLabel(lastSeenAt);
    element.title = isValidDate
      ? `Last workspace activity ${new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(lastSeen)}`
      : "No workspace activity has been recorded yet";
  }
  async function recordWorkspaceActivity() {
    if (!currentSession || !currentProfile || workspaceOffline || !navigator.onLine || !supabaseClient || document.visibilityState !== "visible" || activityUpdateInFlight) return;
    activityUpdateInFlight = true;
    try {
      const { error } = await supabaseClient.rpc("record_workspace_activity");
      if (error) console.error("Unable to record workspace activity:", error);
    } finally {
      activityUpdateInFlight = false;
    }
  }
  function startWorkspaceActivityTracking() {
    if (workspaceOffline || !navigator.onLine || !supabaseClient) return;
    if (workspaceActivityTimer !== null) window.clearInterval(workspaceActivityTimer);
    void recordWorkspaceActivity();
    workspaceActivityTimer = window.setInterval(() => { void recordWorkspaceActivity(); }, 30_000);
  }
  function stopWorkspaceActivityTracking() {
    if (workspaceActivityTimer !== null) window.clearInterval(workspaceActivityTimer);
    workspaceActivityTimer = null;
  }
  function isAuthenticatedWorkspaceActive() {
    return Boolean(currentSession && currentProfile && !document.getElementById("app-shell").classList.contains("hidden"));
  }
  function stopWorkspaceIdleTimeout() {
    if (workspaceIdleTimer !== null) window.clearTimeout(workspaceIdleTimer);
    if (workspaceIdleCountdownTimer !== null) window.clearInterval(workspaceIdleCountdownTimer);
    workspaceIdleTimer = null;
    workspaceIdleCountdownTimer = null;
    workspaceIdleDeadline = 0;
    workspaceIdleLogoutInFlight = false;
    idleTimeoutBackdrop.classList.add("hidden");
    idleTimeoutContinueButton.disabled = false;
    idleTimeoutSignOutButton.disabled = false;
    idleTimeoutSignOutButton.textContent = "Sign out";
  }
  function updateWorkspaceIdleCountdown() {
    const remainingMs = workspaceIdleDeadline - Date.now();
    if (remainingMs <= 0) {
      if (workspaceIdleCountdownTimer !== null) window.clearInterval(workspaceIdleCountdownTimer);
      workspaceIdleCountdownTimer = null;
      void endWorkspaceSessionAfterIdle();
      return;
    }
    idleTimeoutCountdown.textContent = String(Math.ceil(remainingMs / 1000));
  }
  function showWorkspaceIdleWarning() {
    if (!isAuthenticatedWorkspaceActive() || workspaceIdleLogoutInFlight) return;
    if (workspaceIdleTimer !== null) window.clearTimeout(workspaceIdleTimer);
    workspaceIdleTimer = null;
    workspaceIdleDeadline = Date.now() + WORKSPACE_IDLE_WARNING_MS;
    idleTimeoutBackdrop.classList.remove("hidden");
    updateWorkspaceIdleCountdown();
    if (workspaceIdleCountdownTimer !== null) window.clearInterval(workspaceIdleCountdownTimer);
    workspaceIdleCountdownTimer = window.setInterval(updateWorkspaceIdleCountdown, 1000);
    idleTimeoutContinueButton.focus();
  }
  function resetWorkspaceIdleTimeout() {
    if (!isAuthenticatedWorkspaceActive() || workspaceIdleLogoutInFlight) return;
    if (workspaceIdleTimer !== null) window.clearTimeout(workspaceIdleTimer);
    if (workspaceIdleCountdownTimer !== null) window.clearInterval(workspaceIdleCountdownTimer);
    workspaceIdleCountdownTimer = null;
    workspaceIdleDeadline = 0;
    idleTimeoutBackdrop.classList.add("hidden");
    idleTimeoutContinueButton.disabled = false;
    idleTimeoutSignOutButton.disabled = false;
    idleTimeoutSignOutButton.textContent = "Sign out";
    workspaceIdleDeadline = Date.now() + WORKSPACE_IDLE_TIMEOUT_MS;
    workspaceIdleTimer = window.setTimeout(showWorkspaceIdleWarning, WORKSPACE_IDLE_TIMEOUT_MS);
  }
  function startWorkspaceIdleTimeout() {
    stopWorkspaceIdleTimeout();
    if (!isAuthenticatedWorkspaceActive()) return;
    workspaceIdleLastActivityAt = 0;
    resetWorkspaceIdleTimeout();
  }
  function handleWorkspaceActivity(event) {
    if (!isAuthenticatedWorkspaceActive()) return;
    if (!idleTimeoutBackdrop.classList.contains("hidden") && idleTimeoutBackdrop.contains(event.target)) return;
    const now = Date.now();
    if (event.type === "mousemove" && now - workspaceIdleLastActivityAt < 1000) return;
    workspaceIdleLastActivityAt = now;
    resetWorkspaceIdleTimeout();
  }
  async function endWorkspaceSessionAfterIdle() {
    if (!isAuthenticatedWorkspaceActive() || workspaceIdleLogoutInFlight) return;
    workspaceIdleLogoutInFlight = true;
    if (workspaceIdleCountdownTimer !== null) window.clearInterval(workspaceIdleCountdownTimer);
    workspaceIdleCountdownTimer = null;
    idleTimeoutContinueButton.disabled = true;
    idleTimeoutSignOutButton.disabled = true;
    idleTimeoutSignOutButton.textContent = "Signing out...";
    try {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
      stopWorkspaceActivityTracking();
      stopWorkspaceIdleTimeout();
      currentSession = null;
      currentProfile = null;
      userNotifications = [];
      if (userNotificationTimer !== null) window.clearInterval(userNotificationTimer);
      userNotificationTimer = null;
      data = emptyData();
      document.getElementById("app-shell").classList.add("hidden");
      renderAuth("Your session ended after 10 minutes of inactivity.");
    } catch (error) {
      console.error("Unable to end the idle workspace session:", error);
      showToast(`Automatic sign out failed: ${error.message || "Please try again."}`, true);
      workspaceIdleLogoutInFlight = false;
      idleTimeoutContinueButton.disabled = false;
      idleTimeoutSignOutButton.disabled = false;
      idleTimeoutSignOutButton.textContent = "Sign out";
      resetWorkspaceIdleTimeout();
    }
  }
  function byId(collection, id) { return data[collection].find(item => item.id === id); }
  function programName(id) { return byId("programs", id)?.title || "Unassigned"; }
  function scenarioName(id) { return byId("scenarios", id)?.title || "Unassigned"; }
  function participantName(id) { return byId("participants", id)?.name || "Unassigned"; }
  function badge(status) {
    const color = ({ Scheduled: "blue", Confirmed: "green", Completed: "green", Pending: "amber", Cancelled: "red", Successful: "green", "Needs improvement": "amber", "Unsuccessful": "red", Low: "green", Medium: "amber", High: "red", Critical: "red" })[status] || "";
    return `<span class="badge ${color ? `badge-${color}` : ""}">${escapeHTML(status || "—")}</span>`;
  }
  function showToast(message, error = false) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.style.color = error ? "#9f3939" : "";
    toast.style.background = error ? "#fff5f4" : "";
    toast.style.borderColor = error ? "#f2d7d5" : "";
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
  }
  function updateThemeToggleButtons() {
    const isDark = document.documentElement.dataset.theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach(button => {
      button.textContent = isDark ? "☀" : "☾";
      button.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
      button.setAttribute("aria-pressed", String(isDark));
      button.title = `Switch to ${isDark ? "light" : "dark"} mode`;
    });
  }
  function setTheme(theme, toggleButton) {
    const root = document.documentElement;
    const bounds = toggleButton.getBoundingClientRect();
    root.style.setProperty("--theme-transition-x", `${bounds.left + bounds.width / 2}px`);
    root.style.setProperty("--theme-transition-y", `${bounds.top + bounds.height / 2}px`);

    const applyTheme = () => {
      root.dataset.theme = theme;
      updateThemeToggleButtons();
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch (error) {
        console.error("Unable to save the color theme preference:", error);
      }
    };

    if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(applyTheme);
      return;
    }
    applyTheme();
  }
  function authMessage(message, success = false) {
    const host = document.getElementById("auth-feedback");
    if (host) host.innerHTML = `<p class="auth-message${success ? " success" : ""}">${escapeHTML(message)}</p>`;
  }
  function loginAttemptStorageKey(email) {
    return `${LOGIN_ATTEMPT_KEY_PREFIX}${encodeURIComponent(email)}`;
  }
  function getLoginAttemptState(email) {
    const stored = localStorage.getItem(loginAttemptStorageKey(email));
    if (!stored) return { failures: 0, lastFailedAt: 0, lockedUntil: 0 };
    const state = JSON.parse(stored);
    if (!Number.isInteger(state.failures) || !Number.isFinite(state.lastFailedAt) || !Number.isFinite(state.lockedUntil)) {
      throw new Error("Stored sign-in attempt data is invalid. Clear this site's browser data or try another browser.");
    }
    if (state.lockedUntil && Date.now() >= state.lockedUntil) {
      localStorage.removeItem(loginAttemptStorageKey(email));
      return { failures: 0, lastFailedAt: 0, lockedUntil: 0 };
    }
    if (state.lastFailedAt && Date.now() - state.lastFailedAt > LOGIN_ATTEMPT_WINDOW_MS) {
      localStorage.removeItem(loginAttemptStorageKey(email));
      return { failures: 0, lastFailedAt: 0, lockedUntil: 0 };
    }
    return state;
  }
  function recordFailedLogin(email) {
    const state = getLoginAttemptState(email);
    if (state.lockedUntil > Date.now()) return state;
    const now = Date.now();
    const recentFailures = state.lastFailedAt && now - state.lastFailedAt <= LOGIN_ATTEMPT_WINDOW_MS ? state.failures : 0;
    const failures = recentFailures + 1;
    const nextState = {
      failures,
      lastFailedAt: now,
      lockedUntil: failures >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_LOCK_DURATION_MS : 0
    };
    localStorage.setItem(loginAttemptStorageKey(email), JSON.stringify(nextState));
    return nextState;
  }
  function clearFailedLogins(email) {
    localStorage.removeItem(loginAttemptStorageKey(email));
  }
  function isInvalidCredentialsError(error) {
    return error?.code === "invalid_credentials" ||
      (typeof error?.message === "string" && error.message.toLowerCase() === "invalid login credentials") ||
      (error?.status === 400 && error?.code !== "email_not_confirmed" && error?.code !== "user_banned");
  }
  function updateLoginLockUI() {
    if (loginLockTimer) {
      clearInterval(loginLockTimer);
      loginLockTimer = null;
    }
    const form = document.getElementById("login-form");
    const emailInput = document.getElementById("login-email");
    const submitButton = form?.querySelector('[type="submit"]');
    const feedback = document.getElementById("auth-feedback");
    if (!form || !emailInput || !submitButton || !feedback) return;
    const email = emailInput.value.trim().toLowerCase();
    if (!email) {
      submitButton.disabled = false;
      return;
    }
    const update = () => {
      const state = getLoginAttemptState(email);
      const remaining = Math.max(0, state.lockedUntil - Date.now());
      if (remaining > 0) {
        const seconds = Math.ceil(remaining / 1000);
        const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
        const remainder = String(seconds % 60).padStart(2, "0");
        submitButton.disabled = true;
        feedback.innerHTML = `<p class="auth-message auth-lockout" role="status" aria-live="polite">Too many failed attempts. Try again in ${minutes}:${remainder}.</p>`;
        return true;
      }
      submitButton.disabled = false;
      if (feedback.querySelector(".auth-lockout")) feedback.innerHTML = "";
      return false;
    };
    if (update()) loginLockTimer = setInterval(() => {
      if (!update()) {
        clearInterval(loginLockTimer);
        loginLockTimer = null;
      }
    }, 1000);
  }
  function clearWorkspacePageHash() {
    const requestedPage = window.location.hash.slice(1);
    if (!Object.hasOwn(pageTitles, requestedPage)) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  function showLanding() {
    clearWorkspacePageHash();
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("auth-shell").classList.add("hidden");
    document.getElementById("landing-page").classList.remove("hidden");
    document.getElementById("landing-page").classList.add("is-active");
  }
  function initializeLandingMotion() {
    const landing = document.getElementById("landing-page");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const revealTargets = landing.querySelectorAll(
      ".landing-section-heading, .landing-module, .landing-news-copy, .landing-news-card, .landing-cta"
    );
    if (!("IntersectionObserver" in window)) {
      revealTargets.forEach(target => target.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -36px 0px" });
    revealTargets.forEach(target => {
      const siblings = target.parentElement.querySelectorAll(".landing-module");
      if (siblings.length > 1) {
        const itemIndex = Array.prototype.indexOf.call(siblings, target);
        target.style.setProperty("--reveal-delay", `${itemIndex * 75}ms`);
      }
      observer.observe(target);
    });
  }
  function initializeMastheadScrollAnimation() {
    const masthead = document.querySelector(".landing-masthead");
    if (!masthead) return;
    const updateMasthead = () => {
      masthead.classList.toggle("is-compact", window.scrollY > 32);
    };
    window.addEventListener("scroll", updateMasthead, { passive: true });
    updateMasthead();
  }
  function readConfig() {
    try {
      const config = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
      if (config?.url && config?.anonKey) return config;
    } catch (error) {
      console.error("Unable to read Supabase connection settings:", error);
    }
    return DEFAULT_CONFIG;
  }
  function passwordField(id, name, label, autocomplete, minLength = 0) {
    const minimum = minLength ? ` minlength="${minLength}"` : "";
    return `<div class="form-field"><label for="${id}">${escapeHTML(label)}</label><div class="password-input-wrap"><input class="form-control" id="${id}" name="${name}" type="password"${minimum} required autocomplete="${autocomplete}"><button class="password-toggle" type="button" data-password-toggle="${id}" aria-label="Show ${escapeHTML(label.toLowerCase())}" aria-pressed="false" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle><path class="password-eye-slash hidden" d="m3 3 18 18"></path></svg></button></div></div>`;
  }
  function passwordRequirements(password) {
    return {
      length: password.length >= 8,
      case: /[a-z]/.test(password) && /[A-Z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^A-Za-z0-9]/.test(password)
    };
  }
  function meetsPasswordRequirements(password) {
    return Object.values(passwordRequirements(password)).every(Boolean);
  }
  function signupPasswordStrengthMarkup(inputId = "signup-password", panelId = "signup-password-strength") {
    return `<div class="password-strength" id="${panelId}" aria-live="polite">
      <p class="form-help password-strength-title">Password must meet the following requirements:</p>
      <ul class="password-checklist">
        <li data-password-rule="length"><span aria-hidden="true">○</span> At least 8 characters</li>
        <li data-password-rule="case"><span aria-hidden="true">○</span> Mixture of upper and lower case</li>
        <li data-password-rule="number"><span aria-hidden="true">○</span> Mixture of letters and numbers</li>
        <li data-password-rule="special"><span aria-hidden="true">○</span> At least one special character, e.g., ! @ # ? ]</li>
      </ul>
      <div class="password-strength-label">Strength: <strong data-strength-label>Not entered</strong></div>
      <div class="password-strength-track" role="progressbar" aria-label="Password strength" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span data-strength-bar></span></div>
      <p class="password-security-warning hidden" data-password-warning>This password is not secure. Try a different password.</p>
    </div>`;
  }
  function updateSignupPasswordStrength(inputId = "signup-password", panelId = "signup-password-strength") {
    const input = document.getElementById(inputId);
    const panel = document.getElementById(panelId);
    if (!input || !panel) return;
    const password = input.value;
    const rules = passwordRequirements(password);
    Object.entries(rules).forEach(([rule, passed]) => {
      const item = panel.querySelector(`[data-password-rule="${rule}"]`);
      item.classList.toggle("is-valid", passed);
      item.querySelector("span").textContent = passed ? "✓" : "○";
    });
    const completed = Object.values(rules).filter(Boolean).length;
    const score = completed === 4 ? 5 : completed;
    const strength = !password ? "Not entered" : completed === 4 ? "Strong" : score <= 2 ? "Weak" : "Medium";
    const percentage = Math.round((score / 5) * 100);
    panel.querySelector("[data-strength-label]").textContent = strength;
    panel.querySelector("[data-strength-bar]").style.width = `${percentage}%`;
    panel.querySelector(".password-strength-track").setAttribute("aria-valuenow", String(percentage));
    panel.dataset.strength = strength.toLowerCase().replace(" ", "-");
    panel.querySelector("[data-password-warning]").classList.toggle("hidden", !password || completed === 4);
  }
  function renderAuthCard(card, markup, mode) {
    if (authCardResizeAnimation) {
      authCardResizeAnimation.cancel();
      authCardResizeAnimation = null;
    }
    card.classList.remove("auth-card-resizing");
    const previousHeight = card.getBoundingClientRect().height;
    card.classList.remove("auth-card-enter");
    card.dataset.authMode = mode;
    card.innerHTML = markup;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nextHeight = card.getBoundingClientRect().height;
    if (previousHeight > 0 && nextHeight > 0 && previousHeight !== nextHeight) {
      card.classList.add("auth-card-resizing");
      const resizeAnimation = card.animate(
        [{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }],
        { duration: 420, easing: "cubic-bezier(.2,.75,.25,1)" }
      );
      authCardResizeAnimation = resizeAnimation;
      resizeAnimation.onfinish = () => {
        if (authCardResizeAnimation !== resizeAnimation) return;
        card.classList.remove("auth-card-resizing");
        card.style.removeProperty("height");
        authCardResizeAnimation = null;
      };
    }
    void card.offsetWidth;
    card.classList.add("auth-card-enter");
  }
  function renderAuth(message = "", success = false) {
    clearWorkspacePageHash();
    if (loginLockTimer) {
      clearInterval(loginLockTimer);
      loginLockTimer = null;
    }
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("landing-page").classList.add("hidden");
    document.getElementById("auth-shell").classList.remove("hidden");
    const config = readConfig();
    const card = document.getElementById("auth-card");
    if (!window.supabase?.createClient) {
      renderAuthCard(card, `<h1>Authentication library unavailable</h1><p class="auth-description">One Cainta could not load the Supabase client. Check your internet connection and reload the page.</p>`, "unavailable");
      return;
    }
    if (!config) {
      renderAuthCard(card, `<p class="eyebrow">FIRST-TIME SETUP</p><h1>Connect your Supabase project</h1><p class="auth-description">Enter your project's URL and publishable anon key. These are browser-safe public values; never enter a service-role key or database password here.</p>
        <form class="auth-form" id="connection-form">
          <div class="form-field"><label for="project-url">Project URL <span class="required">*</span></label><input class="form-control" id="project-url" name="url" type="url" value="https://sybjlkqrrkhxbfdumxuh.supabase.co" placeholder="https://your-project.supabase.co" required autocomplete="url"></div>
          <div class="form-field"><label for="anon-key">Publishable anon key <span class="required">*</span></label><input class="form-control" id="anon-key" name="anonKey" type="password" placeholder="sb_publishable_... or legacy anon key" required autocomplete="off"></div>
          <button class="button button-primary" type="submit">Connect project</button>
        </form><div id="auth-feedback">${message ? `<p class="auth-message">${escapeHTML(message)}</p>` : ""}</div>`, "connection");
      return;
    }
    const feedback = `<div id="auth-feedback">${message ? `<p class="auth-message${success ? " success" : ""}">${escapeHTML(message)}</p>` : ""}</div>`;
    const signInTabs = `<div class="auth-tabs" role="tablist" aria-label="Account access"><button class="auth-tab${authMode === "login" ? " is-active" : ""}" type="button" role="tab" aria-selected="${authMode === "login"}" data-auth-action="login">Sign in</button><button class="auth-tab${authMode === "signup" ? " is-active" : ""}" type="button" role="tab" aria-selected="${authMode === "signup"}" data-auth-action="signup">Register</button></div>`;
    const googleSignIn = `<button class="google-auth-button" type="button" data-auth-action="google-oauth"><svg class="google-auth-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.42 38.02 46.98 31.8 46.98 24.55Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.14 1.44-4.89 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg><span>Continue with Google</span></button><div class="auth-divider"><span>OR</span></div>`;
    if (authMode === "confirmation") {
      renderAuthCard(card, `<div class="confirmation-notice"><p class="eyebrow">CHECK YOUR EMAIL</p><h1>Confirm your email address</h1><p class="auth-description">We sent a confirmation link to <strong>${escapeHTML(pendingConfirmationEmail)}</strong>. Open that email and click the link to verify your address. You must confirm before signing in with your password.</p></div><button class="button button-primary" type="button" data-auth-action="resend-confirmation">Resend confirmation email</button>${feedback}<p class="auth-register-prompt">Entered the wrong email? <button class="text-button" type="button" data-auth-action="signup">Back to Register</button></p><p class="auth-register-prompt">Already confirmed? <button class="text-button" type="button" data-auth-action="login">Back to Sign In</button></p>`, "confirmation");
      return;
    }
    if (authMode === "account-created") {
      renderAuthCard(card, `<div class="confirmation-notice account-created-notice"><span class="account-created-icon" aria-hidden="true">✓</span><p class="eyebrow">EMAIL CONFIRMED</p><h1>Account Created</h1><p class="auth-description">Your email address <strong>${escapeHTML(pendingConfirmationEmail)}</strong> is confirmed and your account has been saved. You can now sign in to One Cainta.</p></div>${feedback}<button class="button button-primary account-created-signin" type="button" data-auth-action="login">Sign In <span aria-hidden="true">→</span></button>`, "account-created");
      return;
    }
    if (authMode === "signup") {
      renderAuthCard(card, `<div class="auth-welcome"><h1>Create your account</h1></div>${signInTabs}${googleSignIn}<form class="auth-form" id="signup-form">
          <div class="form-field"><label for="signup-name">Full name</label><input class="form-control" id="signup-name" name="fullName" type="text" maxlength="100" required autocomplete="name"></div>
          <div class="form-field"><label for="signup-email">Email address</label><input class="form-control" id="signup-email" name="email" type="email" required autocomplete="email"></div>
          ${passwordField("signup-password", "password", "Password", "new-password", 8)}
          ${signupPasswordStrengthMarkup()}
          ${passwordField("signup-confirm-password", "confirmPassword", "Confirm password", "new-password", 8)}
          <button class="button button-primary auth-submit" type="submit">Create account <span aria-hidden="true">→</span></button>
        </form>${feedback}<p class="auth-register-prompt">Already have an account? <button class="text-button" type="button" data-auth-action="login">Sign in</button></p>`, "signup");
      return;
    }
    if (authMode === "forgot") {
      renderAuthCard(card, `<div class="auth-welcome"><h1>Forgot password?</h1><p>Enter your email address and we’ll send a password reset link.</p></div>
        <form class="auth-form" id="forgot-password-form">
          <div class="form-field"><label for="recovery-email">Email address</label><input class="form-control" id="recovery-email" name="email" type="email" required autocomplete="email"></div>
          <button class="button button-primary auth-submit" type="submit">Send reset link <span aria-hidden="true">→</span></button>
        </form>${feedback}<div class="auth-divider"></div><button class="text-button" type="button" data-auth-action="login">← Back to Sign In</button>`, "forgot");
      return;
    }
    renderAuthCard(card, `<div class="auth-welcome"><h1>Welcome back</h1></div>${signInTabs}${googleSignIn}
      <form class="auth-form" id="login-form">
        <div class="form-field"><label for="login-email">Email</label><input class="form-control" id="login-email" name="email" type="email" value="${escapeHTML(pendingConfirmationEmail)}" placeholder="you@example.com" required autocomplete="email"></div>
        ${passwordField("login-password", "password", "Password", "current-password")}
        <div class="auth-forgot-row"><button class="text-button" type="button" data-auth-action="forgot">Forgot password?</button></div>
        <button class="button button-primary auth-submit" type="submit">Sign In <span aria-hidden="true">→</span></button>
      </form>${feedback}<p class="auth-register-prompt">Don't have an account? <button class="text-button" type="button" data-auth-action="signup">Register</button></p>`, "login");
    updateLoginLockUI();
  }
  function renderPasswordSetup(message = "") {
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("landing-page").classList.add("hidden");
    document.getElementById("auth-shell").classList.remove("hidden");
    const isRecovery = passwordRecovery || new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
    document.getElementById("auth-card").innerHTML = `<p class="eyebrow">${isRecovery ? "ACCOUNT RECOVERY" : "ACCOUNT INVITATION"}</p><h1>${isRecovery ? "Choose a new password" : "Accept your invitation"}</h1><p class="auth-description">Set your password, then sign in with your email and password.</p>
      <form class="auth-form" id="password-setup-form">${passwordField("new-password", "password", "New password", "new-password", 8)}${passwordField("confirm-password", "confirmPassword", "Confirm password", "new-password", 8)}${signupPasswordStrengthMarkup("new-password", "setup-password-strength")}<button class="button button-primary" type="submit">Set password and continue</button></form><div id="auth-feedback">${message ? `<p class="auth-message">${escapeHTML(message)}</p>` : ""}</div>`;
  }
  async function restoreOfflineWorkspace(userId) {
    if (!userId) return false;
    const snapshot = await window.OneCaintaOffline.loadSnapshot(userId);
    if (!snapshot || snapshot.profile?.id !== userId) return false;
    const profile = normalizeProfile(snapshot.profile);
    if (!["user", "staff", "admin"].includes(profile.role)) return false;
    currentSession = { user: { id: userId } };
    currentProfile = profile;
    data = clone(snapshot.data);
    workspaceOffline = true;
    offlineWorkspaceOnly = true;
    await applyPendingWorkspaceChanges();
    document.getElementById("landing-page").classList.add("hidden");
    document.getElementById("auth-shell").classList.add("hidden");
    applyWorkspaceRole(currentProfile);
    currentPage = pageFromLocation(currentProfile.role);
    document.getElementById("app-shell").classList.remove("hidden");
    render();
    stopWorkspaceActivityTracking();
    stopWorkspaceIdleTimeout();
    await updateWorkspaceSyncStatus();
    showToast("Offline mode: showing the last data saved on this device.");
    return true;
  }
  async function initializeSupabase(config) {
    const hashType = new URLSearchParams(window.location.hash.slice(1)).get("type");
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const searchParams = new URLSearchParams(window.location.search);
    const queryType = searchParams.get("type");
    const tokenHash = searchParams.get("token_hash");
    const emailLinkType = ["signup", "recovery", "invite"].includes(queryType) ? queryType : null;
    const signupConfirmationRedirect = hashType === "signup" || queryType === "signup" ||
      (searchParams.get("auth") === "signup-confirmation" &&
        (searchParams.has("code") || hashParams.has("access_token") || Boolean(tokenHash)));
    passwordRecovery = hashType === "recovery" || queryType === "recovery";
    invitationRedirect = ["invite", "recovery"].includes(hashType) || ["invite", "recovery"].includes(queryType);
    supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        flowType: "implicit",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage
      }
    });
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        passwordRecovery = true;
        invitationRedirect = true;
        inviteSession = session;
        renderPasswordSetup();
        return;
      }
      if (event === "SIGNED_OUT") {
        window.OneCaintaOffline.clearRememberedUser();
        stopWorkspaceActivityTracking();
        stopWorkspaceIdleTimeout();
        currentSession = null;
        currentProfile = null;
        userNotifications = [];
        if (userNotificationTimer !== null) window.clearInterval(userNotificationTimer);
        userNotificationTimer = null;
        offlineWorkspaceOnly = false;
        workspaceOffline = false;
        data = emptyData();
        if (authMode === "account-created") return;
        document.getElementById("app-shell").classList.add("hidden");
        renderAuth("You have been signed out.");
      }
    });
    if (tokenHash) {
      if (!emailLinkType) {
        authMode = "login";
        renderAuth("This email link is invalid or expired. Request a new confirmation or password reset email.");
        return;
      }
      const { error: verificationError } = await supabaseClient.auth.verifyOtp({
        token_hash: tokenHash,
        type: emailLinkType
      });
      if (verificationError) {
        console.error("Unable to verify the email link:", verificationError);
        authMode = "login";
        renderAuth("This email link is invalid or expired. Request a new confirmation or password reset email.");
        return;
      }
      window.history.replaceState(null, "", window.location.pathname);
    }
    const { data: result, error } = await supabaseClient.auth.getSession();
    if (error) {
      if (isConnectivityError(error) &&
          await restoreOfflineWorkspace(await window.OneCaintaOffline.getRememberedUserId())) return;
      throw error;
    }
    if (signupConfirmationRedirect) {
      if (!result.session) {
        authMode = "login";
        renderAuth("Email confirmation could not be completed. Open the newest confirmation link in your email and try again.");
        return;
      }
      await finishSignupConfirmation(result.session);
    } else if (result.session && (invitationRedirect || passwordRecovery)) {
      inviteSession = result.session;
      renderPasswordSetup();
    } else if (result.session) await startWorkspace(result.session);
    else if (!navigator.onLine && await restoreOfflineWorkspace(await window.OneCaintaOffline.getRememberedUserId())) return;
    else if (invitationRedirect || window.location.pathname === "/account-created" || window.location.hash === "#login") renderAuth();
    else showLanding();
  }
  async function finishSignupConfirmation(session) {
    const email = session.user.email || pendingConfirmationEmail;
    if (!session.user.email_confirmed_at) {
      const { error: signOutError } = await supabaseClient.auth.signOut();
      if (signOutError) console.error("Unable to clear the unconfirmed signup session:", signOutError);
      authMode = "login";
      renderAuth("Your email is not confirmed yet. Open the confirmation link from your email and try again.");
      return;
    }

    const { data: profile, error: profileError } = await supabaseClient.from("user_profiles")
      .select("id,role").eq("id", session.user.id).maybeSingle();
    if (profileError || !profile) {
      console.error("Unable to verify the confirmed signup profile:", profileError || "Profile not found");
      const { error: signOutError } = await supabaseClient.auth.signOut();
      if (signOutError) console.error("Unable to clear the confirmed signup session:", signOutError);
      authMode = "login";
      renderAuth("Your email is confirmed, but the account profile could not be verified. Please contact the system administrator before signing in.");
      return;
    }

    pendingConfirmationEmail = email;
    authMode = "account-created";
    const { error: signOutError } = await supabaseClient.auth.signOut();
    if (signOutError) {
      console.error("Unable to end the temporary signup confirmation session:", signOutError);
      renderAuth("Your account was created, but the temporary confirmation session could not be cleared. Please sign in again after refreshing this page.", true);
      return;
    }
    window.history.replaceState(null, "", window.location.pathname);
    renderAuth();
  }
  async function startWorkspace(session) {
    currentSession = session;
    offlineWorkspaceOnly = false;
    let cachedSnapshot = null;
    try {
      cachedSnapshot = await window.OneCaintaOffline.loadSnapshot(session.user.id);
    } catch (error) {
      console.error("Unable to read the saved offline workspace:", error);
    }
    let profile;
    let workspaceData;
    try {
      const result = await supabaseClient.from("user_profiles")
        .select("id,email,full_name,phone,role,created_at").eq("id", session.user.id).single();
      if (result.error) throw result.error;
      profile = normalizeProfile(result.data);
      workspaceOffline = false;
    } catch (error) {
      if (!cachedSnapshot || !isConnectivityError(error)) {
        currentSession = null;
        if (error.code === "PGRST116") {
          await supabaseClient.auth.signOut();
          throw new Error("Your sign-in succeeded, but your One Cainta profile is missing. Email-confirmed self-registrations should receive User access automatically; ask the system owner to repair this account.");
        }
        throw new Error(`Could not verify your account role. Your session is saved; retry when the connection is available. Details: ${error.message}`);
      }
      profile = normalizeProfile(cachedSnapshot.profile);
      workspaceData = clone(cachedSnapshot.data);
      workspaceOffline = true;
    }
    if (profile.role === "pending") {
      currentSession = null;
      await supabaseClient.auth.signOut();
      throw new Error("Your account is awaiting approval. Please contact an Admin to assign your User, Staff, or Admin role.");
    }
    if (!["user", "staff", "admin"].includes(profile.role)) {
      currentSession = null;
      await supabaseClient.auth.signOut();
      throw new Error("This account does not have an active One Cainta access role.");
    }
    currentProfile = profile;
    if (!workspaceOffline) {
      try {
        workspaceData = await fetchWorkspaceRecords();
      } catch (error) {
        if (!cachedSnapshot || !isConnectivityError(error)) throw error;
        workspaceData = clone(cachedSnapshot.data);
        workspaceOffline = true;
      }
    }
    if (profile.role === "admin" && !workspaceOffline) {
      const { data: instructors, error: instructorError } = await supabaseClient.from("user_profiles")
        .select("id,full_name,email").eq("role", "staff").order("full_name");
      if (instructorError) throw instructorError;
      staffProfiles = instructors;
    } else {
      staffProfiles = [];
    }
    workspaceData = workspaceDataForRole(profile, workspaceData);
    data = workspaceData;
    if (!workspaceOffline) {
      try {
        window.OneCaintaOffline.rememberUser(profile.id);
      } catch (error) {
        console.error("Unable to remember the offline workspace account:", error);
      }
    }
    await applyPendingWorkspaceChanges();
    if (!inviteSession) {
      invitationRedirect = false;
    } else {
      inviteSession = null;
      invitationRedirect = false;
    }
    document.getElementById("landing-page").classList.add("hidden");
    document.getElementById("auth-shell").classList.add("hidden");
    applyWorkspaceRole(profile);
    currentPage = pageFromLocation(profile.role);
    document.getElementById("app-shell").classList.remove("hidden");
    render();
    if (userNotificationTimer !== null) window.clearInterval(userNotificationTimer);
    userNotificationTimer = null;
    if (profile.role === "user" && !workspaceOffline && navigator.onLine) {
      await refreshUserNotifications(true);
      userNotificationTimer = window.setInterval(() => { void refreshUserNotifications(); }, 60_000);
    } else {
      userNotifications = [];
    }
    await updateWorkspaceSyncStatus();
    if (workspaceOffline) {
      stopWorkspaceActivityTracking();
      stopWorkspaceIdleTimeout();
    } else {
      try {
        await saveWorkspaceSnapshot();
      } catch (error) {
        console.error("Unable to save an offline workspace copy:", error);
        showToast(`Offline data could not be saved on this device: ${error.message}`, true);
      }
      startWorkspaceActivityTracking();
      startWorkspaceIdleTimeout();
      void syncWorkspaceChanges();
    }
  }
  async function refreshCurrentProfile() {
    if (!currentSession || !currentProfile || workspaceOffline || !navigator.onLine || !supabaseClient) return;
    const { data: fetchedProfile, error } = await supabaseClient.from("user_profiles")
      .select("id,email,full_name,phone,role,created_at").eq("id", currentProfile.id).single();
    if (error) {
      if (error.code === "PGRST116") {
        await forceSignOut("Your One Cainta profile is no longer available.");
        return;
      }
      console.error("Unable to refresh account role:", error);
      return;
    }
    const profile = normalizeProfile(fetchedProfile);
    if (!["user", "staff", "admin"].includes(profile.role)) {
      await forceSignOut("Your One Cainta access was removed.");
      return;
    }
    if (profile.role !== currentProfile.role) {
      currentProfile = profile;
      applyWorkspaceRole(profile);
      render();
      showToast("Your One Cainta role changed and has been refreshed.");
    }
  }
  async function forceSignOut(message) {
    stopWorkspaceActivityTracking();
    stopWorkspaceIdleTimeout();
    if (userNotificationTimer !== null) window.clearInterval(userNotificationTimer);
    userNotificationTimer = null;
    const { error } = await supabaseClient.auth.signOut();
    if (error) console.error("Unable to end the revoked account session:", error);
    currentSession = null;
    currentProfile = null;
    userNotifications = [];
    data = emptyData();
    document.getElementById("app-shell").classList.add("hidden");
    renderAuth(error ? `${message} Your session could not be cleared; reload after restoring connectivity.` : message);
  }
  function renderSessionRestoreError(message) {
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("landing-page").classList.add("hidden");
    document.getElementById("auth-shell").classList.remove("hidden");
    document.getElementById("auth-card").innerHTML = `<p class="eyebrow">SESSION SAVED</p><h1>Could not open workspace</h1><p class="auth-description">${escapeHTML(message)} Your sign-in session is still saved in this browser.</p><button class="button button-primary" id="retry-session-restore" type="button">Retry</button>`;
  }
  async function retrySessionRestore(button) {
    button.disabled = true;
    button.textContent = "Retrying…";
    try {
      const { data: result, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (!result.session) {
        renderAuth("Your session has expired. Please sign in again.");
        return;
      }
      await startWorkspace(result.session);
    } catch (error) {
      console.error("Unable to retry workspace restoration:", error);
      const { data: result, error: sessionError } = await supabaseClient.auth.getSession();
      if (!sessionError && result.session) renderSessionRestoreError(error.message || "Please check your connection and try again.");
      else renderAuth(error.message || "Your session has expired. Please sign in again.");
    }
  }
  function initializeAuth() {
    const config = readConfig();
    if (!config) {
      if (window.location.hash === "#login" || window.location.pathname === "/account-created" ||
          /(?:access_token=|type=(?:invite|recovery|signup))/.test(window.location.hash) ||
          new URLSearchParams(window.location.search).get("auth") === "signup-confirmation") renderAuth();
      else showLanding();
      hidePageLoader();
      return;
    }
    try {
      initializeSupabase(config).catch(error => {
        console.error("Unable to initialize One Cainta:", error);
        return supabaseClient.auth.getSession().then(({ data, error: sessionError }) => {
          if (sessionError) {
            renderAuth(error.message || "Could not connect to the Supabase project.");
            return;
          }
          if (data.session) renderSessionRestoreError(error.message || "Could not restore your workspace.");
          else renderAuth(error.message || "Could not connect to the Supabase project.");
        }).catch(sessionError => {
          console.error("Unable to check the saved Supabase session:", sessionError);
          renderAuth(error.message || "Could not connect to the Supabase project.");
        }).finally(hidePageLoader);
      }).finally(hidePageLoader);
    } catch (error) {
      console.error("Unable to initialize Supabase client:", error);
      renderAuth(error.message || "Could not initialize the Supabase client.");
      hidePageLoader();
    }
  }
  function pageHeader(eyebrow, title, subtitle, action = "") {
    return `<div class="page-heading"><div><p class="eyebrow">${escapeHTML(eyebrow)}</p><h1>${escapeHTML(title)}</h1><p class="page-subtitle">${escapeHTML(subtitle)}</p></div>${action}</div>`;
  }
  function emptyRow(columns, message, detail) {
    return `<tr><td colspan="${columns}"><div class="empty-state"><strong>${escapeHTML(message)}</strong>${escapeHTML(detail)}</div></td></tr>`;
  }
  function tableShell(headers, rows, id) {
    const count = data[currentPage]?.length || 0;
    return `<div class="panel table-panel"><div class="table-wrap"><table id="${id}"><thead><tr>${headers.map(h => `<th>${escapeHTML(h)}</th>`).join("")}</tr></thead><tbody>${rows || emptyRow(headers.length, "Nothing here yet", "Add your first record to get started.")}</tbody></table></div><div class="table-footer"><span>${count} record${count === 1 ? "" : "s"}</span><span>Shared workspace</span></div></div>`;
  }
  function actions(collection, id) {
    const record = byId(collection, id);
    if (!canEditRecord(collection, record)) return "";
    return `<div class="row-actions"><button class="icon-action" data-action="edit" data-collection="${collection}" data-id="${id}" aria-label="Edit record" title="Edit">✎</button>${canManageWorkspace() ? `<button class="icon-action delete" data-action="delete" data-collection="${collection}" data-id="${id}" aria-label="Delete record" title="Delete">×</button>` : ""}</div>`;
  }
  function actionsCell(collection, id) {
    return canEditRecord(collection, byId(collection, id)) ? `<td>${actions(collection, id)}</td>` : "";
  }
  function userSessionRecords() {
    return data.participants.filter(person => person.userId === currentProfile?.id);
  }
  function userEvaluationRecords() {
    const participantIds = new Set(userSessionRecords().map(person => person.id));
    return data.evaluations.filter(evaluation => participantIds.has(evaluation.participantId));
  }
  function renderUserDashboard() {
    const sessions = userSessionRecords();
    const evaluations = userEvaluationRecords();
    const upcoming = sessions
      .filter(session => session.status !== "Cancelled")
      .map(session => ({ session, program: byId("programs", session.programId) }))
      .filter(item => item.program?.status === "Scheduled" && item.program.date >= todayDate())
      .sort((a, b) => a.program.date.localeCompare(b.program.date));
    const average = evaluations.length
      ? Math.round(evaluations.reduce((sum, evaluation) => sum + averageScore(evaluation), 0) / evaluations.length)
      : 0;
    const unread = userNotifications.filter(notification => !notification.read_at).length;
    const rows = upcoming.slice(0, 5).map(({ program, session }) =>
      `<tr><td class="primary-cell">${escapeHTML(program.title)}</td><td>${escapeHTML(program.disasterType || "General preparedness")}</td><td>${formatDate(program.date)}</td><td>${badge(session.status)}</td></tr>`
    ).join("");
    return `<div class="role-dashboard role-dashboard-user">${pageHeader("COMMUNITY WORKSPACE", "My Dashboard", "Your training sessions, performance, and preparedness updates in one place.", `<button class="button button-primary" data-navigate="browse-drills">Browse drills</button>`)}
      <section class="stats-grid" aria-label="My preparedness overview">
        <article class="stat-card"><div class="stat-top"><span class="stat-label">My training sessions</span><span class="stat-icon">♧</span></div><p class="stat-value">${sessions.filter(session => session.status !== "Cancelled").length}</p><p class="stat-note">${upcoming.length} upcoming</p></article>
        <article class="stat-card"><div class="stat-top"><span class="stat-label">My performance</span><span class="stat-icon">▥</span></div><p class="stat-value">${evaluations.length ? `${average}%` : "—"}</p><p class="stat-note">${evaluations.length} evaluation${evaluations.length === 1 ? "" : "s"}</p></article>
        <article class="stat-card"><div class="stat-top"><span class="stat-label">Available training</span><span class="stat-icon">⌕</span></div><p class="stat-value">${data.programs.filter(program => program.status === "Scheduled" && program.date >= todayDate()).length}</p><p class="stat-note">Open sessions to explore</p></article>
        <article class="stat-card"><div class="stat-top"><span class="stat-label">New notifications</span><span class="stat-icon">▣</span></div><p class="stat-value">${unread}</p><p class="stat-note">Training announcements</p></article>
      </section>
      <section class="content-grid">
        <article class="panel"><div class="panel-header"><h2>My upcoming sessions</h2><button class="panel-link" data-navigate="my-sessions">View my sessions →</button></div><div class="table-wrap"><table><thead><tr><th>Training</th><th>Disaster type</th><th>Date</th><th>Enrollment</th></tr></thead><tbody>${rows || emptyRow(4, "No upcoming sessions yet", "Browse drills and enroll in an available training session.")}</tbody></table></div></article>
        <article class="panel"><div class="panel-header"><h2>Preparedness updates</h2><button class="panel-link" data-navigate="notifications">See notifications →</button></div><div class="role-report-list">${userNotifications.slice(0, 3).map(notification => `<article class="role-report-item"><strong>${escapeHTML(notification.title)}</strong><span>${formatDate(notification.created_at?.slice(0, 10))} · ${escapeHTML(notification.message)}</span>${notification.read_at ? badge("Read") : badge("New")}</article>`).join("") || `<div class="empty-state"><strong>No new updates</strong>New training announcements will appear here.</div>`}</div></article>
      </section>
    </div>`;
  }
  function renderDashboard() {
    const upcoming = data.programs.filter(program => program.status === "Scheduled" && program.date >= todayDate()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
    const average = data.evaluations.length
      ? Math.round(data.evaluations.reduce((sum, e) => sum + (Number(e.preparedness) + Number(e.response) + Number(e.teamwork) + Number(e.safety)) / 4, 0) / data.evaluations.length * 20)
      : 0;
    const rows = upcoming.map(item => `<tr><td class="primary-cell">${escapeHTML(item.title)}<span class="secondary-cell">${escapeHTML(item.location)}</span></td><td>${formatDate(item.date)}</td><td>${escapeHTML(item.type)}</td><td>${badge(item.status)}</td></tr>`).join("");
    const enrolled = data.participants.filter(person => person.status === "Confirmed").length;
    if (currentProfile?.role === "user") return renderUserDashboard();
    if (canManageAssignedPrograms()) {
      const upcomingAssigned = upcoming.filter(program => program.instructorId === currentProfile.id);
      return `<div class="role-dashboard role-dashboard-staff">${pageHeader("STAFF · INSTRUCTOR", "My assigned training", "View and update only the training programs assigned to your instructor account.", `<button class="button button-primary" data-navigate="programs">View assigned programs</button>`)}
        <section class="stats-grid" aria-label="Assigned training overview">
          <article class="stat-card"><div class="stat-top"><span class="stat-label">Assigned programs</span><span class="stat-icon">▤</span></div><p class="stat-value">${data.programs.length}</p><p class="stat-note">${upcomingAssigned.length} scheduled</p></article>
          <article class="stat-card"><div class="stat-top"><span class="stat-label">Disaster categories</span><span class="stat-icon">◈</span></div><p class="stat-value">${new Set(data.programs.map(program => program.disasterType || "General preparedness")).size}</p><p class="stat-note">Across assigned programs</p></article>
        </section>
        <article class="panel"><div class="panel-header"><h2>My upcoming training</h2><button class="panel-link" data-navigate="programs">View assigned programs →</button></div><div class="table-wrap"><table><thead><tr><th>Program</th><th>Disaster type</th><th>Date</th><th>Location</th><th>Status</th></tr></thead><tbody>${upcomingAssigned.map(item => `<tr><td class="primary-cell">${escapeHTML(item.title)}</td><td>${escapeHTML(item.disasterType || "General preparedness")}</td><td>${formatDate(item.date)}</td><td>${escapeHTML(item.location)}</td><td>${badge(item.status)}</td></tr>`).join("") || emptyRow(5, "No upcoming assigned training", "Programs assigned to your instructor account will appear here.")}</tbody></table></div></article>
      </div>`;
    }
    const isAdmin = currentProfile?.role === "admin";
    const title = "Operations dashboard";
    const subtitle = "Coordinate training, run realistic simulations, and track community readiness.";
    return `<div class="role-dashboard role-dashboard-admin">${pageHeader(isAdmin ? "ADMIN WORKSPACE" : "WORKSPACE", title, subtitle, `<button class="button button-primary" data-create="programs">＋ Create training</button>`)}
      <section class="stats-grid" aria-label="System overview">
        <article class="stat-card"><div class="stat-top"><span class="stat-label">Training Program Management</span><span class="stat-icon">▤</span></div><p class="stat-value">${data.programs.length}</p><p class="stat-note">${data.programs.filter(p => p.status === "Scheduled").length} scheduled</p></article>
        <article class="stat-card"><div class="stat-top"><span class="stat-label">Registered participants</span><span class="stat-icon">♙</span></div><p class="stat-value">${data.participants.length}</p><p class="stat-note">${enrolled} confirmed registrations</p></article>
        <article class="stat-card"><div class="stat-top"><span class="stat-label">Simulation Scenario Builder</span><span class="stat-icon">◈</span></div><p class="stat-value">${data.scenarios.length}</p><p class="stat-note">Ready to assign to a drill</p></article>
        <article class="stat-card"><div class="stat-top"><span class="stat-label">Disaster Drill Reporting</span><span class="stat-icon">▧</span></div><p class="stat-value">${data.reports.length}</p><p class="stat-note">${data.evaluations.length} performance evaluations recorded</p></article>
      </section>
      <section class="content-grid">
        <article class="panel"><div class="panel-header"><h2>Upcoming training</h2><button class="panel-link" data-navigate="programs">View programs →</button></div><div class="table-wrap"><table><thead><tr><th>Program</th><th>Date</th><th>Focus</th><th>Status</th></tr></thead><tbody>${rows || emptyRow(4, "No upcoming training", canManageWorkspace() ? "Schedule a training program to see it here." : "Upcoming programs will appear here when scheduled.")}</tbody></table></div></article>
        <article class="panel"><div class="panel-header"><h2>Community readiness</h2><span class="badge badge-green">Live summary</span></div><div class="readiness-card"><p class="eyebrow">AVERAGE EVALUATION SCORE</p><div class="readiness-score">${average}<span>/ 100</span></div><div class="progress-track"><div class="progress-fill" style="width:${average}%"></div></div><p>${data.evaluations.length ? `Calculated from ${data.evaluations.length} completed performance ${data.evaluations.length === 1 ? "evaluation" : "evaluations"}. ${canManageWorkspace() ? "Add evaluations after each exercise to track readiness." : "The score updates when administrators record new evaluations."}` : canManageWorkspace() ? "Record participant evaluations after a drill to establish a readiness baseline." : "The readiness baseline will appear when administrators record evaluations."}</p></div></article>
      </section>
      ${canManageWorkspace() ? `<h2 class="section-title">Quick actions</h2>
      <section class="action-grid">
        <button class="action-card" data-create="programs"><span class="action-icon">＋</span><span><strong>Plan a training</strong><small>Schedule a preparedness session</small></span></button>
        <button class="action-card" data-create="scenarios"><span class="action-icon">◈</span><span><strong>Build a scenario</strong><small>Define a drill and its objectives</small></span></button>
        <button class="action-card" data-create="participants"><span class="action-icon">♙</span><span><strong>Register participant</strong><small>Enroll a community member</small></span></button>
        <button class="action-card" data-create="reports"><span class="action-icon">▧</span><span><strong>Write a drill report</strong><small>Record outcomes and lessons</small></span></button>
      </section>` : ""}
      ${isAdmin ? `<section class="panel admin-accounts-panel" id="admin-dashboard-accounts"><div class="panel-header"><div><p class="eyebrow">ACCESS CONTROL</p><h2>Account approvals</h2></div><div class="panel-header-actions"><button class="button button-secondary" data-action="retry-training-emails">Retry email alerts</button><button class="panel-link" data-navigate="users">Manage accounts →</button></div></div><div class="admin-accounts-content"><div class="empty-state">Loading account status…</div></div></section>` : ""}
      </div>`;
  }
  function renderMySessions() {
    const sessions = userSessionRecords().slice().sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
    const rows = sessions.map(session => {
      const program = byId("programs", session.programId);
      return `<tr><td class="primary-cell">${escapeHTML(program?.title || "Training program unavailable")}</td><td>${escapeHTML(program?.disasterType || "—")}</td><td>${formatDate(program?.date)}</td><td>${escapeHTML(program?.location || "—")}</td><td>${badge(session.status)}</td><td>${session.status !== "Cancelled" && program?.status === "Scheduled" ? `<button class="button button-secondary" data-action="cancel-enrollment" data-participant-id="${escapeHTML(session.id)}">Cancel</button>` : "—"}</td></tr>`;
    }).join("");
    content.innerHTML = `${pageHeader("MY TRAINING", "My Sessions", "See your enrolled training sessions and manage your registration.", `<button class="button button-primary" data-navigate="browse-drills">Browse drills</button>`)}
      <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Session</th><th>Disaster type</th><th>Date</th><th>Location</th><th>Enrollment</th><th>Action</th></tr></thead><tbody>${rows || emptyRow(6, "No sessions yet", "Browse available training and enroll in a session.")}</tbody></table></div><div class="table-footer">${sessions.length} session${sessions.length === 1 ? "" : "s"}</div></section>`;
  }
  function renderMyPerformance() {
    const evaluations = userEvaluationRecords().slice().sort((a, b) => b.date.localeCompare(a.date));
    const average = evaluations.length
      ? Math.round(evaluations.reduce((sum, evaluation) => sum + averageScore(evaluation), 0) / evaluations.length)
      : 0;
    const rows = evaluations.map(evaluation => `<tr><td>${formatDate(evaluation.date)}</td><td>${escapeHTML(scenarioName(evaluation.scenarioId))}</td><td>${evaluation.preparedness} / 5</td><td>${evaluation.response} / 5</td><td>${evaluation.teamwork} / 5</td><td>${evaluation.safety} / 5</td><td class="score-pill">${averageScore(evaluation)}%</td><td>${escapeHTML(evaluation.feedback || "—")}</td></tr>`).join("");
    content.innerHTML = `${pageHeader("MY RESULTS", "My Performance", "Review evaluation scores and instructor feedback from your completed drills.")}
      <section class="stats-grid" aria-label="My performance summary"><article class="stat-card"><div class="stat-top"><span class="stat-label">Overall average</span><span class="stat-icon">▥</span></div><p class="stat-value">${evaluations.length ? `${average}%` : "—"}</p><p class="stat-note">Across your recorded evaluations</p></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Evaluations</span><span class="stat-icon">✓</span></div><p class="stat-value">${evaluations.length}</p><p class="stat-note">Completed drill assessments</p></article></section>
      <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Drill</th><th>Preparedness</th><th>Response</th><th>Teamwork</th><th>Safety</th><th>Overall</th><th>Instructor feedback</th></tr></thead><tbody>${rows || emptyRow(8, "No performance results yet", "Your evaluation results will appear here after an instructor records them.")}</tbody></table></div><div class="table-footer">${evaluations.length} evaluation${evaluations.length === 1 ? "" : "s"}</div></section>`;
  }
  function renderBrowseDrills() {
    const enrolledProgramIds = new Set(userSessionRecords()
      .filter(session => session.status !== "Cancelled").map(session => session.programId));
    const programs = data.programs
      .filter(program => program.status === "Scheduled" && program.date >= todayDate())
      .sort((a, b) => a.date.localeCompare(b.date));
    const cards = programs.map(program => {
      const alreadyEnrolled = enrolledProgramIds.has(program.id);
      return `<article class="program-browser-card" data-disaster-type="${escapeHTML(program.disasterType || "General preparedness")}">
        <div class="program-browser-meta"><span class="badge badge-blue">${escapeHTML(program.disasterType || "General preparedness")}</span><span>${formatDate(program.date)}</span></div>
        <h2>${escapeHTML(program.title)}</h2><p>${escapeHTML(program.description || program.type)}</p>
        <div class="program-browser-location">${escapeHTML(program.location)} · ${escapeHTML(program.type)}</div>
        <button class="button ${alreadyEnrolled ? "button-secondary" : "button-primary"}" type="button" data-action="enroll" data-program-id="${escapeHTML(program.id)}"${alreadyEnrolled ? " disabled" : ""}>${alreadyEnrolled ? "Already enrolled" : "Enroll in this session"}</button>
      </article>`;
    }).join("");
    const scenarios = data.scenarios.map(scenario => `<article class="drill-browser-card"><span class="badge badge-amber">${escapeHTML(scenario.hazard)}</span><h3>${escapeHTML(scenario.title)}</h3><p>${escapeHTML(scenario.objectives || "Preparedness drill")}</p><span>${escapeHTML(scenario.duration)} minutes · ${escapeHTML(scenario.severity)} intensity</span></article>`).join("");
    const disasterTypes = uniqueValues(programs, "disasterType");
    content.innerHTML = `${pageHeader("COMMUNITY TRAINING", "Browse Drills", "Explore upcoming training by disaster type and enroll in a session that fits you.")}
      <div class="toolbar"><label class="search-box"><span>⌕</span><input type="search" data-drill-search placeholder="Search training or location" aria-label="Search training programs"></label><select data-user-drill-filter aria-label="Filter by disaster type"><option value="">All disaster types</option>${disasterTypes.map(type => `<option>${escapeHTML(type)}</option>`).join("")}</select></div>
      <section class="program-browser-grid" id="program-browser-grid">${cards || `<div class="panel empty-state"><strong>No upcoming training</strong>New training programs will appear here when announced.</div>`}</section>
      <section class="drill-browser-section"><div class="section-heading"><div><p class="eyebrow">PRACTICE & PREPARE</p><h2>Drill scenarios</h2></div></div><section class="drill-browser-grid">${scenarios || `<div class="panel empty-state"><strong>No drills available</strong>Preparedness drills will appear here when added.</div>`}</section></section>`;
  }
  function renderUserNotifications() {
    const unread = userNotifications.filter(notification => !notification.read_at);
    content.innerHTML = `${pageHeader("UPDATES", "Notifications & SMS", "Get notified when new training programs are announced.", unread.length ? `<button class="button button-secondary" data-action="mark-notifications-read">Mark all as read</button>` : "")}
      <div class="callout"><span>ⓘ</span><span>New training announcements appear here and are also sent to your email when Gmail notifications are configured. SMS alerts are not connected yet.</span></div>
      <section class="notification-list">${userNotifications.map(notification => `<article class="notification-card${notification.read_at ? "" : " is-unread"}"><div class="notification-copy"><p class="eyebrow">${notification.read_at ? "TRAINING UPDATE" : "NEW TRAINING"}</p><h2>${escapeHTML(notification.title)}</h2><p>${escapeHTML(notification.message)}</p><small>${formatDate(notification.created_at?.slice(0, 10))}</small></div>${notification.read_at ? "" : `<span class="notification-dot" aria-label="Unread"></span>`}</article>`).join("") || `<div class="panel empty-state"><strong>No notifications yet</strong>New training program announcements will appear here.</div>`}</section>`;
  }
  async function enrollInProgram(programId) {
    const program = byId("programs", programId);
    if (!program || program.status !== "Scheduled" || program.date < todayDate()) {
      showToast("This training session is no longer available for enrollment.", true);
      return;
    }
    if (userSessionRecords().some(session => session.programId === program.id && session.status !== "Cancelled")) {
      showToast("You are already enrolled in this training session.", true);
      return;
    }
    const previousData = clone(data);
    const participant = {
      id: uid("u"),
      userId: currentProfile.id,
      name: currentProfile.full_name || currentProfile.email,
      email: currentProfile.email,
      phone: currentProfile.phone || "",
      affiliation: "Community member",
      programId: program.id,
      registeredAt: todayDate(),
      status: "Pending",
      emergencyContact: ""
    };
    data.participants.push(participant);
    try {
      await saveData(previousData);
      render();
      showToast("Your enrollment request was sent. The Admin will confirm your session.");
    } catch (error) {
      console.error("Unable to enroll in training:", error);
      data = previousData;
      render();
      showToast(`Enrollment failed: ${error.message}`, true);
    }
  }
  async function cancelUserEnrollment(participantId) {
    const participant = userSessionRecords().find(session => session.id === participantId);
    if (!participant || participant.status === "Cancelled") return;
    const previousData = clone(data);
    participant.status = "Cancelled";
    try {
      await saveData(previousData);
      render();
      showToast("Your enrollment has been cancelled.");
    } catch (error) {
      console.error("Unable to cancel training enrollment:", error);
      data = previousData;
      render();
      showToast(`Could not cancel enrollment: ${error.message}`, true);
    }
  }
  async function markUserNotificationsRead() {
    const unreadIds = userNotifications.filter(notification => !notification.read_at).map(notification => notification.id);
    if (!unreadIds.length) return;
    const { error } = await supabaseClient.from("user_notifications")
      .update({ read_at: new Date().toISOString() }).in("id", unreadIds).select("id");
    if (error) {
      console.error("Unable to mark notifications as read:", error);
      showToast(`Could not update notification status: ${error.message}`, true);
      return;
    }
    await refreshUserNotifications();
  }
  function filterBrowseDrills() {
    const query = content.querySelector("[data-drill-search]")?.value.trim().toLowerCase() || "";
    const disasterType = content.querySelector("[data-user-drill-filter]")?.value || "";
    content.querySelectorAll(".program-browser-card").forEach(card => {
      const matchesDisaster = !disasterType || card.dataset.disasterType === disasterType;
      const matchesText = !query || card.textContent.toLowerCase().includes(query);
      card.hidden = !matchesDisaster || !matchesText;
    });
  }
  async function loadAdminDashboard() {
    const host = document.querySelector("#admin-dashboard-accounts .admin-accounts-content");
    if (!host || currentProfile?.role !== "admin") return;
    const { data: profiles, error } = await supabaseClient.from("user_profiles")
      .select("id,email,full_name,role,created_at").order("created_at", { ascending: false });
    if (!host.isConnected || currentPage !== "dashboard") return;
    if (error) {
      console.error("Unable to load Admin dashboard account summary:", error);
      host.innerHTML = `<div class="empty-state"><strong>Account summary unavailable</strong>Open User management to retry. ${escapeHTML(error.message)}</div>`;
      return;
    }
    const pending = profiles.filter(profile => profile.role === "pending");
    const admins = profiles.filter(profile => profile.role === "admin").length;
    const staff = profiles.filter(profile => profile.role === "staff").length;
    const users = profiles.filter(profile => profile.role === "user").length;
    const preview = pending.slice(0, 4);
    host.innerHTML = `<div class="account-summary-strip"><span><strong>${profiles.length}</strong> total accounts</span><span><strong>${admins}</strong> Admins</span><span><strong>${staff}</strong> Staff</span><span><strong>${users}</strong> Users</span><span class="${pending.length ? "pending-count" : ""}"><strong>${pending.length}</strong> pending approval</span></div>
      ${preview.length ? `<ul class="pending-account-list">${preview.map(profile => `<li><span class="pending-account-avatar" aria-hidden="true">${escapeHTML((profile.full_name || profile.email || "?").slice(0, 1).toUpperCase())}</span><span class="pending-account-identity"><strong>${escapeHTML(profile.full_name || "Name not provided")}</strong><small>${escapeHTML(profile.email)}</small></span><span class="badge badge-amber">Pending</span></li>`).join("")}</ul><div class="pending-account-actions"><span>${pending.length > preview.length ? `Showing ${preview.length} of ${pending.length} pending accounts` : `${pending.length} account${pending.length === 1 ? "" : "s"} need${pending.length === 1 ? "s" : ""} review`}</span><button class="button button-secondary" data-navigate="users">Review approvals</button></div>` : `<div class="empty-state"><strong>All accounts are up to date</strong>No pending account approvals.</div>`}`;
  }
  function renderPrograms() {
    const rows = data.programs.slice().sort((a, b) => a.date.localeCompare(b.date)).map(item => `<tr><td class="primary-cell">${escapeHTML(item.title)}<span class="secondary-cell">${escapeHTML(item.description || item.location)}</span></td><td>${escapeHTML(item.disasterType || "General preparedness")}</td><td>${formatDate(item.date)}</td><td>${escapeHTML(item.type)}</td><td>${escapeHTML(item.location)}</td><td>${data.participants.filter(p => p.programId === item.id).length} / ${escapeHTML(item.capacity)}</td><td>${badge(item.status)}</td>${actionsCell("programs", item.id)}</tr>`).join("");
    const canAddPrograms = canManageWorkspace();
    const canEditPrograms = canAddPrograms || canManageAssignedPrograms();
    const action = canAddPrograms ? `<button class="button button-primary" data-create="programs">＋ Add program</button>` : "";
    const subtitle = canAddPrograms
      ? "Create programs, assign instructors, and filter training by disaster type."
      : canManageAssignedPrograms()
        ? "View and update only the training programs assigned to your instructor account."
        : "Browse training schedules by disaster type, location, and status.";
    content.innerHTML = `${pageHeader(canManageAssignedPrograms() ? "INSTRUCTOR WORKSPACE" : "TRAINING MANAGEMENT", pageTitles.programs, subtitle, action)}
      <div class="toolbar"><label class="search-box"><span>⌕</span><input type="search" data-search="programs" placeholder="Search programs, focus, or location" aria-label="Search training programs"></label><select data-filter="programs" data-filter-key="status" aria-label="Filter programs by status"><option value="">All statuses</option><option>Scheduled</option><option>Completed</option><option>Cancelled</option></select><select data-filter="programs" data-filter-key="disasterType" aria-label="Filter programs by disaster type"><option value="">All disaster types</option>${uniqueValues(data.programs, "disasterType").map(type => `<option>${escapeHTML(type)}</option>`).join("")}</select></div>
      ${tableShell(["Program", "Disaster type", "Date", "Focus", "Location", "Enrolled", "Status", "Actions"].filter((header) => canEditPrograms || header !== "Actions"), rows, "records-table")}`;
  }
  function renderScenarios() {
    const rows = data.scenarios.map(item => `<tr><td class="primary-cell">${escapeHTML(item.title)}<span class="secondary-cell scenario-details">${escapeHTML(item.objectives || "No objectives added")}</span></td><td>${escapeHTML(item.hazard)}</td><td>${badge(item.severity)}</td><td>${escapeHTML(item.duration)} min</td><td>${item.steps ? "Defined" : "Not defined"}</td>${actionsCell("scenarios", item.id)}</tr>`).join("");
    content.innerHTML = `${pageHeader("SCENARIO BUILDER", pageTitles.scenarios, canManageWorkspace() ? "Design realistic hazard simulations with clear objectives, steps, and safety considerations." : "Review hazard simulations, objectives, steps, and safety considerations.", canManageWorkspace() ? `<button class="button button-primary" data-create="scenarios">＋ Build scenario</button>` : "")}
      <div class="callout"><span>ⓘ</span><span><strong>Safety first.</strong> Keep exercises controlled and supervised. Clearly brief participants, identify a safety officer, and never introduce real hazards during a simulation.</span></div>
      <div class="toolbar"><label class="search-box"><span>⌕</span><input type="search" data-search="scenarios" placeholder="Search scenarios or hazard type" aria-label="Search scenarios"></label><select data-filter="scenarios" data-filter-key="hazard" aria-label="Filter scenarios by hazard"><option value="">All hazards</option>${uniqueValues(data.scenarios, "hazard").map(v => `<option>${escapeHTML(v)}</option>`).join("")}</select></div>
      ${tableShell(["Scenario", "Hazard", "Severity", "Duration", "Drill steps", "Actions"].filter((header) => canManageWorkspace() || header !== "Actions"), rows, "records-table")}`;
  }
  function renderParticipants() {
    const rows = data.participants.slice().sort((a, b) => b.registeredAt.localeCompare(a.registeredAt)).map(item => `<tr><td class="primary-cell">${escapeHTML(item.name)}<span class="secondary-cell">${escapeHTML(item.affiliation)}</span></td><td>${escapeHTML(item.email)}<span class="secondary-cell">${escapeHTML(item.phone)}</span></td><td>${escapeHTML(programName(item.programId))}</td><td>${formatDate(item.registeredAt)}</td><td>${badge(item.status)}</td>${actionsCell("participants", item.id)}</tr>`).join("");
    content.innerHTML = `${pageHeader("REGISTRATION", pageTitles.participants, canManageWorkspace() ? "Manage participant details, program enrollment, confirmation status, and emergency contacts." : "View participant details, program enrollment, and registration status.", canManageWorkspace() ? `<button class="button button-primary" data-create="participants">＋ Register participant</button>` : "")}
      <div class="toolbar"><label class="search-box"><span>⌕</span><input type="search" data-search="participants" placeholder="Search name, email, or affiliation" aria-label="Search participants"></label><select data-filter="participants" data-filter-key="status" aria-label="Filter participants by registration status"><option value="">All statuses</option><option>Confirmed</option><option>Pending</option></select></div>
      ${tableShell(["Participant", "Contact", "Training program", "Registered", "Status", "Actions"].filter((header) => canManageWorkspace() || header !== "Actions"), rows, "records-table")}`;
  }
  function averageScore(item) {
    return Math.round((Number(item.preparedness) + Number(item.response) + Number(item.teamwork) + Number(item.safety)) / 4 * 20);
  }
  function renderEvaluations() {
    const rows = data.evaluations.slice().sort((a, b) => b.date.localeCompare(a.date)).map(item => `<tr><td class="primary-cell">${escapeHTML(participantName(item.participantId))}<span class="secondary-cell">${escapeHTML(scenarioName(item.scenarioId))}</span></td><td>${formatDate(item.date)}</td><td>${item.preparedness} / 5</td><td>${item.response} / 5</td><td>${item.teamwork} / 5</td><td>${item.safety} / 5</td><td class="score-pill">${averageScore(item)}%</td>${actionsCell("evaluations", item.id)}</tr>`).join("");
    content.innerHTML = `${pageHeader("PERFORMANCE", pageTitles.evaluations, canManageWorkspace() ? "Score preparedness, response, teamwork, and safety; capture feedback for every exercise." : "Review preparedness, response, teamwork, and safety scores.", canManageWorkspace() ? `<button class="button button-primary" data-create="evaluations">＋ Add evaluation</button>` : "")}
      <div class="callout"><span>ⓘ</span><span>Use the same 1–5 scale consistently: <strong>1 = needs significant support</strong> and <strong>5 = consistently effective</strong>. The overall score is the average of all four dimensions.</span></div>
      <div class="toolbar"><label class="search-box"><span>⌕</span><input type="search" data-search="evaluations" placeholder="Search participant or scenario" aria-label="Search evaluations"></label></div>
      ${tableShell(["Participant / scenario", "Date", "Preparedness", "Response", "Teamwork", "Safety", "Overall", "Actions"].filter((header) => canManageWorkspace() || header !== "Actions"), rows, "records-table")}`;
  }
  function renderReports() {
    const cards = data.reports.slice().sort((a, b) => b.date.localeCompare(a.date)).map(item => `<article class="report-card"><div><h3>${escapeHTML(item.title)} ${badge(item.outcome)}</h3><p>${formatDate(item.date)} · ${escapeHTML(item.location)} · ${escapeHTML(scenarioName(item.scenarioId))}<br>${escapeHTML(item.attendance)} participants · ${escapeHTML(item.summary)}</p></div><div class="report-card-actions">${canManageWorkspace() ? `<button class="icon-action" data-action="edit" data-collection="reports" data-id="${item.id}" aria-label="Edit report" title="Edit">✎</button>` : ""}<button class="icon-action" data-action="print-report" data-id="${item.id}" aria-label="Print report" title="Print">▧</button>${canManageWorkspace() ? `<button class="icon-action delete" data-action="delete" data-collection="reports" data-id="${item.id}" aria-label="Delete report" title="Delete">×</button>` : ""}</div></article>`).join("");
    content.innerHTML = `${pageHeader("DRILL REPORTING", pageTitles.reports, canManageWorkspace() ? "Document attendance, outcomes, incidents, and lessons learned; print or export your records." : "Review drill outcomes and lessons learned; print or export reports.", `<button class="button button-secondary" data-action="export-reports">↓ Export CSV</button>${canManageWorkspace() ? `<button class="button button-primary" data-create="reports">＋ New report</button>` : ""}`)}
      <div class="callout"><span>ⓘ</span><span>Reports help identify what worked and what needs improvement. Record incidents factually, protect personal information, and share reports only with authorized people.</span></div>
      <section class="panel">${cards || `<div class="empty-state"><strong>No drill reports yet</strong>Record your first exercise outcome to build an after-action history.</div>`}</section>`;
  }
  function uniqueValues(items, key) { return [...new Set(items.map(item => item[key]).filter(Boolean))].sort(); }
  async function renderUsers() {
    if (accountActivityTimer !== null) window.clearInterval(accountActivityTimer);
    accountActivityTimer = null;
    if (!canManageWorkspace()) {
      currentPage = "dashboard";
      render();
      return;
    }
    const seedAction = Object.values(data).every(records => records.length === 0)
      ? `<button class="button button-secondary" data-action="seed-demo">Load demo records</button>` : "";
    content.innerHTML = `${pageHeader("ADMIN", pageTitles.users, "Review accounts and activity, assign User, Staff, or Admin access, and invite new accounts.", `${seedAction}<button class="button button-primary" data-action="show-invite">＋ Invite account</button>`)}
      <div class="callout"><span>ⓘ</span><span>Username is the account's saved full name. Staff accounts are instructor accounts and can update only programs assigned to them. Active / Inactive is a display status only and does not block sign-in. Account changes require your Admin password. “Active now” means the signed-in workspace was recently open in a visible browser tab.</span></div>
      <form class="inline-invite hidden" id="invite-admin-form"><div class="form-field"><label for="invite-name">Full name</label><input class="form-control" id="invite-name" name="fullName" maxlength="100" required></div><div class="form-field"><label for="invite-email">Email address</label><input class="form-control" id="invite-email" name="email" type="email" maxlength="150" required></div><div class="form-field"><label for="invite-role">Account role</label><select class="form-control" id="invite-role" name="role" required><option value="staff" selected>Staff — instructor</option><option value="user">User — read only</option><option value="admin">Admin — manage system</option></select></div><button class="button button-primary" type="submit">Send secure invitation</button><button class="button button-secondary" type="button" data-action="hide-invite">Cancel</button></form>
      <section class="panel"><div class="panel-header"><h2>Workspace accounts</h2><span class="badge badge-blue">Admin only</span></div>
        <div class="account-filters"><input class="form-control" type="search" data-account-search placeholder="Search by username or email" aria-label="Search accounts by username or email">
          <select class="form-control" data-account-filter="role" aria-label="Filter accounts by role"><option value="">All roles</option><option value="pending">Pending</option><option value="user">User</option><option value="staff">Staff (Instructor)</option><option value="admin">Admin</option></select>
          <select class="form-control" data-account-filter="status" aria-label="Filter accounts by status"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        <div class="table-wrap"><table><thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Account status</th><th>Last activity</th><th>Joined</th><th>Actions</th></tr></thead><tbody><tr><td colspan="7"><div class="empty-state">Loading workspace accounts…</div></td></tr></tbody></table></div></section>`;
    const { data: users, error } = await supabaseClient.from("user_profiles")
      .select("id,email,full_name,role,account_status,last_seen_at,created_at").order("created_at", { ascending: true });
    const tbody = content.querySelector("tbody");
    if (!tbody?.isConnected || currentPage !== "users") return;
    if (error) {
      console.error("Unable to load workspace accounts:", error);
      tbody.innerHTML = emptyRow(7, "Could not load accounts", error.message);
      return;
    }
    staffProfiles = users.filter(user => user.role === "staff").map(({ id, email, full_name }) => ({ id, email, full_name }));
    tbody.innerHTML = users.map(user => `<tr data-account-row data-account-search="${escapeHTML(`${user.full_name || ""} ${user.email}`.toLowerCase())}" data-account-role="${escapeHTML(user.role)}" data-account-state="${user.account_status === "inactive" ? "inactive" : "active"}">
      <td class="primary-cell">${escapeHTML(user.full_name || "—")}${user.id === currentProfile.id ? '<span class="secondary-cell">You</span>' : ""}</td>
      <td>${escapeHTML(user.email)}</td>
      <td><div class="account-role-editor"><select class="form-control role-select" data-role-user="${escapeHTML(user.id)}" data-original-role="${escapeHTML(user.role)}" aria-label="Role for ${escapeHTML(user.email)}"${user.id === currentProfile.id ? " disabled" : ""}><option value="pending"${user.role === "pending" ? " selected" : ""}>Pending</option><option value="user"${user.role === "user" ? " selected" : ""}>User</option><option value="staff"${user.role === "staff" ? " selected" : ""}>Staff (Instructor)</option><option value="admin"${user.role === "admin" ? " selected" : ""}>Admin</option></select><button class="button button-secondary account-role-save" type="button" data-action="save-account-role" data-account-id="${escapeHTML(user.id)}" data-account-email="${escapeHTML(user.email)}" data-original-role="${escapeHTML(user.role)}" aria-label="Save role for ${escapeHTML(user.email)}" disabled>Save</button></div></td>
      <td><select class="form-control account-status-select" data-account-status="${escapeHTML(user.id)}" data-original-status="${user.account_status === "inactive" ? "inactive" : "active"}" aria-label="Account status for ${escapeHTML(user.email)}"><option value="active"${user.account_status !== "inactive" ? " selected" : ""}>Active</option><option value="inactive"${user.account_status === "inactive" ? " selected" : ""}>Inactive</option></select></td>
      <td><span class="account-activity" data-account-activity="${escapeHTML(user.id)}"><span class="account-activity-dot"></span><span class="account-activity-label"></span></span></td>
      <td>${formatDate(user.created_at?.slice(0, 10))}</td>
      <td><button class="button button-danger account-delete-button" data-action="delete-account" data-account-id="${escapeHTML(user.id)}" data-account-email="${escapeHTML(user.email)}" aria-label="Delete account ${escapeHTML(user.email)}" title="${user.role === "admin" ? "Change this account's role before deleting it" : "Delete account"}"${user.id === currentProfile.id || user.role === "admin" ? " disabled" : ""}>Delete</button></td>
    </tr>`).join("") + `<tr data-account-empty${users.length ? " hidden" : ""}><td colspan="7"><div class="empty-state"><strong>No workspace accounts</strong>Invite a user or administrator to get started.</div></td></tr>`;
    tbody.insertAdjacentHTML("beforeend", '<tr data-account-filter-empty hidden><td colspan="7"><div class="empty-state">No accounts match these search and filter settings.</div></td></tr>');
    tbody.querySelectorAll("[data-account-activity]").forEach((element, index) => {
      updateAccountActivityElement(element, users[index]?.last_seen_at);
    });
    filterWorkspaceAccounts();
    accountActivityTimer = window.setInterval(() => { void refreshAccountActivity(); }, 15_000);
  }
  function filterWorkspaceAccounts() {
    const search = content.querySelector("[data-account-search]")?.value.trim().toLowerCase() || "";
    const role = content.querySelector('[data-account-filter="role"]')?.value || "";
    const status = content.querySelector('[data-account-filter="status"]')?.value || "";
    const rows = [...content.querySelectorAll("[data-account-row]")];
    let visibleCount = 0;
    rows.forEach(row => {
      const matches = row.dataset.accountSearch.includes(search) &&
        (!role || row.dataset.accountRole === role) &&
        (!status || row.dataset.accountState === status);
      row.hidden = !matches;
      if (matches) visibleCount++;
    });
    const noResults = content.querySelector("[data-account-filter-empty]");
    if (noResults) noResults.hidden = rows.length === 0 || visibleCount > 0;
    const emptyState = content.querySelector("[data-account-empty]");
    if (emptyState) emptyState.hidden = rows.length > 0;
  }
  function openAccountSecurityDialog(action) {
    pendingAccountAction = action;
    const dialog = document.getElementById("account-security-backdrop");
    const form = document.getElementById("account-security-form");
    const title = document.getElementById("account-security-title");
    const description = document.getElementById("account-security-description");
    const submit = document.getElementById("account-security-submit");
    const password = document.getElementById("account-security-password");
    const passwordToggle = dialog.querySelector("[data-password-toggle='account-security-password']");
    password.type = "password";
    passwordToggle.setAttribute("aria-pressed", "false");
    passwordToggle.setAttribute("aria-label", "Show confirmation password");
    passwordToggle.title = "Show password";
    passwordToggle.querySelector(".password-eye-slash").classList.add("hidden");
    document.getElementById("account-security-feedback").replaceChildren();
    form.reset();
    if (action.type === "delete") {
      title.textContent = "Permanently delete account?";
      description.textContent = `You are about to permanently delete ${action.email}. This removes their sign-in account and profile and cannot be undone. Enter your Admin password to confirm.`;
      submit.textContent = "Confirm and delete";
      submit.classList.add("button-danger");
    } else {
      title.textContent = "Confirm role change";
      description.textContent = `Change ${action.email}'s role to ${roleLabel(action.role)}? The new permissions take effect immediately. Enter your Admin password to confirm.`;
      submit.textContent = "Confirm and save";
      submit.classList.remove("button-danger");
    }
    dialog.classList.remove("hidden");
    password.focus();
  }
  function closeAccountSecurityDialog() {
    const dialog = document.getElementById("account-security-backdrop");
    dialog.classList.add("hidden");
    document.getElementById("account-security-form").reset();
    document.getElementById("account-security-feedback").replaceChildren();
    pendingAccountAction = null;
  }
  async function submitAccountSecurityAction(password, submitButton) {
    if (!pendingAccountAction || !canManageWorkspace()) return;
    const action = pendingAccountAction;
    submitButton.disabled = true;
    submitButton.textContent = action.type === "delete" ? "Deleting…" : "Saving…";
    const feedback = document.getElementById("account-security-feedback");
    feedback.replaceChildren();
    let error;
    let result;
    try {
      ({ data: result, error } = await supabaseClient.functions.invoke("delete-account", {
        body: {
          action: action.type,
          userId: action.userId,
          ...(action.type === "update-role" ? { role: action.role } : {}),
          password
        }
      }));
    } catch (requestError) {
      console.error("Unable to complete the Admin account action:", requestError);
      const errorMessage = document.createElement("p");
      errorMessage.className = "auth-message";
      errorMessage.setAttribute("role", "alert");
      errorMessage.textContent = `Account action failed: ${requestError.message || "Check your connection and try again."}`;
      feedback.replaceChildren(errorMessage);
      submitButton.disabled = false;
      submitButton.textContent = action.type === "delete" ? "Confirm and delete" : "Confirm and save";
      return;
    }
    if (error) {
      console.error(`Unable to ${action.type === "delete" ? "delete account" : "update account role"}:`, error);
      let message = error.message;
      if (error.context instanceof Response) {
        try {
          const responseBody = await error.context.clone().json();
          if (responseBody && typeof responseBody.error === "string") message = responseBody.error;
        } catch (parseError) {
          console.error("Unable to read account deletion error details:", parseError);
        }
      }
      const errorMessage = document.createElement("p");
      errorMessage.className = "auth-message";
      errorMessage.setAttribute("role", "alert");
      errorMessage.textContent = `${action.type === "delete" ? "Account deletion" : "Role update"} failed: ${message}`;
      feedback.replaceChildren(errorMessage);
      submitButton.disabled = false;
      submitButton.textContent = action.type === "delete" ? "Confirm and delete" : "Confirm and save";
      return;
    }
    if (action.type === "update-role" && result?.role !== action.role) {
      console.error("The account role update did not return the requested role:", result);
      const errorMessage = document.createElement("p");
      errorMessage.className = "auth-message";
      errorMessage.setAttribute("role", "alert");
      errorMessage.textContent = "The server did not confirm this role change. The account has not been updated in the list; try again or contact the project owner.";
      feedback.replaceChildren(errorMessage);
      submitButton.disabled = false;
      submitButton.textContent = "Confirm and save";
      return;
    }
    const completedAction = action;
    closeAccountSecurityDialog();
    if (completedAction.type === "update-role") {
      const row = content.querySelector(`[data-account-row] [data-role-user="${CSS.escape(completedAction.userId)}"]`)?.closest("[data-account-row]");
      const selector = row?.querySelector("[data-role-user]");
      const saveButton = row?.querySelector("[data-action='save-account-role']");
      const deleteButton = row?.querySelector("[data-action='delete-account']");
      if (row && selector && saveButton) {
        selector.value = completedAction.role;
        selector.dataset.originalRole = completedAction.role;
        saveButton.dataset.originalRole = completedAction.role;
        saveButton.disabled = true;
        row.dataset.accountRole = completedAction.role;
        if (deleteButton) {
          const isAdmin = completedAction.role === "admin";
          deleteButton.disabled = isAdmin || completedAction.userId === currentProfile.id;
          deleteButton.title = isAdmin ? "Change this account's role before deleting it" : "Delete account";
        }
        filterWorkspaceAccounts();
      }
      staffProfiles = staffProfiles.filter(profile => profile.id !== completedAction.userId);
      if (completedAction.role === "staff") {
        staffProfiles.push({ id: completedAction.userId, email: completedAction.email, full_name: "" });
      }
      showToast(`Role for ${completedAction.email} updated to ${roleLabel(completedAction.role)}. The account must sign in again to refresh access.`);
    } else {
      content.querySelector(`[data-account-row] [data-account-id="${CSS.escape(completedAction.userId)}"]`)?.closest("[data-account-row]")?.remove();
      filterWorkspaceAccounts();
      showToast(`Account ${completedAction.email} was permanently deleted.`);
    }
  }
  async function refreshAccountActivity() {
    if (!canManageWorkspace() || currentPage !== "users") return;
    const { data: accounts, error } = await supabaseClient.from("user_profiles").select("id,last_seen_at");
    if (error) {
      console.error("Unable to refresh account activity:", error);
      return;
    }
    const accountsById = new Map(accounts.map(account => [account.id, account]));
    content.querySelectorAll("[data-account-activity]").forEach(element => {
      const account = accountsById.get(element.dataset.accountActivity);
      if (account) updateAccountActivityElement(element, account.last_seen_at);
    });
  }
  function render() {
    if (currentProfile && !allowedPagesForRole(currentProfile.role).includes(currentPage)) {
      currentPage = "dashboard";
    }
    if (currentPage === "users" && (workspaceOffline || !navigator.onLine)) {
      currentPage = "dashboard";
      showToast("User management requires an internet connection.", true);
    }
    if (currentPage !== "users" && accountActivityTimer !== null) {
      window.clearInterval(accountActivityTimer);
      accountActivityTimer = null;
    }
    document.getElementById("page-crumb").textContent = pageTitles[currentPage];
    document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.page === currentPage));
    if (window.location.hash !== `#${currentPage}`) {
      window.history.replaceState(null, "", `#${currentPage}`);
    }
    if (currentPage === "dashboard") content.innerHTML = renderDashboard();
    if (currentPage === "my-sessions") renderMySessions();
    if (currentPage === "my-performance") renderMyPerformance();
    if (currentPage === "browse-drills") renderBrowseDrills();
    if (currentPage === "notifications") {
      if (currentProfile?.role === "user" && !workspaceOffline && navigator.onLine) void refreshUserNotifications();
      else renderUserNotifications();
    }
    if (currentPage === "programs") renderPrograms();
    if (currentPage === "scenarios") renderScenarios();
    if (currentPage === "participants") renderParticipants();
    if (currentPage === "evaluations") renderEvaluations();
    if (currentPage === "reports") renderReports();
    if (currentPage === "users") renderUsers();
    if (currentPage === "dashboard" && currentProfile?.role === "admin" && !workspaceOffline && navigator.onLine) loadAdminDashboard();
    content.classList.remove("is-entering");
    void content.offsetWidth;
    content.classList.add("is-entering");
  }
  const commonStatus = (values = ["Scheduled", "Completed", "Cancelled"]) => ({ label: "Status", type: "select", options: values, required: true });
  const schemas = {
    programs: {
      title: "Training program", prefix: "p",
      fields: [
        { key: "title", label: "Program name", required: true, full: true, max: 100 },
        { key: "disasterType", label: "Disaster type", type: "select", options: ["Flood", "Earthquake", "Fire", "Typhoon", "Landslide", "General preparedness", "Other"], required: true },
        { key: "type", label: "Training focus", type: "select", options: ["Emergency response", "First aid", "Evacuation", "General preparedness", "Other", "Earthquake", "Flood", "Fire", "Typhoon"], required: true },
        { key: "instructorId", label: "Assigned instructor", type: "instructor" },
        { key: "date", label: "Date", type: "date", required: true },
        { key: "location", label: "Location", required: true, max: 120 },
        { key: "capacity", label: "Participant capacity", type: "number", required: true, min: 1, max: 10000 },
        { key: "status", ...commonStatus() },
        { key: "description", label: "Program description", type: "textarea", full: true, max: 500 }
      ]
    },
    scenarios: {
      title: "Simulation scenario", prefix: "s",
      fields: [
        { key: "title", label: "Scenario name", required: true, full: true, max: 100 },
        { key: "hazard", label: "Hazard type", type: "select", options: ["Earthquake", "Flood", "Fire", "Typhoon", "Landslide", "Other"], required: true },
        { key: "severity", label: "Exercise intensity", type: "select", options: ["Low", "Medium", "High", "Critical"], required: true },
        { key: "duration", label: "Duration (minutes)", type: "number", required: true, min: 1, max: 1440 },
        { key: "objectives", label: "Learning objectives", type: "textarea", full: true, required: true, max: 1000 },
        { key: "steps", label: "Scenario steps and safety notes", type: "textarea", full: true, required: true, max: 2000 }
      ]
    },
    participants: {
      title: "Participant registration", prefix: "u",
      fields: [
        { key: "name", label: "Full name", required: true, max: 100 },
        { key: "affiliation", label: "Organization / community", required: true, max: 100 },
        { key: "email", label: "Email address", type: "email", required: true, max: 150 },
        { key: "phone", label: "Phone number", required: true, max: 30 },
        { key: "programId", label: "Training program", type: "program", required: true },
        { key: "status", label: "Registration status", type: "select", options: ["Confirmed", "Pending"], required: true },
        { key: "emergencyContact", label: "Emergency contact name and phone", full: true, max: 150 },
        { key: "registeredAt", label: "Registration date", type: "date", required: true }
      ]
    },
    evaluations: {
      title: "Performance evaluation", prefix: "e",
      fields: [
        { key: "participantId", label: "Participant", type: "participant", required: true },
        { key: "scenarioId", label: "Simulation scenario", type: "scenario", required: true },
        { key: "date", label: "Evaluation date", type: "date", required: true },
        { key: "preparedness", label: "Preparedness (1–5)", type: "score", required: true },
        { key: "response", label: "Response (1–5)", type: "score", required: true },
        { key: "teamwork", label: "Teamwork (1–5)", type: "score", required: true },
        { key: "safety", label: "Safety (1–5)", type: "score", required: true },
        { key: "feedback", label: "Evaluator feedback", type: "textarea", full: true, required: true, max: 1000 }
      ]
    },
    reports: {
      title: "Disaster drill report", prefix: "r",
      fields: [
        { key: "title", label: "Report title", required: true, full: true, max: 120 },
        { key: "scenarioId", label: "Simulation scenario", type: "scenario", required: true },
        { key: "date", label: "Drill date", type: "date", required: true },
        { key: "location", label: "Drill location", required: true, max: 120 },
        { key: "attendance", label: "Participants present", type: "number", required: true, min: 0, max: 100000 },
        { key: "outcome", label: "Overall outcome", type: "select", options: ["Successful", "Needs improvement", "Unsuccessful"], required: true },
        { key: "summary", label: "Summary and lessons learned", type: "textarea", full: true, required: true, max: 1500 },
        { key: "incidents", label: "Incidents or follow-up actions", type: "textarea", full: true, max: 1000 }
      ]
    }
  };
  function optionsFor(field) {
    if (field.type === "program") return data.programs.map(item => [item.id, item.title]);
    if (field.type === "scenario") return data.scenarios.map(item => [item.id, item.title]);
    if (field.type === "participant") return data.participants.map(item => [item.id, item.name]);
    if (field.type === "instructor") return staffProfiles.map(profile => [profile.id, profile.full_name || profile.email]);
    return field.options.map(value => [value, value]);
  }
  function fieldHTML(field, value) {
    const id = `field-${field.key}`;
    const required = field.required ? ' required aria-required="true"' : "";
    const maxLength = field.max ? ` maxlength="${field.max}"` : "";
    const common = `id="${id}" name="${field.key}" class="form-control"${required}${maxLength}`;
    let control;
    if (field.type === "textarea") control = `<textarea ${common} rows="3" placeholder="Add clear, actionable details...">${escapeHTML(value)}</textarea>`;
    else if (field.type === "select" || ["program", "scenario", "participant", "instructor"].includes(field.type)) {
      const options = optionsFor(field);
      control = `<select ${common}><option value="">Select ${escapeHTML(field.label.toLowerCase())}</option>${options.map(([key, label]) => `<option value="${escapeHTML(key)}"${String(value) === String(key) ? " selected" : ""}>${escapeHTML(label)}</option>`).join("")}</select>`;
    } else {
      const type = field.type || "text";
      const min = field.min !== undefined ? ` min="${field.min}"` : "";
      const max = field.type === "number" && field.max !== undefined ? ` max="${field.max}"` : "";
      const defaultValue = value || (type === "date" ? todayDate() : "");
      control = `<input ${common} type="${type}"${min}${max}${field.type === "number" ? ' step="1"' : ""} value="${escapeHTML(defaultValue)}" placeholder="${field.type === "number" ? "Enter a number" : ""}">`;
    }
    return `<div class="form-field${field.full ? " full" : ""}"><label for="${id}">${escapeHTML(field.label)}${field.required ? ' <span class="required">*</span>' : ""}</label>${control}${field.type === "score" ? '<span class="form-help">1 = needs support · 5 = consistently effective</span>' : ""}</div>`;
  }
  function openModal(collection, record = null) {
    if (record ? !canEditRecord(collection, record) : !canManageWorkspace()) {
      showToast(canManageAssignedPrograms()
        ? "Staff can update only programs assigned to their instructor account."
        : "User accounts cannot create or edit shared workspace records.", true);
      return;
    }
    const schema = schemas[collection];
    if (!schema) return;
    if ((collection === "evaluations" && (!data.participants.length || !data.scenarios.length)) ||
        (collection === "reports" && !data.scenarios.length) ||
        (collection === "participants" && !data.programs.length)) {
      showToast("Add the required related records first.", true);
      return;
    }
    editingId = record?.id || null;
    document.getElementById("modal-eyebrow").textContent = pageTitles[collection].toUpperCase();
    document.getElementById("modal-title").textContent = `${record ? "Edit" : "Add"} ${schema.title.toLowerCase()}`;
    document.getElementById("modal-submit").textContent = record ? "Save changes" : "Save record";
    form.dataset.collection = collection;
    const fields = schema.fields.filter(field => field.type !== "instructor" || canManageWorkspace());
    document.getElementById("modal-fields").innerHTML = fields.map(field => fieldHTML(field, record?.[field.key])).join("");
    backdrop.classList.remove("hidden");
    setTimeout(() => document.getElementById("modal-fields").querySelector("input,select,textarea")?.focus(), 0);
  }
  function closeModal() {
    backdrop.classList.add("hidden");
    form.reset();
    editingId = null;
  }
  function collectForm(collection) {
    const schema = schemas[collection];
    const record = {};
    for (const field of schema.fields) {
      const control = form.elements.namedItem(field.key);
      if (!control) continue;
      const value = control.value.trim();
      if (field.required && !value) {
        control.setCustomValidity(`${field.label} is required.`);
        control.reportValidity();
        control.setCustomValidity("");
        return null;
      }
      if (field.type === "email" && value && !control.validity.valid) {
        control.reportValidity();
        return null;
      }
      if (field.type === "number" && value !== "") {
        const number = Number(value);
        if (!Number.isInteger(number) || number < field.min || number > field.max) {
          control.setCustomValidity(`Enter a whole number between ${field.min} and ${field.max}.`);
          control.reportValidity();
          control.setCustomValidity("");
          return null;
        }
        record[field.key] = number;
      } else {
        record[field.key] = value;
      }
    }
    return record;
  }
  function deleteRecord(collection, id) {
    if (!canManageWorkspace()) {
      showToast(canManageAssignedPrograms() ? "Staff cannot delete training programs." : "User accounts cannot delete shared workspace records.", true);
      return;
    }
    const record = byId(collection, id);
    if (!record) return;
    if (!window.confirm(`Delete this ${schemas[collection].title.toLowerCase()}? This cannot be undone.`)) return;
    const previousData = clone(data);
    data[collection] = data[collection].filter(item => item.id !== id);
    if (collection === "programs") {
      data.participants.forEach(person => { if (person.programId === id) person.programId = ""; });
    }
    if (collection === "participants") data.evaluations = data.evaluations.filter(item => item.participantId !== id);
    if (collection === "scenarios") {
      data.evaluations = data.evaluations.filter(item => item.scenarioId !== id);
      data.reports.forEach(item => { if (item.scenarioId === id) item.scenarioId = ""; });
    }
    saveData(previousData).then(() => {
      render();
      showToast(workspaceOffline || !navigator.onLine
        ? "Record deleted on this device. It will sync when the internet returns."
        : "Record deleted.");
    }).catch(error => {
      console.error("Unable to delete record:", error);
      data = previousData;
      render();
      showToast(`Delete failed: ${error.message}`, true);
    });
  }
  function filterCurrentTable() {
    const search = content.querySelector("[data-search]");
    const query = search?.value.toLowerCase().trim() || "";
    const filters = [...content.querySelectorAll("[data-filter]")].filter(filter => filter.value);
    const collection = search?.dataset.search;
    const table = content.querySelector("#records-table");
    if (!collection || !table) return;
    const searchable = {
      programs: item => [item.title, item.disasterType, item.type, item.location, item.description, item.status],
      scenarios: item => [item.title, item.hazard, item.objectives, item.steps, item.severity],
      participants: item => [item.name, item.email, item.phone, item.affiliation, programName(item.programId), item.status],
      evaluations: item => [participantName(item.participantId), scenarioName(item.scenarioId), item.feedback]
    }[collection];
    const records = data[collection].filter(item => {
      const matchesSearch = !query || searchable(item).some(value => String(value || "").toLowerCase().includes(query));
      const matchesFilter = filters.every(filter => item[filter.dataset.filterKey] === filter.value);
      return matchesSearch && matchesFilter;
    });
    const renderers = {
      programs: item => `<tr><td class="primary-cell">${escapeHTML(item.title)}<span class="secondary-cell">${escapeHTML(item.description || item.location)}</span></td><td>${escapeHTML(item.disasterType || "General preparedness")}</td><td>${formatDate(item.date)}</td><td>${escapeHTML(item.type)}</td><td>${escapeHTML(item.location)}</td><td>${data.participants.filter(p => p.programId === item.id).length} / ${escapeHTML(item.capacity)}</td><td>${badge(item.status)}</td>${actionsCell("programs", item.id)}</tr>`,
      scenarios: item => `<tr><td class="primary-cell">${escapeHTML(item.title)}<span class="secondary-cell scenario-details">${escapeHTML(item.objectives || "No objectives added")}</span></td><td>${escapeHTML(item.hazard)}</td><td>${badge(item.severity)}</td><td>${escapeHTML(item.duration)} min</td><td>${item.steps ? "Defined" : "Not defined"}</td>${actionsCell("scenarios", item.id)}</tr>`,
      participants: item => `<tr><td class="primary-cell">${escapeHTML(item.name)}<span class="secondary-cell">${escapeHTML(item.affiliation)}</span></td><td>${escapeHTML(item.email)}<span class="secondary-cell">${escapeHTML(item.phone)}</span></td><td>${escapeHTML(programName(item.programId))}</td><td>${formatDate(item.registeredAt)}</td><td>${badge(item.status)}</td>${actionsCell("participants", item.id)}</tr>`,
      evaluations: item => `<tr><td class="primary-cell">${escapeHTML(participantName(item.participantId))}<span class="secondary-cell">${escapeHTML(scenarioName(item.scenarioId))}</span></td><td>${formatDate(item.date)}</td><td>${item.preparedness} / 5</td><td>${item.response} / 5</td><td>${item.teamwork} / 5</td><td>${item.safety} / 5</td><td class="score-pill">${averageScore(item)}%</td>${actionsCell("evaluations", item.id)}</tr>`
    };
    table.querySelector("tbody").innerHTML = records.map(renderers[collection]).join("") || emptyRow(table.rows[0].cells.length, "No matching records", "Try another search or filter.");
    const footer = content.querySelector(".table-footer");
    if (footer) footer.textContent = `${records.length} record${records.length === 1 ? "" : "s"}`;
  }
  function exportReports() {
    const columns = ["title", "date", "location", "scenario", "attendance", "outcome", "summary", "incidents"];
    const header = ["Report title", "Date", "Location", "Scenario", "Attendance", "Outcome", "Summary", "Incidents"];
    const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = [header, ...data.reports.map(report => [
      report.title, report.date, report.location, scenarioName(report.scenarioId), report.attendance, report.outcome, report.summary, report.incidents
    ])].map(row => row.map(quote).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff", lines], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `one-cainta-drill-reports-${todayDate()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Drill reports exported as CSV.");
  }
  function printReport(id) {
    const report = byId("reports", id);
    if (!report) return;
    const scenario = scenarioName(report.scenarioId);
    const popup = window.open("", "_blank", "width=850,height=700");
    if (!popup) {
      showToast("Allow pop-ups to print a report.", true);
      return;
    }
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(report.title)}</title><style>body{font:14px Arial,sans-serif;max-width:760px;margin:48px auto;color:#263746;line-height:1.6}h1{color:#102a43}h2{margin-top:25px;color:#176b75;font-size:15px}.meta{color:#627585}.box{padding:14px;border:1px solid #dce5e9;border-radius:6px;white-space:pre-wrap}@media print{body{margin:20px auto}}</style></head><body><p>READY PH · DISASTER PREPAREDNESS</p><h1>${escapeHTML(report.title)}</h1><p class="meta">${formatDate(report.date)} · ${escapeHTML(report.location)} · ${escapeHTML(report.attendance)} participants</p><p><strong>Scenario:</strong> ${escapeHTML(scenario)}<br><strong>Outcome:</strong> ${escapeHTML(report.outcome)}</p><h2>Summary and lessons learned</h2><div class="box">${escapeHTML(report.summary)}</div><h2>Incidents and follow-up actions</h2><div class="box">${escapeHTML(report.incidents || "None reported.")}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  }

  const sidebar = document.getElementById("sidebar");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  const mobileMenuButton = document.getElementById("mobile-menu");
  const mobileNavigation = window.matchMedia("(max-width: 700px)");
  function setSidebarOpen(isOpen, restoreFocus = false) {
    sidebar.classList.toggle("open", isOpen);
    sidebarBackdrop.classList.toggle("hidden", !isOpen);
    mobileMenuButton.setAttribute("aria-expanded", String(isOpen));
    mobileMenuButton.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
    sidebar.setAttribute("aria-hidden", String(!isOpen && mobileNavigation.matches));
    sidebar.inert = !isOpen && mobileNavigation.matches;
    if (isOpen) document.getElementById("sidebar-close").focus();
    else if (restoreFocus) mobileMenuButton.focus();
  }
  setSidebarOpen(false);
  document.querySelectorAll(".nav-link").forEach(button => button.addEventListener("click", () => {
    currentPage = button.dataset.page;
    setSidebarOpen(false, true);
    render();
  }));
  mobileMenuButton.addEventListener("click", () => setSidebarOpen(!sidebar.classList.contains("open")));
  document.getElementById("sidebar-close").addEventListener("click", () => setSidebarOpen(false, true));
  sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false, true));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && sidebar.classList.contains("open")) {
      setSidebarOpen(false, true);
    }
  });
  content.addEventListener("click", event => {
    if (event.target.closest("[data-navigate]")) setSidebarOpen(false);
  });
  mobileNavigation.addEventListener("change", event => {
    if (!event.matches) setSidebarOpen(false);
    else setSidebarOpen(sidebar.classList.contains("open"));
  });
  const syncStatusButton = document.getElementById("sync-status-button");
  const conflictsDialog = document.getElementById("offline-conflicts-dialog");
  syncStatusButton.addEventListener("click", async () => {
    if (!currentProfile) return;
    try {
      const conflicts = await window.OneCaintaOffline.getConflicts(currentProfile.id);
      workspaceConflicts = conflicts.filter(canViewWorkspaceConflict);
      if (workspaceConflicts.length) {
        renderWorkspaceConflicts();
        conflictsDialog.showModal();
      } else if (offlineWorkspaceOnly && navigator.onLine) {
        showToast("Sign in again while online to sync the changes saved on this device.", true);
      } else if (navigator.onLine) {
        await syncWorkspaceChanges();
      } else {
        showToast("Your changes are saved on this device. They will sync when the internet returns.");
      }
    } catch (error) {
      console.error("Unable to open offline sync details:", error);
      showToast(`Could not read offline sync status: ${error.message}`, true);
    }
  });
  document.getElementById("offline-conflicts-close").addEventListener("click", () => conflictsDialog.close());
  conflictsDialog.addEventListener("click", event => {
    if (event.target === conflictsDialog) conflictsDialog.close();
  });
  document.getElementById("offline-conflicts-list").addEventListener("click", event => {
    const choiceButton = event.target.closest("[data-conflict-choice]");
    if (!choiceButton) return;
    choiceButton.disabled = true;
    resolveWorkspaceConflict(choiceButton.dataset.conflictKey, choiceButton.dataset.conflictChoice).catch(error => {
      console.error("Unable to resolve an offline workspace conflict:", error);
      choiceButton.disabled = false;
      showToast(`Could not save your conflict choice: ${error.message}`, true);
    });
  });
  document.getElementById("today-label").textContent = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric" }).format(new Date());
  const signOutConfirmButton = document.getElementById("sign-out-confirm");
  const profileMenuTrigger = document.getElementById("user-avatar");
  const profileMenu = document.getElementById("profile-menu");
  const profileSettingsDialog = document.getElementById("profile-settings-dialog");
  profileMenuTrigger.addEventListener("click", () => {
    const isOpen = profileMenu.classList.toggle("hidden") === false;
    profileMenuTrigger.setAttribute("aria-expanded", String(isOpen));
  });
  document.getElementById("profile-menu-open").addEventListener("click", openProfileSettings);
  document.getElementById("profile-menu-sign-out").addEventListener("click", () => {
    profileMenu.classList.add("hidden");
    profileMenuTrigger.setAttribute("aria-expanded", "false");
    signOutBackdrop.classList.remove("hidden");
    document.getElementById("sign-out-cancel").focus();
  });
  document.addEventListener("click", event => {
    if (event.target.closest(".profile-menu-wrap")) return;
    profileMenu.classList.add("hidden");
    profileMenuTrigger.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !profileMenu.classList.contains("hidden")) {
      profileMenu.classList.add("hidden");
      profileMenuTrigger.setAttribute("aria-expanded", "false");
      profileMenuTrigger.focus();
    }
  });
  document.getElementById("profile-settings-close").addEventListener("click", () => profileSettingsDialog.close());
  profileSettingsDialog.addEventListener("click", event => {
    if (event.target === profileSettingsDialog) profileSettingsDialog.close();
  });
  document.getElementById("profile-details-form").addEventListener("submit", async event => {
    event.preventDefault();
    const submitButton = document.getElementById("profile-details-submit");
    const feedbackId = "profile-details-feedback";
    const fullName = String(new FormData(event.target).get("fullName") || "").trim();
    const phone = String(new FormData(event.target).get("phone") || "").trim();
    if (!fullName || fullName.length > 100 || phone.length > 30) {
      setProfileFeedback(feedbackId, "Enter a valid name and contact number.");
      return;
    }
    if (!currentProfile || !currentSession || offlineWorkspaceOnly || workspaceOffline || !navigator.onLine) {
      setProfileFeedback(feedbackId, "Connect to the internet and sign in again to update account details.");
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = "Saving...";
    setProfileFeedback(feedbackId, "");
    const previousName = currentProfile.full_name || "";
    const previousPhone = currentProfile.phone || "";
    try {
      const { data: updatedProfile, error: profileError } = await supabaseClient.from("user_profiles")
        .update({ full_name: fullName, phone }).eq("id", currentProfile.id)
        .select("id,full_name,phone").single();
      if (profileError) throw profileError;
      if (!updatedProfile || updatedProfile.id !== currentProfile.id ||
          updatedProfile.full_name !== fullName || updatedProfile.phone !== phone) {
        throw new Error("The server did not confirm the requested profile details.");
      }
      const { error: metadataError } = await supabaseClient.auth.updateUser({
        data: { ...currentSession.user.user_metadata, full_name: fullName, phone }
      });
      if (metadataError) {
        const { error: rollbackError } = await supabaseClient.from("user_profiles")
          .update({ full_name: previousName, phone: previousPhone }).eq("id", currentProfile.id);
        if (rollbackError) console.error("Unable to roll back profile details after the account metadata update failed:", rollbackError);
        throw metadataError;
      }
      currentProfile = { ...currentProfile, full_name: fullName, phone };
      applyWorkspaceRole(currentProfile);
      try {
        const { data: sessionResult, error: sessionError } = await supabaseClient.auth.getSession();
        if (sessionError) throw sessionError;
        if (sessionResult.session) currentSession = sessionResult.session;
      } catch (error) {
        console.error("Profile details were saved, but the updated session could not be refreshed:", error);
      }
      let snapshotMessage = "";
      try {
        await saveWorkspaceSnapshot();
      } catch (error) {
        console.error("Profile details were saved, but the offline snapshot could not be refreshed:", error);
        snapshotMessage = " Your device could not refresh its offline profile copy.";
      }
      setProfileFeedback(feedbackId, `Personal information updated.${snapshotMessage}`, true);
      showToast("Your personal information has been updated.");
    } catch (error) {
      console.error("Unable to update profile details:", error);
      setProfileFeedback(feedbackId, `Could not update personal information: ${error.message}`);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Save personal information";
    }
  });
  document.getElementById("profile-email-form").addEventListener("submit", async event => {
    event.preventDefault();
    const submitButton = document.getElementById("profile-email-submit");
    const feedbackId = "profile-email-feedback";
    const email = String(new FormData(event.target).get("email") || "").trim().toLowerCase();
    if (!currentProfile || !currentSession || offlineWorkspaceOnly || workspaceOffline || !navigator.onLine) {
      setProfileFeedback(feedbackId, "Connect to the internet and sign in again to change your email address.");
      return;
    }
    if (!email || !event.target.elements.email.validity.valid) {
      setProfileFeedback(feedbackId, "Enter a valid email address.");
      return;
    }
    if (email === String(currentSession.user.email || currentProfile.email).toLowerCase()) {
      setProfileFeedback(feedbackId, "This is already your current email address.");
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = "Sending confirmation...";
    setProfileFeedback(feedbackId, "");
    try {
      const { error } = await supabaseClient.auth.updateUser({ email });
      if (error) throw error;
      setProfileFeedback(feedbackId, "Check your email inbox and confirm the change. Your current email stays active until confirmation.", true);
    } catch (error) {
      console.error("Unable to request an email address change:", error);
      setProfileFeedback(feedbackId, `Could not update the email address: ${error.message}`);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Update email address";
    }
  });
  document.getElementById("profile-password-form").addEventListener("submit", async event => {
    event.preventDefault();
    const submitButton = document.getElementById("profile-password-submit");
    const feedbackId = "profile-password-feedback";
    const formData = new FormData(event.target);
    const currentPassword = String(formData.get("currentPassword") || "");
    const newPassword = String(formData.get("newPassword") || "");
    if (newPassword !== String(formData.get("confirmPassword") || "")) {
      setProfileFeedback(feedbackId, "The new passwords do not match.");
      return;
    }
    if (!meetsPasswordRequirements(newPassword)) {
      setProfileFeedback(feedbackId, "Use at least 8 characters, including uppercase and lowercase letters, a number, and a special character.");
      return;
    }
    if (!currentProfile || !currentSession || offlineWorkspaceOnly || workspaceOffline || !navigator.onLine) {
      setProfileFeedback(feedbackId, "Connect to the internet and sign in again to update your password.");
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = "Updating password...";
    setProfileFeedback(feedbackId, "");
    try {
      const email = currentSession.user.email || currentProfile.email;
      const { data: authResult, error: authError } = await supabaseClient.auth.signInWithPassword({
        email,
        password: currentPassword
      });
      if (authError) throw new Error(`Current password could not be verified: ${authError.message}`);
      if (!authResult.session) throw new Error("Password verification did not return a session. Please sign in again.");
      currentSession = authResult.session;
      const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
      if (error) throw error;
      event.target.reset();
      setProfileFeedback(feedbackId, "Password updated successfully.", true);
      showToast("Your password has been updated.");
    } catch (error) {
      console.error("Unable to update account password:", error);
      setProfileFeedback(feedbackId, `Could not update your password: ${error.message}`);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Update password";
    }
  });
  ["pointerdown", "keydown", "touchstart", "wheel", "scroll", "mousemove"].forEach(eventName => {
    document.addEventListener(eventName, handleWorkspaceActivity, { passive: true, capture: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !isAuthenticatedWorkspaceActive()) return;
    if (!idleTimeoutBackdrop.classList.contains("hidden")) {
      updateWorkspaceIdleCountdown();
    } else if (workspaceIdleDeadline && Date.now() >= workspaceIdleDeadline) {
      showWorkspaceIdleWarning();
    }
  });
  idleTimeoutContinueButton.addEventListener("click", resetWorkspaceIdleTimeout);
  idleTimeoutSignOutButton.addEventListener("click", () => { void endWorkspaceSessionAfterIdle(); });
  const closeSignOutDialog = (restoreFocus = true) => {
    signOutBackdrop.classList.add("hidden");
    signOutConfirmButton.disabled = false;
    signOutConfirmButton.textContent = "Sign out";
    if (restoreFocus) profileMenuTrigger.focus();
  };
  document.getElementById("sign-out-cancel").addEventListener("click", () => closeSignOutDialog());
  signOutBackdrop.addEventListener("click", event => {
    if (event.target === signOutBackdrop) closeSignOutDialog();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !signOutBackdrop.classList.contains("hidden")) closeSignOutDialog();
  });
  signOutConfirmButton.addEventListener("click", async () => {
    signOutConfirmButton.disabled = true;
    signOutConfirmButton.textContent = "Signing out...";
    const { error } = offlineWorkspaceOnly
      ? { error: null }
      : await supabaseClient.auth.signOut({ scope: navigator.onLine ? "global" : "local" });
    if (error) {
      closeSignOutDialog();
      console.error("Unable to sign out:", error);
      showToast(`Sign out failed: ${error.message}`, true);
      return;
    }
    closeSignOutDialog(false);
    if (offlineWorkspaceOnly) window.OneCaintaOffline.clearRememberedUser();
    currentSession = null;
    currentProfile = null;
    offlineWorkspaceOnly = false;
    workspaceOffline = false;
    data = emptyData();
    renderAuth();
  });
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) closeModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !backdrop.classList.contains("hidden")) closeModal(); });
  const accountSecurityBackdrop = document.getElementById("account-security-backdrop");
  accountSecurityBackdrop.addEventListener("click", event => {
    const passwordToggle = event.target.closest("[data-password-toggle='account-security-password']");
    if (!passwordToggle) return;
    const password = document.getElementById("account-security-password");
    const isVisible = password.type === "password";
    password.type = isVisible ? "text" : "password";
    passwordToggle.setAttribute("aria-pressed", String(isVisible));
    passwordToggle.setAttribute("aria-label", `${isVisible ? "Hide" : "Show"} confirmation password`);
    passwordToggle.title = `${isVisible ? "Hide" : "Show"} password`;
    passwordToggle.querySelector(".password-eye-slash").classList.toggle("hidden", !isVisible);
  });
  document.querySelectorAll("[data-account-security-close]").forEach(button => {
    button.addEventListener("click", closeAccountSecurityDialog);
  });
  accountSecurityBackdrop.addEventListener("click", event => {
    if (event.target === accountSecurityBackdrop) closeAccountSecurityDialog();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !accountSecurityBackdrop.classList.contains("hidden")) {
      closeAccountSecurityDialog();
    }
  });
  document.getElementById("account-security-form").addEventListener("submit", async event => {
    event.preventDefault();
    const password = String(new FormData(event.target).get("password") || "");
    if (!password) {
      document.getElementById("account-security-password").focus();
      return;
    }
    await submitAccountSecurityAction(password, document.getElementById("account-security-submit"));
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const collection = form.dataset.collection;
    const existing = editingId ? byId(collection, editingId) : null;
    if (existing ? !canEditRecord(collection, existing) : !canManageWorkspace()) {
      showToast(canManageAssignedPrograms()
        ? "Staff can update only existing training programs assigned to their instructor account."
        : "User accounts cannot edit shared workspace records.", true);
      closeModal();
      return;
    }
    const record = collectForm(collection);
    if (!record) return;
    if (collection === "participants" && record.status === "Confirmed") {
      const program = byId("programs", record.programId);
      const confirmed = data.participants.filter(person =>
        person.programId === record.programId && person.status === "Confirmed" && person.id !== editingId
      ).length;
      if (program && confirmed >= Number(program.capacity)) {
        showToast("This program has reached capacity. Register as pending or choose another program.", true);
        return;
      }
    }
    const previousData = clone(data);
    const wasEditing = Boolean(editingId);
    if (wasEditing) {
      const index = data[collection].findIndex(item => item.id === editingId);
      if (index >= 0) data[collection][index] = { ...data[collection][index], ...record };
    } else {
      record.id = uid(schemas[collection].prefix);
      data[collection].push(record);
    }
    try {
      await saveData(previousData);
      closeModal();
      render();
      showToast(workspaceOffline || !navigator.onLine
        ? "Saved on this device. This change will sync when the internet returns."
        : wasEditing ? "Changes saved successfully." : "Record added successfully.");
    } catch (error) {
      console.error("Unable to save record:", error);
      data = previousData;
      render();
      showToast(`Save failed: ${error.message}`, true);
    }
  });
  content.addEventListener("click", event => {
    const button = event.target.closest("[data-create],[data-action],[data-navigate]");
    if (!button) return;
    if ((button.dataset.create && !canManageWorkspace()) ||
        (button.dataset.action === "edit" && !canEditRecord(button.dataset.collection, byId(button.dataset.collection, button.dataset.id))) ||
        (["delete", "seed-demo", "show-invite", "hide-invite"].includes(button.dataset.action) && !canManageWorkspace())) {
      showToast(canManageAssignedPrograms()
        ? "Staff can update only training programs assigned to their instructor account."
        : "Users can manage their own enrollments and profile, but not shared workspace records.", true);
      return;
    }
    if (button.dataset.create) openModal(button.dataset.create);
    if (button.dataset.navigate) {
      currentPage = button.dataset.navigate;
      render();
    }
    if (button.dataset.action === "edit") {
      const item = byId(button.dataset.collection, button.dataset.id);
      if (item) openModal(button.dataset.collection, item);
    }
    if (button.dataset.action === "delete") deleteRecord(button.dataset.collection, button.dataset.id);
    if (button.dataset.action === "enroll") void enrollInProgram(button.dataset.programId);
    if (button.dataset.action === "cancel-enrollment") void cancelUserEnrollment(button.dataset.participantId);
    if (button.dataset.action === "mark-notifications-read") void markUserNotificationsRead();
    if (button.dataset.action === "retry-training-emails") {
      if (!canManageWorkspace()) {
        showToast("Only an Admin can retry email alerts.", true);
        return;
      }
      void supabaseClient.functions.invoke("notify-new-training", { body: {} }).then(({ data: result, error }) => {
        if (error) {
          console.error("Unable to retry pending training email alerts:", error);
          showToast(`Email alerts could not be sent: ${error.message}`, true);
          return;
        }
        showToast(`${result?.sent ?? 0} pending training email alert${result?.sent === 1 ? "" : "s"} sent.`);
      }).catch(error => {
        console.error("Unable to retry pending training email alerts:", error);
        showToast(`Email alerts could not be sent: ${error.message}`, true);
      });
    }
    if (button.dataset.action === "export-reports") exportReports();
    if (button.dataset.action === "print-report") printReport(button.dataset.id);
    if (button.dataset.action === "show-invite") content.querySelector("#invite-admin-form")?.classList.remove("hidden");
    if (button.dataset.action === "hide-invite") content.querySelector("#invite-admin-form")?.classList.add("hidden");
    if (button.dataset.action === "save-account-role") {
      if (!canManageWorkspace()) {
        showToast("Only an Admin can change workspace account roles.", true);
        return;
      }
      const selector = content.querySelector(`[data-role-user="${CSS.escape(button.dataset.accountId)}"]`);
      if (!selector || selector.value === selector.dataset.originalRole) return;
      openAccountSecurityDialog({
        type: "update-role",
        userId: button.dataset.accountId,
        email: button.dataset.accountEmail,
        role: selector.value
      });
    }
    if (button.dataset.action === "delete-account") {
      if (!canManageWorkspace()) {
        showToast("Only an Admin can delete workspace accounts.", true);
        return;
      }
      openAccountSecurityDialog({
        type: "delete",
        userId: button.dataset.accountId,
        email: button.dataset.accountEmail
      });
    }
    if (button.dataset.action === "seed-demo") {
      if (!window.confirm("Add the sample training, participant, scenario, evaluation, and report records to this empty workspace?")) return;
      const previousData = clone(data);
      data = clone(demoData);
      saveData(previousData).then(() => {
        render();
        showToast("Sample records added to the shared workspace.");
      }).catch(error => {
        console.error("Unable to seed demo records:", error);
        data = previousData;
        render();
        showToast(`Could not add sample records: ${error.message}`, true);
      });
    }
  });
  content.addEventListener("input", event => {
    if (event.target.matches("[data-search]")) filterCurrentTable();
    if (event.target.matches("[data-account-search]")) filterWorkspaceAccounts();
    if (event.target.matches("[data-drill-search]")) filterBrowseDrills();
  });
  content.addEventListener("change", async event => {
    if (event.target.matches("[data-filter]")) filterCurrentTable();
    if (event.target.matches("[data-user-drill-filter]")) filterBrowseDrills();
    if (event.target.matches("[data-account-filter]")) filterWorkspaceAccounts();
    if (event.target.matches("[data-role-user]")) {
      const selector = event.target;
      const row = selector.closest("[data-account-row]");
      const saveButton = row?.querySelector("[data-action='save-account-role']");
      if (saveButton) saveButton.disabled = selector.value === selector.dataset.originalRole;
    }
    if (event.target.matches("[data-account-status]")) {
      const selector = event.target;
      const { error } = await supabaseClient.from("user_profiles")
        .update({ account_status: selector.value }).eq("id", selector.dataset.accountStatus)
        .select("id,account_status").single();
      if (error) {
        console.error("Unable to update account status:", error);
        selector.value = selector.dataset.originalStatus;
        showToast(`Account status update failed: ${error.message}`, true);
        return;
      }
      selector.dataset.originalStatus = selector.value;
      selector.closest("[data-account-row]").dataset.accountState = selector.value;
      filterWorkspaceAccounts();
      showToast(`Account status set to ${selector.value}. This is a label only and does not change sign-in access.`);
    }
  });
  content.addEventListener("submit", async event => {
    if (event.target.id !== "invite-admin-form") return;
    event.preventDefault();
    const formData = new FormData(event.target);
    const { error } = await supabaseClient.functions.invoke("invite-admin", {
      body: { email: formData.get("email"), fullName: formData.get("fullName"), role: formData.get("role") }
    });
    if (error) {
      console.error("Unable to invite workspace account:", error);
      showToast(`Invitation failed: ${error.message}`, true);
      return;
    }
    event.target.reset();
    event.target.classList.add("hidden");
    showToast("Invitation sent. The person must accept it using the invitation email.");
    renderUsers();
  });
  document.getElementById("auth-card").addEventListener("submit", async event => {
    event.preventDefault();
    const formData = new FormData(event.target);
    if (event.target.id === "connection-form") {
      const url = String(formData.get("url") || "").trim().replace(/\/+$/, "");
      const anonKey = String(formData.get("anonKey") || "").trim();
      let parsedUrl;
      try { parsedUrl = new URL(url); } catch { authMessage("Enter a valid Supabase project URL."); return; }
      if (parsedUrl.protocol !== "https:" || !anonKey) {
        authMessage("Use an HTTPS Supabase project URL and its public publishable/anon key.");
        return;
      }
      const config = { url, anonKey };
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      } catch (error) {
        console.error("Unable to save Supabase connection settings:", error);
        authMessage("Could not save the connection settings in this browser.");
        return;
      }
      try {
        await initializeSupabase(config);
      } catch (error) {
        console.error("Supabase connection failed:", error);
        renderAuth(error.message || "Could not connect to Supabase.");
      }
      return;
    }
    if (event.target.id === "login-form") {
      const email = String(formData.get("email")).trim().toLowerCase();
      const submitButton = event.target.querySelector('[type="submit"]');
      const attemptState = getLoginAttemptState(email);
      if (attemptState.lockedUntil > Date.now()) {
        updateLoginLockUI();
        return;
      }
      submitButton.disabled = true;
      try {
        const { data: result, error } = await supabaseClient.auth.signInWithPassword({
          email,
          password: String(formData.get("password") || "")
        });
        if (error) {
          if (isInvalidCredentialsError(error)) {
            const state = recordFailedLogin(email);
            submitButton.disabled = false;
            if (state.lockedUntil > Date.now()) updateLoginLockUI();
            else authMessage(`Invalid login credentials. Attempt ${state.failures} of ${LOGIN_MAX_ATTEMPTS}.`);
            return;
          }
          throw error;
        }
        clearFailedLogins(email);
        if (!result.session) throw new Error("Password sign-in succeeded but no session was returned. Try again.");
        await startWorkspace(result.session);
      } catch (error) {
        console.error("Password sign-in failed:", error);
        submitButton.disabled = false;
        authMessage(error.message || "Sign-in could not be completed. Check your email and password.");
      }
      return;
    }
    if (event.target.id === "signup-form") {
      const fullName = String(formData.get("fullName") || "").trim();
      const email = String(formData.get("email") || "").trim().toLowerCase();
      if (!fullName || fullName.length > 100) {
        authMessage("Enter your name using no more than 100 characters.");
        return;
      }
      const password = String(formData.get("password") || "");
      if (password !== String(formData.get("confirmPassword") || "")) {
        authMessage("The password and confirmation do not match.");
        return;
      }
      if (!meetsPasswordRequirements(password)) {
        authMessage("Use at least 8 characters, including uppercase and lowercase letters, a number, and a special character.");
        return;
      }
      const submitButton = event.target.querySelector('[type="submit"]');
      submitButton.disabled = true;
      submitButton.setAttribute("aria-busy", "true");
      submitButton.innerHTML = '<span class="loading-spinner" aria-hidden="true"></span> Creating account...';
      try {
        const { data: result, error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: SIGNUP_CONFIRMATION_REDIRECT_URL
          }
        });
        if (error) throw error;
        if (result.session) {
          await startWorkspace(result.session);
          return;
        }
        pendingConfirmationEmail = email;
        authMode = "confirmation";
        renderAuth();
      } catch (error) {
        console.error("Unable to create account:", error);
        submitButton.disabled = false;
        submitButton.removeAttribute("aria-busy");
        submitButton.innerHTML = 'Create account <span aria-hidden="true">→</span>';
        authMessage(error.message || "Could not create your account. Check your connection and try again.");
      }
      return;
    }
    if (event.target.id === "forgot-password-form") {
      const email = String(formData.get("email") || "").trim().toLowerCase();
      const submitButton = event.target.querySelector('[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "Sending reset link...";
      try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
          redirectTo: AUTH_REDIRECT_URL
        });
        if (error) throw error;
        authMessage("If an account exists for that email, a password reset link has been sent.", true);
      } catch (error) {
        console.error("Unable to send password reset email:", error);
        authMessage(error.message || "Could not send the reset link. Check your connection and try again.");
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Send reset link";
      }
      return;
    }
    if (event.target.id === "password-setup-form") {
      const password = String(formData.get("password") || "");
      if (password !== String(formData.get("confirmPassword") || "")) {
        authMessage("The two passwords do not match.");
        return;
      }
      if (!meetsPasswordRequirements(password)) {
        authMessage("Use at least 8 characters, including uppercase and lowercase letters, a number, and a special character.");
        return;
      }
      const { error } = await supabaseClient.auth.updateUser({ password });
      if (error) {
        authMessage(error.message);
        return;
      }
      const { error: signOutError } = await supabaseClient.auth.signOut();
      if (signOutError) {
        console.error("Unable to end invitation or recovery session after setting password:", signOutError);
        authMessage(`Password saved, but the temporary session could not be closed: ${signOutError.message}`);
        return;
      }
      inviteSession = null;
      invitationRedirect = false;
      passwordRecovery = false;
      authMode = "login";
      renderAuth("Password saved. Sign in with your email and password.", true);
    }
  });
  ["copy", "cut", "paste", "drop"].forEach(eventName => {
    document.getElementById("auth-card").addEventListener(eventName, event => {
      const input = event.target;
      if (input.form?.id !== "signup-form" || !["password", "confirmPassword"].includes(input.name)) return;
      event.preventDefault();
    });
  });
  document.getElementById("auth-card").addEventListener("input", event => {
    if (event.target.id === "signup-password") updateSignupPasswordStrength();
    if (event.target.id === "new-password") updateSignupPasswordStrength("new-password", "setup-password-strength");
    if (event.target.id === "login-email") updateLoginLockUI();
  });
  document.getElementById("profile-password-form").addEventListener("input", event => {
    if (event.target.id === "profile-new-password") {
      updateSignupPasswordStrength("profile-new-password", "profile-password-strength");
    }
  });
  document.getElementById("auth-card").addEventListener("click", async event => {
    const retryButton = event.target.closest("#retry-session-restore");
    if (retryButton) {
      await retrySessionRestore(retryButton);
      return;
    }
    const passwordToggle = event.target.closest("[data-password-toggle]");
    if (passwordToggle) {
      const input = document.getElementById(passwordToggle.dataset.passwordToggle);
      if (!input) return;
      const isVisible = input.type === "password";
      input.type = isVisible ? "text" : "password";
      passwordToggle.setAttribute("aria-pressed", String(isVisible));
      passwordToggle.setAttribute("aria-label", `${isVisible ? "Hide" : "Show"} ${input.labels[0]?.textContent.toLowerCase() || "password"}`);
      passwordToggle.title = `${isVisible ? "Hide" : "Show"} password`;
      passwordToggle.querySelector(".password-eye-slash")?.classList.toggle("hidden", !isVisible);
      return;
    }
    const action = event.target.closest("[data-auth-action]")?.dataset.authAction;
    if (!action) return;
    if (action === "google-oauth") {
      const googleButton = event.target.closest("[data-auth-action]");
      googleButton.disabled = true;
      try {
        const { data: result, error } = await supabaseClient.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: AUTH_REDIRECT_URL }
        });
        if (error) throw error;
        if (!result.url) throw new Error("Google sign-in did not return a redirect URL. Check the Google provider configuration in Supabase.");
        window.location.assign(result.url);
      } catch (error) {
        console.error("Google sign-in could not be started:", error);
        googleButton.disabled = false;
        authMessage(error.message || "Could not start Google sign-in. Check the Google provider configuration and try again.");
      }
      return;
    }
    if (action === "resend-confirmation") {
      const email = String(pendingConfirmationEmail || document.getElementById("login-email")?.value || "").trim().toLowerCase();
      if (!email) {
        authMessage("Enter your email address above first.");
        document.getElementById("login-email")?.focus();
        return;
      }
      const resendButton = event.target.closest("[data-auth-action]");
      resendButton.disabled = true;
      try {
        const { error } = await supabaseClient.auth.resend({
          type: "signup",
          email,
          options: { emailRedirectTo: SIGNUP_CONFIRMATION_REDIRECT_URL }
        });
        if (error) throw error;
        authMessage("If this address has an unconfirmed account, a fresh confirmation link has been sent.", true);
      } catch (error) {
        console.error("Unable to resend signup confirmation:", error);
        authMessage(error.message || "Could not resend the confirmation email. Try again later.");
      } finally {
        resendButton.disabled = false;
      }
      return;
    }
    if (action === "login") {
      authMode = "login";
      renderAuth();
    } else if (action === "signup") {
      authMode = "signup";
      renderAuth();
    } else if (action === "forgot") {
      authMode = "forgot";
      renderAuth();
    }
  });
  document.querySelectorAll("[data-theme-toggle]").forEach(button => {
    button.addEventListener("click", () => {
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", button);
    });
  });
  updateThemeToggleButtons();
  document.querySelectorAll("[data-view]").forEach(control => {
    control.addEventListener("click", () => {
      if (control.dataset.view === "login") renderAuth();
      if (control.dataset.view === "landing") showLanding();
    });
  });
  initializeLandingMotion();
  initializeMastheadScrollAnimation();
  window.addEventListener("offline", () => {
    if (!currentProfile) return;
    workspaceOffline = true;
    stopWorkspaceActivityTracking();
    stopWorkspaceIdleTimeout();
    applyWorkspaceRole(currentProfile);
    if (currentPage === "users") currentPage = "dashboard";
    void updateWorkspaceSyncStatus();
    render();
  });
  window.addEventListener("online", () => {
    if (!currentSession || !currentProfile) return;
    if (offlineWorkspaceOnly) {
      void updateWorkspaceSyncStatus();
      showToast("Sign in again while online to sync the changes saved on this device.", true);
      return;
    }
    void syncWorkspaceChanges().then(() => {
      if (!workspaceOffline && currentSession) {
        startWorkspaceActivityTracking();
        startWorkspaceIdleTimeout();
        applyWorkspaceRole(currentProfile);
        render();
      }
    });
  });
  window.addEventListener("focus", () => { refreshCurrentProfile(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void recordWorkspaceActivity();
      refreshCurrentProfile();
      if (currentPage === "users") void refreshAccountActivity();
      if (navigator.onLine && currentProfile) void syncWorkspaceChanges();
    }
  });
  window.setInterval(() => { refreshCurrentProfile(); }, 60000);
  initializeAuth();
})();
