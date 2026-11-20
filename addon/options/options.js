"use strict";

const $ = id => document.getElementById(id);
let config = null;

const STATUS_TEXT = {
  draft: "Entwurf",
  sending: "wird gesendet",
  sent: "offen",
  confirming: "wird bestätigt",
  confirmed: "bestätigt",
  cancelled: "storniert",
  expired: "abgelaufen",
  withdrawn: "abgesagt",
};

/** Dialog „Termin absagen“ – liefert {reason, newProposals, mode} oder null */
function askWithdraw(p, slotText) {
  const dlg = $("withdrawDialog");
  $("wdInfo").textContent = `„${p.title}“ am ${slotText}${p.confirmed && p.confirmed.from ? " mit " + (p.confirmed.from.name || p.confirmed.from.email) : ""}`;
  $("wdReason").value = "";
  $("wdNew").checked = !!config.cancelNewProposals;
  for (const r of document.querySelectorAll("input[name=wdMode]")) {
    r.checked = r.value === (config.cancelSend || "draft");
  }
  return new Promise(resolve => {
    dlg.addEventListener(
      "close",
      () => {
        if (dlg.returnValue !== "ok") {
          resolve(null);
          return;
        }
        resolve({
          reason: $("wdReason").value.trim(),
          newProposals: $("wdNew").checked,
          mode: document.querySelector("input[name=wdMode]:checked").value,
        });
      },
      { once: true }
    );
    dlg.returnValue = "";
    dlg.showModal();
  });
}

async function call(type, data = {}) {
  const res = await browser.runtime.sendMessage(Object.assign({ type }, data));
  if (!res || !res.ok) {
    throw new Error((res && res.error) || "Unbekannter Fehler");
  }
  return res.result;
}

function flash(el, text, cls) {
  el.textContent = text;
  el.className = "status " + (cls || "");
  if (cls === "ok") {
    setTimeout(() => (el.textContent = ""), 2500);
  }
}

// ------------------------------------------------------------ Formular <-> Konfiguration
function fillForm() {
  for (const el of document.querySelectorAll("[data-key]")) {
    const v = config[el.dataset.key];
    if (el.type === "checkbox") {
      el.checked = !!v;
    } else {
      el.value = v == null ? "" : v;
    }
  }
  for (let d = 0; d < 7; d++) {
    $("wh" + d).value = config.workHours[d] || "";
  }
  updateVisibility();
  updatePreview();
}

function readForm() {
  const c = Object.assign({}, config);
  for (const el of document.querySelectorAll("[data-key]")) {
    const key = el.dataset.key;
    if (el.type === "checkbox") {
      c[key] = el.checked;
    } else if (el.type === "number") {
      c[key] = el.value === "" ? TV_DEFAULTS[key] : Number(el.value);
    } else {
      c[key] = el.value.trim ? el.value.trim() : el.value;
    }
  }
  c.workHours = {};
  for (let d = 0; d < 7; d++) {
    c.workHours[d] = $("wh" + d).value.trim();
  }
  c.busyCalendarIds = [...document.querySelectorAll("#busyCalendars input:checked")].map(i => i.value);
  return c;
}

function validate(c) {
  if (c.linkMode === "mailto" && !/\[TV-\{id\}-\{nr\}\]/.test(c.confirmSubject)) {
    return "Der Betreff der Bestätigungs-Mail muss [TV-{id}-{nr}] enthalten.";
  }
  for (let d = 0; d < 7; d++) {
    const v = c.workHours[d];
    if (v && !v.split(/[,;]/).every(p => /^\s*\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2}\s*$/.test(p))) {
      return `Zeitfenster für ${TV_WEEKDAYS[d]} ist ungültig: „${v}“`;
    }
  }
  return null;
}

function updateVisibility() {
  for (const el of document.querySelectorAll("[data-show]")) {
    const [key, val] = el.dataset.show.split("=");
    const input = document.querySelector(`[data-key="${key}"]`);
    el.hidden = !input || input.value !== val;
  }
}

function updatePreview() {
  const c = readForm();
  const start = new Date();
  start.setDate(start.getDate() + 3);
  start.setHours(10, 0, 0, 0);
  const slot = { start: start.getTime(), end: start.getTime() + c.durationMin * 60000 };
  $("preview").textContent = "Vorschau: • " + tvFormatSlot(slot, c.slotFormat) + " – " + c.linkText;
}

async function save() {
  const c = readForm();
  const err = validate(c);
  if (err) {
    flash($("saveStatus"), err, "err");
    return false;
  }
  config = c;
  await tvSaveConfig(c);
  flash($("saveStatus"), "Gespeichert", "ok");
  return true;
}

/** Host-Berechtigung muss synchron im Klick-Handler angefragt werden */
function requestOrigins() {
  const origins = tvVideoOrigins(readForm());
  if (!origins.length) {
    return Promise.resolve(true);
  }
  return browser.permissions.request({ origins });
}

// ------------------------------------------------------------ Kalender
async function loadCalendars() {
  const cals = await call("getCalendars");
  const box = $("busyCalendars");
  box.textContent = "";
  const sel = $("reserveCalendarId");
  sel.textContent = "";
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "(Standardkalender)";
  sel.append(auto);
  for (const c of cals) {
    const lab = document.createElement("label");
    lab.className = "inline";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = c.id;
    cb.checked = config.busyCalendarIds.includes(c.id);
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = c.color || "#888";
    lab.append(cb, sw, document.createTextNode(` ${c.name}${c.disabled ? " (deaktiviert)" : ""}${c.readOnly ? " (schreibgeschützt)" : ""}`));
    box.append(lab);
    if (!c.readOnly && !c.disabled && !c.subscribed) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      sel.append(o);
    }
  }
  sel.value = config.reserveCalendarId || "";
}

// ------------------------------------------------------------ Vorschläge
async function loadProposals() {
  const list = await call("listProposals");
  const tb = document.querySelector("#proposals tbody");
  tb.textContent = "";
  if (!list.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "hint";
    td.textContent = "Noch keine Terminvorschläge.";
    tr.append(td);
    tb.append(tr);
    return;
  }
  for (const p of list) {
    const tr = document.createElement("tr");
    tb.append(tr);
    const td = text => {
      const c = document.createElement("td");
      c.textContent = text;
      tr.append(c);
      return c;
    };
    td(new Date(p.created).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }));
    td(p.title);
    td(p.recipients.map(r => r.name || r.email).join(", ") || "–");
    const cell = td("");
    const ul = document.createElement("ul");
    for (const s of p.slots) {
      const li = document.createElement("li");
      li.textContent = `${s.nr}. ${s.text}`;
      if (p.confirmed && p.confirmed.nr === s.nr) {
        li.className = "chosen";
      } else if (s.deleted) {
        li.className = "gone";
      }
      ul.append(li);
    }
    cell.append(ul);
    const st = td(STATUS_TEXT[p.status] || p.status);
    if (p.confirmed && p.confirmed.videoUrl) {
      const a = document.createElement("a");
      a.href = p.confirmed.videoUrl;
      a.textContent = " Video";
      a.target = "_blank";
      st.append(a);
    }
    const act = td("");
    if (["draft", "sent"].includes(p.status)) {
      for (const s of p.slots.filter(x => !x.deleted)) {
        const b = document.createElement("button");
        b.textContent = `✓ ${s.nr}`;
        b.title = `Option ${s.nr} manuell bestätigen`;
        b.addEventListener("click", async () => {
          b.disabled = true;
          const r = await call("confirmManual", { id: p.id, nr: s.nr });
          if (!r.ok) {
            alert("Nicht möglich: " + r.error);
          }
          loadProposals();
        });
        act.append(b);
      }
      const c = document.createElement("button");
      c.className = "danger";
      c.textContent = "Stornieren";
      c.addEventListener("click", async () => {
        await call("cancelProposal", { id: p.id });
        loadProposals();
      });
      act.append(c);
    } else if (p.status === "confirmed") {
      const slot = p.slots.find(x => x.nr === p.confirmed.nr);
      const w = document.createElement("button");
      w.className = "danger";
      w.textContent = "Absagen";
      w.title = "Termin absagen, Kalender-Absage senden, optional neue Vorschläge";
      w.addEventListener("click", async () => {
        const opt = await askWithdraw(p, slot ? slot.text : "");
        if (!opt) {
          return;
        }
        w.disabled = true;
        try {
          await call("withdrawConfirmed", Object.assign({ id: p.id }, opt));
        } catch (e) {
          alert("Absage nicht möglich: " + e.message);
        }
        loadProposals();
      });
      act.append(w);
    } else {
      const d = document.createElement("button");
      d.className = "secondary";
      d.textContent = "Entfernen";
      d.addEventListener("click", async () => {
        await call("deleteProposal", { id: p.id });
        loadProposals();
      });
      act.append(d);
    }
  }
}

// ------------------------------------------------------------ Init
async function init() {
  config = await tvLoadConfig();
  const grid = $("workHours");
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    const span = document.createElement("span");
    span.textContent = TV_WEEKDAYS[d];
    const inp = document.createElement("input");
    inp.type = "text";
    inp.id = "wh" + d;
    inp.placeholder = "frei lassen = kein Termin";
    grid.append(span, inp);
  }
  try {
    $("redirectUrl").textContent = browser.identity.getRedirectURL();
  } catch (e) {
    $("redirectUrl").textContent = "(nicht verfügbar)";
  }
  fillForm();
  try {
    await loadCalendars();
  } catch (e) {
    $("busyCalendars").textContent = "Kalender konnten nicht gelesen werden: " + e.message;
  }
  await loadProposals();

  document.addEventListener("input", () => {
    updateVisibility();
    updatePreview();
  });
  $("save").addEventListener("click", () => {
    const perm = requestOrigins();
    perm.then(ok => {
      if (!ok) {
        flash($("saveStatus"), "Hinweis: Ohne Netzwerkberechtigung funktioniert der Videoanbieter nicht.", "err");
      }
      return save();
    });
  });
  $("testVideo").addEventListener("click", () => {
    const perm = requestOrigins();
    perm.then(async ok => {
      if (!ok) {
        flash($("videoStatus"), "Netzwerkberechtigung verweigert.", "err");
        return;
      }
      if (!(await save())) {
        return;
      }
      flash($("videoStatus"), "Erzeuge Testlink …");
      try {
        const r = await call("testVideo");
        $("videoStatus").className = "status ok";
        $("videoStatus").textContent = "";
        if (!r || !r.url) {
          $("videoStatus").textContent = "Kein Anbieter gewählt.";
          return;
        }
        const a = document.createElement("a");
        a.href = r.url;
        a.target = "_blank";
        a.textContent = r.url.length > 80 ? r.url.slice(0, 80) + "…" : r.url;
        $("videoStatus").append("OK: ", a);
      } catch (e) {
        flash($("videoStatus"), e.message, "err");
      }
    });
  });
  $("refresh").addEventListener("click", loadProposals);
  browser.storage.onChanged.addListener(changes => {
    if (changes.proposals) {
      loadProposals();
    }
  });
}

init().catch(e => flash($("saveStatus"), e.message, "err"));
