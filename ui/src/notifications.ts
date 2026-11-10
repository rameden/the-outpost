// Browser notifications: a ping when the camp needs you and this tab isn't in front.

import { storeGet, storeSet } from "./api.ts";

export const canNotify = () => typeof window !== "undefined" && "Notification" in window;
export const notificationsOn = () => canNotify() && Notification.permission === "granted" && storeGet("camp-notify") !== "off";

// The bell: ask the browser for permission the first time, then switch on and off.
export async function toggleNotifications() {
  if (!canNotify()) return;
  if (Notification.permission === "granted") storeSet("camp-notify", storeGet("camp-notify") === "off" ? "on" : "off");
  else if (Notification.permission !== "denied") { await Notification.requestPermission(); storeSet("camp-notify", "on"); }
}

export function notify(title: string, body: string) {
  if (!notificationsOn()) return;
  if (!document.hidden && document.hasFocus()) return;
  try {
    const n = new Notification(title, { body: String(body).slice(0, 220), tag: title });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* some browsers only allow notifications from a service worker */ }
}
