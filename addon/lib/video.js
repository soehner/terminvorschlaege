/* Erzeugung von Videokonferenz-Links für verschiedene Anbieter */
"use strict";

async function tvHash(algo, text) {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}

function tvQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function tvOriginOf(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
  } catch (e) {
    return null;
  }
}

/** Host-Berechtigungen, die der gewählte Anbieter benötigt */
function tvVideoOrigins(cfg) {
  switch (cfg.videoProvider) {
    case "bbb":
      return [tvOriginOf(cfg.bbbUrl)].filter(Boolean);
    case "teams":
      return ["https://login.microsoftonline.com/*", "https://graph.microsoft.com/*"];
    case "zoom":
      return ["https://zoom.us/*", "https://api.zoom.us/*"];
    case "webhook":
      return [tvOriginOf(cfg.webhookUrl)].filter(Boolean);
    default:
      return [];
  }
}

// ---------------------------------------------------------------- BigBlueButton
function tvBbbBase(cfg) {
  let base = String(cfg.bbbUrl || "").trim();
  if (!base) {
    throw new Error("BigBlueButton-URL fehlt in den Einstellungen.");
  }
  if (!/\/api\/?$/.test(base)) {
    base = base.replace(/\/?$/, "/") + (base.includes("/bigbluebutton") ? "" : "bigbluebutton/") + "api/";
  }
  return base.replace(/\/?$/, "/");
}

async function tvBbbUrl(cfg, call, params) {
  const q = tvQuery(params);
  const checksum = await tvHash("SHA-1", call + q + cfg.bbbSecret);
  return `${tvBbbBase(cfg)}${call}?${q}&checksum=${checksum}`;
}

/** Meeting anlegen (idempotent – gleiche meetingID liefert das bestehende Meeting) */
async function tvBbbCreate(cfg, data) {
  const minutesUntilEnd = Math.max(10, Math.round((data.end - Date.now()) / 60000) + 30);
  const url = await tvBbbUrl(cfg, "create", {
    name: data.title,
    meetingID: data.meetingId,
    attendeePW: data.attendeePW,
    moderatorPW: data.moderatorPW,
    record: "false",
    welcome: data.title,
    meetingExpireIfNoUserJoinedInMinutes: String(minutesUntilEnd),
  });
  const res = await fetch(url);
  const xml = await res.text();
  if (!/<returncode>SUCCESS<\/returncode>/.test(xml)) {
    const msg = (xml.match(/<message>([^<]*)<\/message>/) || [])[1] || res.status;
    throw new Error("BigBlueButton: " + msg);
  }
}

async function tvBbbMeeting(cfg, data) {
  const meetingId = "tv-" + tvRandomId(12);
  const attendeePW = tvRandomId(10);
  const moderatorPW = tvRandomId(10);
  const d = Object.assign({}, data, { meetingId, attendeePW, moderatorPW });
  await tvBbbCreate(cfg, d);
  const guestName = (data.attendees[0] && (data.attendees[0].name || data.attendees[0].email)) || "Gast";
  const url = await tvBbbUrl(cfg, "join", {
    fullName: guestName,
    meetingID: meetingId,
    password: attendeePW,
    role: "VIEWER",
    redirect: "true",
  });
  const moderatorUrl = await tvBbbUrl(cfg, "join", {
    fullName: cfg.bbbModeratorName || (data.organizer && data.organizer.name) || "Moderation",
    meetingID: meetingId,
    password: moderatorPW,
    role: "MODERATOR",
    redirect: "true",
  });
  return {
    url,
    moderatorUrl,
    // wird kurz vor Beginn erneut angelegt, falls das Meeting zwischenzeitlich verfallen ist
    recreate: { provider: "bbb", title: data.title, end: data.end, meetingId, attendeePW, moderatorPW },
  };
}

// ---------------------------------------------------------------- Microsoft Teams (Graph)
async function tvTeamsToken(cfg, interactive) {
  const { teamsToken } = await browser.storage.local.get("teamsToken");
  if (teamsToken && teamsToken.expires > Date.now() + 120000 && teamsToken.clientId == cfg.teamsClientId) {
    return teamsToken.token;
  }
  if (!cfg.teamsClientId) {
    throw new Error("Teams: Client-ID (Azure App-Registrierung) fehlt in den Einstellungen.");
  }
  const redirect = browser.identity.getRedirectURL();
  const state = tvRandomId(16);
  const auth =
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.teamsTenant || "common")}/oauth2/v2.0/authorize?` +
    tvQuery({
      client_id: cfg.teamsClientId,
      response_type: "token",
      redirect_uri: redirect,
      scope: "https://graph.microsoft.com/OnlineMeetings.ReadWrite",
      response_mode: "fragment",
      state,
      nonce: tvRandomId(16),
      prompt: interactive ? "select_account" : "none",
    });
  const result = await browser.identity.launchWebAuthFlow({ url: auth, interactive });
  const params = new URLSearchParams(new URL(result).hash.slice(1));
  if (params.get("error")) {
    throw new Error("Teams-Anmeldung: " + (params.get("error_description") || params.get("error")));
  }
  if (params.get("state") !== state || !params.get("access_token")) {
    throw new Error("Teams-Anmeldung fehlgeschlagen.");
  }
  const token = params.get("access_token");
  const expires = Date.now() + (parseInt(params.get("expires_in"), 10) || 3600) * 1000;
  await browser.storage.local.set({ teamsToken: { token, expires, clientId: cfg.teamsClientId } });
  return token;
}

async function tvTeamsMeeting(cfg, data) {
  let token;
  try {
    token = await tvTeamsToken(cfg, false);
  } catch (e) {
    token = await tvTeamsToken(cfg, true);
  }
  const res = await fetch("https://graph.microsoft.com/v1.0/me/onlineMeetings", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: data.title,
      startDateTime: new Date(data.start).toISOString(),
      endDateTime: new Date(data.end).toISOString(),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status == 401) {
      await browser.storage.local.remove("teamsToken");
    }
    throw new Error("Teams: " + ((json.error && json.error.message) || res.status));
  }
  return { url: json.joinWebUrl || json.joinUrl };
}

// ---------------------------------------------------------------- Zoom (Server-to-Server OAuth)
async function tvZoomMeeting(cfg, data) {
  if (!cfg.zoomAccountId || !cfg.zoomClientId || !cfg.zoomClientSecret) {
    throw new Error("Zoom: Account-ID, Client-ID und Client-Secret erforderlich.");
  }
  const tokRes = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(cfg.zoomAccountId)}`,
    { method: "POST", headers: { Authorization: "Basic " + btoa(cfg.zoomClientId + ":" + cfg.zoomClientSecret) } }
  );
  const tok = await tokRes.json().catch(() => ({}));
  if (!tokRes.ok || !tok.access_token) {
    throw new Error("Zoom-Anmeldung: " + (tok.reason || tok.error || tokRes.status));
  }
  const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: "Bearer " + tok.access_token, "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: data.title,
      type: 2,
      start_time: new Date(data.start).toISOString().replace(/\.\d{3}Z$/, "Z"),
      duration: Math.round((data.end - data.start) / 60000),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      settings: { waiting_room: true, join_before_host: false },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error("Zoom: " + (json.message || res.status));
  }
  return { url: json.join_url, moderatorUrl: json.start_url, info: json.password ? `Kenncode: ${json.password}` : "" };
}

// ---------------------------------------------------------------- Webhook (n8n, Power Automate, eigener Server …)
async function tvWebhookMeeting(cfg, data) {
  if (!cfg.webhookUrl) {
    throw new Error("Webhook-URL fehlt.");
  }
  const headers = { "Content-Type": "application/json" };
  if (cfg.webhookAuthHeader) {
    const i = cfg.webhookAuthHeader.indexOf(":");
    if (i > 0) {
      headers[cfg.webhookAuthHeader.slice(0, i).trim()] = cfg.webhookAuthHeader.slice(i + 1).trim();
    }
  }
  const res = await fetch(cfg.webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: data.title,
      start: new Date(data.start).toISOString(),
      end: new Date(data.end).toISOString(),
      durationMin: Math.round((data.end - data.start) / 60000),
      organizer: data.organizer,
      attendees: data.attendees,
      proposalId: data.proposalId,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error("Webhook: HTTP " + res.status);
  }
  try {
    const json = JSON.parse(text);
    return { url: json.url || json.joinUrl, moderatorUrl: json.moderatorUrl, info: json.info || "" };
  } catch (e) {
    return { url: text.trim() };
  }
}

/**
 * @param {object} cfg Konfiguration
 * @param {object} data {title, start, end, organizer, attendees, proposalId}
 * @returns {Promise<null|{url, moderatorUrl?, info?, recreate?}>}
 */
async function tvCreateVideoMeeting(cfg, data) {
  switch (cfg.videoProvider) {
    case "static":
      return cfg.videoStaticUrl ? { url: cfg.videoStaticUrl } : null;
    case "jitsi": {
      const slug = (cfg.jitsiPrefix || "Termin").replace(/[^A-Za-z0-9]/g, "") + "-" + tvRandomId(12);
      return { url: String(cfg.jitsiBaseUrl || "https://meet.jit.si/").replace(/\/?$/, "/") + slug };
    }
    case "bbb":
      return tvBbbMeeting(cfg, data);
    case "teams":
      return tvTeamsMeeting(cfg, data);
    case "zoom":
      return tvZoomMeeting(cfg, data);
    case "webhook":
      return tvWebhookMeeting(cfg, data);
    default:
      return null;
  }
}
