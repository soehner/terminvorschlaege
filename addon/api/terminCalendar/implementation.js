/* Experiment-API: Zugriff auf den internen Thunderbird-Kalender.
 * Thunderbird bietet (Stand 160) keine offizielle WebExtension-Kalender-API,
 * daher wird hier direkt auf cal.manager zugegriffen.
 */
"use strict";

/* global ChromeUtils, Ci, Services */

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
var { CalEvent } = ChromeUtils.importESModule("resource:///modules/CalEvent.sys.mjs");
var { CalAttendee } = ChromeUtils.importESModule("resource:///modules/CalAttendee.sys.mjs");

const MARKER_PROP = "X-TERMINVORSCHLAG-ID";

function toCalDate(ms) {
  return cal.dtz.jsDateToDateTime(new Date(ms), cal.dtz.defaultTimezone);
}

function toMs(dt) {
  return cal.dtz.dateTimeToJsDate(dt).getTime();
}

function getCalendar(id) {
  const calendar = cal.manager.getCalendarById(id);
  if (!calendar) {
    throw new ExtensionCommon.ExtensionError(`Kalender ${id} nicht gefunden`);
  }
  return calendar;
}

function makeAttendee(email, name, isOrganizer) {
  const att = new CalAttendee();
  att.id = email.startsWith("mailto:") ? email : "mailto:" + email;
  if (name) {
    att.commonName = name;
  }
  if (isOrganizer) {
    att.isOrganizer = true;
    att.role = "CHAIR";
    att.participationStatus = "ACCEPTED";
  } else {
    att.role = "REQ-PARTICIPANT";
    att.participationStatus = "NEEDS-ACTION";
    att.rsvp = "FALSE";
  }
  return att;
}

function applyData(item, data) {
  if (data.title !== undefined) {
    item.title = data.title;
  }
  if (data.start !== undefined) {
    item.startDate = toCalDate(data.start);
  }
  if (data.end !== undefined) {
    item.endDate = toCalDate(data.end);
  }
  const props = {
    description: "DESCRIPTION",
    location: "LOCATION",
    status: "STATUS",
    transparency: "TRANSP",
    url: "URL",
  };
  for (const [key, prop] of Object.entries(props)) {
    if (data[key] !== undefined) {
      if (data[key] === null || data[key] === "") {
        item.deleteProperty(prop);
      } else {
        item.setProperty(prop, data[key]);
      }
    }
  }
  if (Array.isArray(data.categories)) {
    item.setCategories(data.categories);
  }
  if (data.marker !== undefined) {
    if (data.marker) {
      item.setProperty(MARKER_PROP, data.marker);
    } else {
      item.deleteProperty(MARKER_PROP);
    }
  }
  if (data.organizer && data.organizer.email) {
    item.organizer = makeAttendee(data.organizer.email, data.organizer.name, true);
  }
  if (Array.isArray(data.attendees)) {
    item.removeAllAttendees();
    for (const a of data.attendees) {
      if (a && a.email) {
        item.addAttendee(makeAttendee(a.email, a.name, false));
      }
    }
  }
}

function eventInfo(item) {
  return {
    id: item.id,
    calendarId: item.calendar ? item.calendar.id : null,
    title: item.title || "",
    start: item.startDate ? toMs(item.startDate) : null,
    end: item.endDate ? toMs(item.endDate) : null,
    categories: item.getCategories ? item.getCategories() : [],
  };
}

this.terminCalendar = class extends ExtensionCommon.ExtensionAPIPersistent {
  PERSISTENT_EVENTS = {
    // Wird auch ausgelöst, wenn der Hintergrund des Add-ons gerade ruht (fire.wakeup)
    onItemDeleted({ fire }) {
      const observer = {
        QueryInterface: ChromeUtils.generateQI(["calIObserver"]),
        onStartBatch() {},
        onEndBatch() {},
        onLoad() {},
        onAddItem() {},
        onModifyItem() {},
        onError() {},
        onPropertyChanged() {},
        onPropertyDeleting() {},
        async onDeleteItem(item) {
          try {
            if (!item || !item.isEvent || !item.isEvent() || item.recurrenceId) {
              return;
            }
            const info = eventInfo(item);
            if (fire.wakeup) {
              await fire.wakeup();
            }
            fire.async(info);
          } catch (e) {
            console.error("Terminvorschläge: onItemDeleted", e);
          }
        },
      };
      cal.manager.addCalendarObserver(observer);
      return {
        unregister: () => cal.manager.removeCalendarObserver(observer),
        convert(newFire) {
          fire = newFire;
        },
      };
    },
  };

  getAPI(context) {
    return {
      terminCalendar: {
        onItemDeleted: new ExtensionCommon.EventManager({
          context,
          module: "terminCalendar",
          event: "onItemDeleted",
          extensionApi: this,
        }).api(),

        async findEvent(eventId) {
          for (const calendar of cal.manager.getCalendars()) {
            if (calendar.getProperty("disabled")) {
              continue;
            }
            try {
              const item = await calendar.getItem(eventId);
              if (item) {
                return eventInfo(item);
              }
            } catch (e) {
              // Kalender nicht erreichbar -> ignorieren
            }
          }
          return null;
        },

        async getCalendars() {
          return cal.manager.getCalendars().map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            readOnly: !!c.readOnly,
            disabled: !!c.getProperty("disabled"),
            color: c.getProperty("color") || null,
            isDefault: !!c.getProperty("calendar-main-default"),
            // abonnierte Internet-Kalender (ICS per http) sind faktisch nicht beschreibbar
            subscribed: c.type == "ics" && /^(https?|webcals?):/i.test((c.uri && c.uri.spec) || ""),
          }));
        },

        async getBusy(query) {
          const filter =
            Ci.calICalendar.ITEM_FILTER_TYPE_EVENT | Ci.calICalendar.ITEM_FILTER_CLASS_OCCURRENCES;
          const rangeStart = toCalDate(query.start);
          const rangeEnd = toCalDate(query.end);
          const busy = [];
          for (const id of query.calendarIds || []) {
            const calendar = cal.manager.getCalendarById(id);
            if (!calendar || calendar.getProperty("disabled")) {
              continue;
            }
            let items;
            try {
              items = await calendar.getItemsAsArray(filter, 0, rangeStart, rangeEnd);
            } catch (e) {
              console.error("Terminvorschläge: Kalender nicht lesbar", calendar.name, e);
              continue;
            }
            for (const item of items) {
              const own = !!item.getProperty(MARKER_PROP);
              if (!own) {
                if (item.getProperty("TRANSP") == "TRANSPARENT") {
                  continue;
                }
                const status = item.getProperty("STATUS");
                if (status == "CANCELLED") {
                  continue;
                }
                if (status == "TENTATIVE" && query.tentativeBusy === false) {
                  continue;
                }
                if (item.startDate && item.startDate.isDate && !query.allDayBusy) {
                  continue;
                }
                if (query.ignoreDeclined !== false) {
                  try {
                    const att = cal.itip.getInvitedAttendee(item, calendar);
                    if (att && att.participationStatus == "DECLINED") {
                      continue;
                    }
                  } catch (e) {
                    // ignorieren
                  }
                }
              }
              const start = item.startDate || item.entryDate;
              const end = item.endDate || item.dueDate || start;
              if (!start) {
                continue;
              }
              busy.push({
                start: toMs(start),
                end: toMs(end),
                title: item.title || "",
                own,
              });
            }
          }
          busy.sort((a, b) => a.start - b.start);
          return busy;
        },

        async createEvent(calendarId, data) {
          const calendar = getCalendar(calendarId);
          const item = new CalEvent();
          item.id = Services.uuid.generateUUID().toString().slice(1, -1);
          applyData(item, data);
          const added = await calendar.addItem(item);
          return (added && added.id) || item.id;
        },

        async updateEvent(calendarId, eventId, data) {
          const calendar = getCalendar(calendarId);
          const oldItem = await calendar.getItem(eventId);
          if (!oldItem) {
            return false;
          }
          const newItem = oldItem.clone();
          applyData(newItem, data);
          await calendar.modifyItem(newItem, oldItem);
          return true;
        },

        async deleteEvent(calendarId, eventId) {
          const calendar = cal.manager.getCalendarById(calendarId);
          if (!calendar) {
            return false;
          }
          const item = await calendar.getItem(eventId);
          if (!item) {
            return false;
          }
          await calendar.deleteItem(item);
          return true;
        },

        async getEvent(calendarId, eventId) {
          const calendar = cal.manager.getCalendarById(calendarId);
          if (!calendar) {
            return null;
          }
          const item = await calendar.getItem(eventId);
          if (!item) {
            return null;
          }
          return {
            id: item.id,
            title: item.title,
            start: toMs(item.startDate),
            end: toMs(item.endDate),
            status: item.getProperty("STATUS") || null,
            location: item.getProperty("LOCATION") || null,
          };
        },
      },
    };
  }
};
