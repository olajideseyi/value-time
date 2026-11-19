import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const APP_URL = (Deno.env.get("VALUE_TIME_APP_URL") ?? "").replace(/\/$/, "");
const REDIRECT_URI = SUPABASE_URL + "/functions/v1/google-calendar";
const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/calendar.events";

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function b64url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function sha256(value: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function encryptionKey() {
  const raw = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY") ?? "";
  const bytes = fromB64url(raw);
  if (bytes.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64url-encoded 32-byte key.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return b64url(iv) + "." + b64url(new Uint8Array(encrypted));
}
async function decrypt(value: string) {
  const [ivPart, dataPart] = value.split(".");
  if (!ivPart || !dataPart) throw new Error("Stored Google token could not be read.");
  const key = await encryptionKey();
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(ivPart) }, key, fromB64url(dataPart));
  return new TextDecoder().decode(clear);
}
function adminClient() {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    (() => {
      try {
        const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
        return Deno.env.get(keys.default ?? "");
      } catch { return ""; }
    })();
  if (!SUPABASE_URL || !serviceKey) throw new Error("Supabase server credentials are not configured for Google Calendar.");
  return createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
function userClient(authHeader: string) {
  const publishable = Deno.env.get("SUPABASE_ANON_KEY") ??
    (() => {
      try {
        const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
        return Deno.env.get(keys.default ?? "");
      } catch { return ""; }
    })();
  if (!publishable) throw new Error("Supabase publishable key is unavailable.");
  return createClient(SUPABASE_URL, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
}
function appRedirect(result: string, detail?: string) {
  if (!APP_URL) return new Response("Google Calendar callback saved, but VALUE_TIME_APP_URL is not configured.", { status: 500 });
  const target = new URL(APP_URL);
  target.pathname = "/settings";
  target.searchParams.set("google_calendar", result);
  if (detail) target.searchParams.set("reason", detail.slice(0, 180));
  return Response.redirect(target.toString(), 303);
}
function googleEventBody(row: Record<string, any>) {
  const body: Record<string, any> = {
    summary: row.title,
    description: row.description ?? "",
    location: row.location ?? "",
    start: { dateTime: new Date(row.starts_at).toISOString(), timeZone: row.timezone || "Africa/Lagos" },
    end: { dateTime: new Date(row.ends_at).toISOString(), timeZone: row.timezone || "Africa/Lagos" },
  };
  if (row.recurrence_type === "weekly") {
    const dayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    const days = Array.isArray(row.recurrence_days) && row.recurrence_days.length
      ? row.recurrence_days.map((day: number) => dayCodes[Number(day)]).filter(Boolean)
      : [dayCodes[new Date(row.starts_at).getDay()]];
    let rule = "RRULE:FREQ=WEEKLY;BYDAY=" + days.join(",");
    if (row.recurrence_until) rule += ";UNTIL=" + row.recurrence_until.replaceAll("-", "") + "T235959Z";
    body.recurrence = [rule];
  }
  return body;
}
function parseGoogleRecurrence(rules: string[] | undefined) {
  const weekly = (rules ?? []).find((rule) => rule.startsWith("RRULE:") && rule.includes("FREQ=WEEKLY"));
  if (!weekly) return { recurrence_type: "none", recurrence_days: [], recurrence_until: null };
  const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const byDay = weekly.match(/(?:^|;)BYDAY=([^;]+)/)?.[1];
  const until = weekly.match(/(?:^|;)UNTIL=(\\d{4})(\\d{2})(\\d{2})/) ;
  return {
    recurrence_type: "weekly",
    recurrence_days: byDay ? byDay.split(",").map((day) => days.indexOf(day)).filter((day) => day >= 0) : [],
    recurrence_until: until ? until[1] + "-" + until[2] + "-" + until[3] : null,
  };
}
async function googleRequest(url: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message ?? data.error_description ?? "Google Calendar request failed (" + response.status + ").");
  return data;
}
async function getFreshAccessToken(db: ReturnType<typeof adminClient>, userId: string, connection: Record<string, any>) {
  if (new Date(connection.token_expires_at).getTime() > Date.now() + 5 * 60_000) {
    return await decrypt(connection.access_token_ciphertext);
  }
  const refreshToken = await decrypt(connection.refresh_token_ciphertext);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const refreshed = await response.json();
  if (!response.ok || !refreshed.access_token) throw new Error(refreshed.error_description ?? "Google token refresh failed. Reconnect your Google account.");
  const expiry = new Date(Date.now() + Number(refreshed.expires_in ?? 3600) * 1000).toISOString();
  const { error } = await db.from("google_calendar_connections").update({
    access_token_ciphertext: await encrypt(refreshed.access_token),
    token_expires_at: expiry,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  if (error) throw error;
  return refreshed.access_token as string;
}
async function syncCalendar(db: ReturnType<typeof adminClient>, userId: string, connection: Record<string, any>) {
  const accessToken = await getFreshAccessToken(db, userId, connection);
  const now = new Date();
  const timeMin = new Date(now.getTime() - 30 * 86400_000).toISOString();
  const timeMax = new Date(now.getTime() + 365 * 86400_000).toISOString();
  let pageToken = "";
  let imported = 0, exported = 0, updated = 0, skippedAllDay = 0, cancelled = 0;
  const remoteIds = new Set<string>();

  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(connection.calendar_id || "primary") + "/events");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "false");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("maxResults", "2500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await googleRequest(url.toString(), accessToken);
    for (const event of page.items ?? []) {
      if (!event.id) continue;
      remoteIds.add(event.id);
      const { data: local } = await db.from("schedule_entries").select("*")
        .eq("user_id", userId).eq("google_calendar_event_id", event.id).maybeSingle();
      if (event.status === "cancelled") {
        if (local?.is_active) {
          const { error } = await db.from("schedule_entries").update({ is_active: false, google_calendar_synced_at: now.toISOString() }).eq("id", local.id).eq("user_id", userId);
          if (error) throw error;
          cancelled++;
        }
        continue;
      }
      const startValue = event.start?.dateTime;
      const endValue = event.end?.dateTime;
      if (!startValue || !endValue) { skippedAllDay++; continue; }
      const googleUpdated = new Date(event.updated ?? event.created ?? 0).getTime();
      if (!local) {
        const { error } = await db.from("schedule_entries").insert({
          user_id: userId,
          title: event.summary || "Google Calendar event",
          description: event.description || null,
          activity_type: "other",
          starts_at: new Date(startValue).toISOString(),
          ends_at: new Date(endValue).toISOString(),
          timezone: event.start?.timeZone || "Africa/Lagos",
          location: event.location || null,
          meeting_url: event.hangoutLink || event.htmlLink || null,
          ...parseGoogleRecurrence(event.recurrence),

          is_active: true,
          google_calendar_event_id: event.id,
          google_calendar_event_etag: event.etag || null,
          google_calendar_synced_at: now.toISOString(),
        });
        if (error && error.code !== "23505") throw error;
        if (!error) imported++;
        continue;
      }
      const syncedAt = new Date(local.google_calendar_synced_at ?? local.created_at).getTime();
      const localUpdated = new Date(local.updated_at ?? local.created_at).getTime();
      if (localUpdated > syncedAt && localUpdated >= googleUpdated) {
        const remote = await googleRequest(
          "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(connection.calendar_id || "primary") + "/events/" + encodeURIComponent(event.id),
          accessToken,
          { method: "PATCH", body: JSON.stringify(googleEventBody(local)) },
        );
        const { error } = await db.from("schedule_entries").update({
          google_calendar_event_etag: remote.etag || local.google_calendar_event_etag,
          google_calendar_synced_at: now.toISOString(),
        }).eq("id", local.id).eq("user_id", userId);
        if (error) throw error;
        updated++;
      } else if (googleUpdated > syncedAt) {
        const { error } = await db.from("schedule_entries").update({
          title: event.summary || "Google Calendar event",
          description: event.description || null,
          starts_at: new Date(startValue).toISOString(),
          ends_at: new Date(endValue).toISOString(),
          timezone: event.start?.timeZone || local.timezone || "Africa/Lagos",
          location: event.location || null,
          meeting_url: event.hangoutLink || event.htmlLink || null,
          is_active: true,
          google_calendar_event_etag: event.etag || null,
          google_calendar_synced_at: now.toISOString(),
        }).eq("id", local.id).eq("user_id", userId);
        if (error) throw error;
        updated++;
      }
    }
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);

  const { data: localRows, error: localError } = await db.from("schedule_entries").select("*")
    .eq("user_id", userId).eq("is_active", true).gte("starts_at", timeMin).lte("starts_at", timeMax);
  if (localError) throw localError;
  for (const row of localRows ?? []) {
    if (!row.google_calendar_event_id) {
      const created = await googleRequest(
        "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(connection.calendar_id || "primary") + "/events",
        accessToken,
        { method: "POST", body: JSON.stringify(googleEventBody(row)) },
      );
      const { error } = await db.from("schedule_entries").update({
        google_calendar_event_id: created.id,
        google_calendar_event_etag: created.etag || null,
        google_calendar_synced_at: now.toISOString(),
      }).eq("id", row.id).eq("user_id", userId);
      if (error) throw error;
      exported++;
    } else if (!remoteIds.has(row.google_calendar_event_id) &&
      new Date(row.updated_at ?? row.created_at).getTime() > new Date(row.google_calendar_synced_at ?? row.created_at).getTime()) {
      const remote = await googleRequest(
        "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(connection.calendar_id || "primary") + "/events/" + encodeURIComponent(row.google_calendar_event_id),
        accessToken,
        { method: "PATCH", body: JSON.stringify(googleEventBody(row)) },
      );
      const { error } = await db.from("schedule_entries").update({
        google_calendar_event_etag: remote.etag || row.google_calendar_event_etag,
        google_calendar_synced_at: now.toISOString(),
      }).eq("id", row.id).eq("user_id", userId);
      if (error) throw error;
      updated++;
    }
  }
  const { error: connectionError } = await db.from("google_calendar_connections").update({
    last_synced_at: now.toISOString(), updated_at: now.toISOString(),
  }).eq("user_id", userId);
  if (connectionError) throw connectionError;
  return { imported, exported, updated, cancelled, skippedAllDay, window: "30 days past · 365 days ahead", lastSyncedAt: now.toISOString() };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  const allowedOrigin = APP_URL && origin === APP_URL ? APP_URL : (APP_URL ? APP_URL : "null");
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = adminClient();
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      if (url.searchParams.get("error")) return appRedirect("error", url.searchParams.get("error") ?? "Google consent was cancelled.");
      if (!state || !code) return new Response("Missing Google OAuth code or state.", { status: 400 });
      const stateHash = await sha256(state);
      const { data: oauthState, error: stateError } = await db.from("google_calendar_oauth_states")
        .select("*").eq("state_hash", stateHash).maybeSingle();
      if (stateError || !oauthState || new Date(oauthState.expires_at).getTime() < Date.now()) {
        return new Response("This Google Calendar connection request has expired. Return to Value Time and try again.", { status: 400 });
      }
      await db.from("google_calendar_oauth_states").delete().eq("state_hash", stateHash);
      const clientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
      const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
      if (!clientId || !clientSecret) return appRedirect("error", "Google OAuth credentials are not configured.");
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.access_token) return appRedirect("error", tokens.error_description ?? "Google could not complete the connection.");
      const { data: previous } = await db.from("google_calendar_connections").select("refresh_token_ciphertext")
        .eq("user_id", oauthState.user_id).maybeSingle();
      const refreshCiphertext = tokens.refresh_token
        ? await encrypt(tokens.refresh_token)
        : previous?.refresh_token_ciphertext;
      if (!refreshCiphertext) return appRedirect("error", "Google did not provide a refresh token. Disconnect the app in your Google Account and try connecting again.");
      const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: "Bearer " + tokens.access_token },
      });
      const googleProfile = await profileResponse.json();
      if (!profileResponse.ok || !googleProfile.email) return appRedirect("error", "Could not verify the connected Google account.");
      const { error } = await db.from("google_calendar_connections").upsert({
        user_id: oauthState.user_id,
        connected_email: googleProfile.email,
        calendar_id: "primary",
        access_token_ciphertext: await encrypt(tokens.access_token),
        refresh_token_ciphertext: refreshCiphertext,
        token_expires_at: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) return appRedirect("error", "Could not save your secure Google connection.");
      return appRedirect("connected");
    }

    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, corsHeaders);
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token || token === authHeader) return json({ error: "Sign in to Value Time first." }, 401, corsHeaders);
    const user = userClient(authHeader);
    const { data: userResult, error: userError } = await user.auth.getUser(token);
    if (userError || !userResult.user) return json({ error: "Your session is invalid or expired. Sign in again." }, 401, corsHeaders);
    const userId = userResult.user.id;
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "authorize") {
      const clientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
      if (!clientId || !Deno.env.get("GOOGLE_CLIENT_SECRET") || !APP_URL) {
        return json({ error: "Google Calendar setup is not complete yet. Add the Google OAuth credentials and Value Time app URL in Supabase Function Secrets." }, 503, corsHeaders);
      }
      await encryptionKey();
      await db.from("google_calendar_oauth_states").delete().lt("expires_at", new Date().toISOString());
      const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const { error } = await db.from("google_calendar_oauth_states").insert({
        state_hash: await sha256(state),
        user_id: userId,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      if (error) throw error;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", GOOGLE_SCOPE);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("include_granted_scopes", "true");
      authUrl.searchParams.set("state", state);
      return json({ authUrl: authUrl.toString() }, 200, corsHeaders);
    }

    const { data: connection, error: connectionError } = await db.from("google_calendar_connections")
      .select("connected_email,last_synced_at").eq("user_id", userId).maybeSingle();
    if (connectionError) throw connectionError;
    if (action === "status") return json({ connected: !!connection, email: connection?.connected_email ?? null, lastSyncedAt: connection?.last_synced_at ?? null }, 200, corsHeaders);
    if (action === "disconnect") {
      const { error } = await db.from("google_calendar_connections").delete().eq("user_id", userId);
      if (error) throw error;
      await db.from("google_calendar_oauth_states").delete().eq("user_id", userId);
      return json({ connected: false }, 200, corsHeaders);
    }
    if (action === "sync") {
      if (!connection) return json({ error: "Connect a Google account before syncing." }, 409, corsHeaders);
      const { data: fullConnection, error } = await db.from("google_calendar_connections").select("*").eq("user_id", userId).single();
      if (error || !fullConnection) throw error ?? new Error("Google Calendar connection not found.");
      const result = await syncCalendar(db, userId, fullConnection);
      return json({ ok: true, ...result }, 200, corsHeaders);
    }
    return json({ error: "Unknown Google Calendar action." }, 400, corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Calendar request failed.";
    return json({ error: message }, 500, corsHeaders);
  }
});
