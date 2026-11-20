"use strict";

const $ = id => document.getElementById(id);
let tabId = null;
let slots = []; // {start,end,text,on}
const excluded = new Set();

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

function render() {
  const ul = $("slots");
  ul.textContent = "";
  slots.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = s.on ? "" : "off";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = s.on;
    cb.id = "s" + i;
    cb.addEventListener("change", () => {
      s.on = cb.checked;
      render();
    });
    const lab = document.createElement("label");
    lab.className = "inline";
    lab.htmlFor = cb.id;
    lab.textContent = s.text;
    li.append(cb, lab);
    ul.append(li);
  });
  const n = slots.filter(s => s.on).length;
  $("apply").disabled = n === 0;
  $("apply").textContent = n ? `${n} reservieren & einfügen` : "Reservieren & einfügen";
}

function params() {
  return {
    count: parseInt($("count").value, 10) || 3,
    durationMin: parseInt($("duration").value, 10) || 60,
    horizonDays: parseInt($("horizon").value, 10) || 14,
    from: $("from").value ? new Date($("from").value + "T00:00:00").getTime() : null,
  };
}

async function compute(keepChecked) {
  setStatus("Suche freie Zeiten …");
  try {
    let keep = [];
    if (keepChecked) {
      slots.filter(s => !s.on).forEach(s => excluded.add(s.start));
      keep = slots.filter(s => s.on).map(s => ({ start: s.start, end: s.end }));
    } else {
      excluded.clear();
    }
    const res = await call("computeSlots", Object.assign(params(), { keep, exclude: [...excluded] }));
    slots = res.slots.map(s => Object.assign(s, { on: true }));
    render();
    const want = params().count;
    if (!slots.length) {
      setStatus("Keine freien Zeiten im gewählten Zeitraum gefunden.", "err");
    } else if (slots.length < want) {
      setStatus(`Nur ${slots.length} von ${want} Vorschlägen möglich – Zeitraum vergrößern?`, "err");
    } else {
      setStatus(`${res.available} freie Zeitfenster gefunden.`);
    }
  } catch (e) {
    setStatus(e.message, "err");
  }
}

async function apply() {
  const chosen = slots.filter(s => s.on).map(s => ({ start: s.start, end: s.end }));
  $("apply").disabled = true;
  setStatus("Reserviere im Kalender …");
  try {
    const r = await call("applyProposal", {
      tabId,
      slots: chosen,
      title: $("title").value.trim(),
      calendarId: $("calendar").value || null,
    });
    setStatus(`${r.count} Termine reserviert und eingefügt.`, "ok");
    setTimeout(() => window.close(), 700);
  } catch (e) {
    setStatus(e.message, "err");
    $("apply").disabled = false;
  }
}

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;
  const ctx = await call("getContext", { tabId });
  const c = ctx.config;
  $("count").value = c.defaultCount;
  $("duration").value = c.durationMin;
  $("horizon").value = c.horizonDays;
  $("title").value = ctx.subject;
  const sel = $("calendar");
  for (const c of ctx.calendars) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name + (c.isDefault ? " (Standard)" : "");
    sel.append(o);
  }
  if (ctx.defaultCalendarId) {
    sel.value = ctx.defaultCalendarId;
  }
  for (const id of ["count", "duration", "horizon", "from"]) {
    $(id).addEventListener("change", () => compute(false));
  }
  $("recalc").addEventListener("click", () => compute(true));
  $("apply").addEventListener("click", apply);
  $("openOptions").addEventListener("click", e => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });
  await compute(false);
}

init().catch(e => setStatus(e.message, "err"));
