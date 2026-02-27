// services/Microsoftgraphservice.js
import axios from "axios";
import { ConfidentialClientApplication } from "@azure/msal-node";

const GRAPH_API = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || "common"}/oauth2/v2.0/token`;

// ─── MSAL (seulement pour getAuthUrl + getTokenFromCode) ──────
const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId:     process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    authority:    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || "common"}`,
  },
});

export const getAuthUrl = async (userId) => {
  return await msalClient.getAuthCodeUrl({
    scopes:      ["openid", "profile", "email", "offline_access", "Calendars.ReadWrite"],
    redirectUri: process.env.MICROSOFT_REDIRECT_URI,
    state:       String(userId),
  });
};

export const getTokenFromCode = async (code) => {
  // ✅ Appel HTTP direct → on récupère access_token + refresh_token garantis
  const params = new URLSearchParams({
    client_id:     process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    code,
    redirect_uri:  process.env.MICROSOFT_REDIRECT_URI,
    grant_type:    "authorization_code",
    scope:         "openid profile email offline_access https://graph.microsoft.com/Calendars.ReadWrite",
  });

  const response = await axios.post(TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  // Décode le id_token pour avoir l'email
  let email = null;
  let homeAccountId = null;
  try {
    const payload = JSON.parse(Buffer.from(response.data.id_token.split(".")[1], "base64").toString());
    email = payload.preferred_username || payload.email || payload.upn || null;
    homeAccountId = payload.oid || payload.sub || null;
  } catch {}

  return {
    accessToken:   response.data.access_token,
    refreshToken:  response.data.refresh_token,   // ✅ refresh_token direct
    expiresIn:     response.data.expires_in,
    homeAccountId,
    outlookEmail:  email,
  };
};

// ✅ REFRESH DIRECT via HTTP — 100% fiable, scope correct
export const refreshAccessToken = async (refreshToken) => {
  const params = new URLSearchParams({
    client_id:     process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type:    "refresh_token",
    scope:         "openid offline_access https://graph.microsoft.com/Calendars.ReadWrite",
  });

  const response = await axios.post(TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return {
    accessToken:  response.data.access_token,
    refreshToken: response.data.refresh_token || refreshToken, // nouveau ou ancien
    expiresIn:    response.data.expires_in || 3600,
  };
};

// ─── GRAPH REQUEST ────────────────────────────────────────────

const graphRequest = async (method, endpoint, accessToken, data = null) => {
  const config = {
    method,
    url: `${GRAPH_API}${endpoint}`,
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  };
  if (data) config.data = data;

  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      const err = new Error("TOKEN_EXPIRED");
      err.code = "TOKEN_EXPIRED";
      throw err;
    }
    throw error;
  }
};

// ─── FORMATTERS ───────────────────────────────────────────────

const formatOutlookEvent = (e) => ({
  outlookId:        e.id,
  title:            e.subject,
  description:      e.bodyPreview,
  start:            e.start?.dateTime,
  end:              e.end?.dateTime,
  isAllDay:         e.isAllDay,
  location:         e.location?.displayName,
  onlineMeetingUrl: e.onlineMeeting?.joinUrl,
  attendees: (e.attendees || []).map((a) => ({
    email: a.emailAddress?.address, name: a.emailAddress?.name, status: a.status?.response,
  })),
  isCancelled: e.isCancelled,
});

const toGraphDateTime = (value, timeZone = "Africa/Tunis") => {
  // Microsoft Graph expects dateTime as a "local" string when timeZone is provided.
  // If you send ISO with "Z", Outlook will shift times.
  const d = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);

  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
};

const toOutlookFormat = (event) => ({
  subject:  event.title,
  body:     { contentType: "text", content: event.description || "" },
  start:    { dateTime: toGraphDateTime(event.start, "Africa/Tunis"), timeZone: "Africa/Tunis" },
  end:      { dateTime: toGraphDateTime(event.end,   "Africa/Tunis"), timeZone: "Africa/Tunis" },
  location: event.location ? { displayName: event.location } : undefined,
  attendees: (event.attendees || []).map((a) => ({
    emailAddress: { address: a.email, name: a.name }, type: "required",
  })),
  isAllDay: event.isAllDay || false,
});

// ─── CALENDAR ─────────────────────────────────────────────────

export const getOutlookEvents = async (accessToken, startDate, endDate) => {
  const start = startDate || new Date().toISOString();
  const end   = endDate   || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const data  = await graphRequest(
    "GET",
    `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$top=100&$orderby=start/dateTime`,
    accessToken
  );
  return data.value.map(formatOutlookEvent);
};

export const createOutlookEvent = async (accessToken, eventData) => {
  const created = await graphRequest("POST", "/me/events", accessToken, toOutlookFormat(eventData));
  return formatOutlookEvent(created);
};

export const updateOutlookEvent = async (accessToken, outlookEventId, eventData) => {
  const updated = await graphRequest("PATCH", `/me/events/${outlookEventId}`, accessToken, toOutlookFormat(eventData));
  return formatOutlookEvent(updated);
};

// services/Microsoftgraphservice.js

export async function deleteOutlookEvent(accessToken, eventId) {
  if (!accessToken) throw new Error("Missing Outlook access token");
  if (!eventId) throw new Error("Missing eventId");

  try {
    await graphRequest(
      "DELETE",                     // ✅ method
      `/me/events/${eventId}`,      // ✅ endpoint
      accessToken                   // ✅ token
    );
    return { ok: true, deleted: true };
  } catch (err) {
    const status = err?.response?.status;

    // 404 = event مش موجود / مش ملك user / تم حذفه قبل
    if (status === 404) {
      console.warn("⚠️ Outlook event not found (ignore):", eventId);
      return { ok: true, deleted: false, reason: "NOT_FOUND" };
    }

    throw err;
  }
}
// ─── WEBHOOKS ─────────────────────────────────────────────────

export const createWebhookSubscription = async (accessToken) => {
  const expirationDateTime = new Date(Date.now() + 4230 * 60 * 1000);
  return await graphRequest("POST", "/subscriptions", accessToken, {
    changeType:         "created,updated,deleted",
    notificationUrl:    `${process.env.BACKEND_URL}/api/calendar/webhook`,
    resource:           "/me/events",
    expirationDateTime: expirationDateTime.toISOString(),
    clientState:        process.env.WEBHOOK_CLIENT_STATE,
  });
};

export const renewWebhookSubscription = async (accessToken, subscriptionId) => {
  const expirationDateTime = new Date(Date.now() + 4230 * 60 * 1000);
  return await graphRequest("PATCH", `/subscriptions/${subscriptionId}`, accessToken, {
    expirationDateTime: expirationDateTime.toISOString(),
  });
};

export const deleteWebhookSubscription = async (accessToken, subscriptionId) => {
  await graphRequest("DELETE", `/subscriptions/${subscriptionId}`, accessToken);
};


export { msalClient };
export default {
  getAuthUrl, getTokenFromCode, refreshAccessToken,
  getOutlookEvents, createOutlookEvent, updateOutlookEvent, deleteOutlookEvent,
  createWebhookSubscription, renewWebhookSubscription, deleteWebhookSubscription,
};