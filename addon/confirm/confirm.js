"use strict";

const $ = id => document.getElementById(id);

async function call(type, data = {}) {
  const res = await browser.runtime.sendMessage(Object.assign({ type }, data));
  if (!res || !res.ok) {
    throw new Error((res && res.error) || "Unbekannter Fehler");
  }
  return res.result;
}

function setStatus(text, cls = "") {
  $("status").textContent = text;
  $("status").className = "status " + cls;
}

const STATUS_TEXT = {
  draft: "Entwurf",
  sending: "wird gesendet",
  sent: "offen",
  confirming: "wird bestätigt …",
  confirmed: "bestätigt",
  cancelled: "storniert",
  expired: "abgelaufen",
  withdrawn: "abgesagt",
};

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const data = await call("matchDisplayed", { tabId: tab.id });
  if (!data || !data.proposal) {
    $("info").textContent = "Diese E-Mail gehört zu keinem offenen Terminvorschlag.";
    $("cancel").hidden = true;
    $("confirm").hidden = true;
    return;
  }
  const p = data.proposal;
  const msg = data.message;
  $("info").textContent = `„${p.title}“ · Status: ${STATUS_TEXT[p.status] || p.status} · Absender: ${msg.author}`;
  const open = ["draft", "sending", "sent"].includes(p.status);
  const ul = $("slots");
  for (const s of p.slots) {
    const li = document.createElement("li");
    const lab = document.createElement("label");
    lab.className = "inline";
    const r = document.createElement("input");
    r.type = "radio";
    r.name = "slot";
    r.value = s.nr;
    r.disabled = !open || s.deleted;
    if (data.match.nr === s.nr || (p.confirmed && p.confirmed.nr === s.nr)) {
      r.checked = true;
    }
    r.addEventListener("change", () => ($("confirm").disabled = false));
    lab.append(r, document.createTextNode(`${s.nr}. ${s.text}`));
    if (s.deleted && !(p.confirmed && p.confirmed.nr === s.nr)) {
      li.className = "gone";
    }
    li.append(lab);
    ul.append(li);
  }
  $("confirm").disabled = !open || !document.querySelector("input[name=slot]:checked");

  if (p.status === "confirmed") {
    $("title").textContent = "Termin bestätigt";
    const c = p.confirmed || {};
    const cs = p.slots.find(s => s.nr === c.nr);
    $("doneSlot").textContent = cs ? `${cs.nr}. ${cs.text}` : "";
    const meta = [];
    if (c.at) {
      const d = new Date(c.at);
      meta.push(`Bestätigt am ${d.toLocaleDateString("de-DE")} um ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`);
    }
    if (c.from && c.from.email) {
      meta.push(`von ${c.from.email}`);
    }
    if (c.icsSent !== undefined) {
      meta.push(c.videoUrl ? "Bestätigungsmail mit Videolink versendet" : "Bestätigungsmail ohne Videolink versendet");
    } else if (c.videoUrl) {
      meta.push("Videolink erzeugt");
    }
    $("doneMeta").textContent = meta.join(" · ");
    $("done").hidden = false;
    $("confirm").hidden = true;
    $("cancel").hidden = true;
    if (cs && cs.end < Date.now()) {
      $("title").textContent = "Termin hat stattgefunden";
      return;
    }
    $("withdraw").hidden = false;
    const cfgRes = await browser.storage.local.get("config");
    $("wdNew").checked = !(cfgRes.config && cfgRes.config.cancelNewProposals === false);
    $("wdBtn").addEventListener("click", async () => {
      $("wdBtn").disabled = true;
      setStatus("Sage Termin ab …");
      try {
        await call("withdrawConfirmed", { id: p.id, reason: $("wdReason").value.trim(), newProposals: $("wdNew").checked });
        setStatus("Termin abgesagt.", "ok");
        setTimeout(() => window.close(), 900);
      } catch (e) {
        setStatus(e.message, "err");
        $("wdBtn").disabled = false;
      }
    });
  }
  $("cancel").disabled = !open;

  $("confirm").addEventListener("click", async () => {
    const nr = parseInt(document.querySelector("input[name=slot]:checked").value, 10);
    $("confirm").disabled = true;
    setStatus("Bestätige …");
    const r = await call("confirmManual", { id: p.id, nr, messageId: msg.id, author: msg.author });
    if (r.ok) {
      setStatus("Termin bestätigt.", "ok");
      setTimeout(() => window.close(), 900);
    } else {
      setStatus("Nicht möglich: " + r.error, "err");
    }
  });
  $("cancel").addEventListener("click", async () => {
    await call("cancelProposal", { id: p.id });
    setStatus("Alle Reservierungen gelöscht.", "ok");
    $("cancel").disabled = true;
    $("confirm").disabled = true;
  });
}

init().catch(e => setStatus(e.message, "err"));
