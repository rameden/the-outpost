// Who can reach mission control, and from where.
//
// By default: this machine only. The server listens on 127.0.0.1 and answers only requests
// addressed to 127.0.0.1 or localhost.
//
// LAN mode (CAMP_LAN=1, in .env or the environment the camp starts with) is for a camp that
// lives on one machine at home and is used from your others. The server then listens on every
// network interface and also answers to this machine's own names and addresses on the network.
// It is meant for a network you trust:
//
//   - It's plain HTTP. The key travels with every request, unencrypted: anyone who can watch
//     the network's traffic could take it. Fine behind a home router; not for an office, a
//     shared flat's Wi-Fi, or anything reachable from the internet. Never forward the port.
//   - The terminal pane works only on the camp's own machine. It's a shell on that machine, and
//     a stolen key shouldn't be one: requests for it from anywhere else are refused.
//   - The "choose a folder" dialog opens on the camp's machine, where you may not be sitting:
//     from another machine you paste the folder's path instead.
//   - Signing in still takes a one-time link. The camp's terminal prints one, and a browser
//     that's already signed in can make one for another device (it lasts ten minutes).
//
// The names it answers to still matter: a request addressed to any other name is refused, which
// is what stops a web page elsewhere from pointing its own name at this machine (DNS rebinding).
//
//   CAMP_LAN=1               turn it on
//   CAMP_HOST=192.168.1.20   listen on this one address instead of all of them
//   CAMP_NAMES=camp.home     more names this machine is reached by, comma-separated
//
// Through a proxy on this machine (Tailscale Serve, say): the camp stays on 127.0.0.1, and the
// proxy hands it requests addressed to the proxy's own HTTPS name, with no port. Those names go in
//
//   CAMP_PROXY_NAMES=mac.tail1234.ts.net
//
// (or mac.tail1234.ts.net:4748 when the proxy serves this camp on a port of its own, as Tailscale
// Serve does for every outpost but Mae: then only that name with that port is answered),
// and need no LAN mode. Only something on this machine can deliver them, and what it delivers
// carries the proxy's forwarding headers, so it never counts as local (see relayed below).
//
// Everything here takes its inputs as arguments, so it can be tested without a network. No
// imports from the rest of the camp.

import type { NetworkInterfaceInfo } from "node:os";

type Env = Record<string, string | undefined>;
export type Access = {
  lan: boolean;
  listen: string;     // the address the server binds
  names: string[];    // what this machine is reached by, besides 127.0.0.1 and localhost (first: the one to show)
  proxied: string[];  // HTTPS names a proxy on this machine passes on to the camp (no port, or :443), or name:port
};

const clean = (name: string) => name.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[:/].*$/, "");
const NAME = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/; // a host name or an IPv4 address
// A proxy's name, keeping a port other than 443 (a port is part of where the proxy serves it).
const proxyName = (raw: string) => {
  const m = /^([^:/]*)(?::(\d{1,5}))?(?:\/.*)?$/.exec(raw.trim().toLowerCase().replace(/^https?:\/\//, ""));
  if (!m || !NAME.test(m[1]) || m[1] === "localhost" || m[1] === "127.0.0.1") return "";
  const port = Number(m[2] ?? 443);
  return port === 443 ? m[1] : port > 0 && port < 65536 ? `${m[1]}:${port}` : "";
};

export function accessFrom(env: Env, hostname: string, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): Access {
  const on = /^(1|true|yes|on)$/i.test(env.CAMP_LAN?.trim() ?? "");
  const proxied = [...new Set((env.CAMP_PROXY_NAMES ?? "").split(",").map(proxyName).filter(Boolean))];
  if (!on) return { lan: false, listen: "127.0.0.1", names: [], proxied };
  const listen = env.CAMP_HOST?.trim() || "0.0.0.0";
  const addresses = Object.values(interfaces).flatMap((list) => (list ?? []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => i.address));
  const host = clean(hostname);
  const names = [
    ...(env.CAMP_NAMES ?? "").split(",").map(clean),                 // yours first: they're the ones you chose to use
    ...(host && host !== "localhost" ? [host, ...(host.includes(".") ? [] : [`${host}.local`])] : []),
    ...(listen !== "0.0.0.0" ? [clean(listen)] : []),
    ...addresses,
  ].filter((n) => NAME.test(n) && n !== "localhost" && n !== "127.0.0.1");
  return { lan: true, listen, names: [...new Set(names)], proxied };
}

// Is this request addressed to a name the camp answers to? (The Host header, with the port.)
export function hostAllowed(host: string | undefined, port: number, access: Access): boolean {
  const h = (host ?? "").toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}` || access.names.some((n) => h === `${n}:${port}`)
    || access.proxied.some((n) => h === n || h === `${n}:443`);
}

// Did the connection come from this machine itself?
export function isLocal(remoteAddress: string | undefined): boolean {
  const a = (remoteAddress ?? "").toLowerCase();
  return a === "::1" || a.startsWith("127.") || a.startsWith("::ffff:127.");
}

// Did a proxy on this machine pass the request on from somewhere else? A Cloudflare Tunnel (or
// any reverse proxy) connects from 127.0.0.1, so the connection alone would call a visitor from
// the internet local. These headers mark a relayed request. A header can only ever take "local"
// away here, never grant it, so a forged one costs the sender, not the camp.
const RELAY_HEADERS = ["cf-connecting-ip", "cf-ray", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "forwarded"];
export function relayed(headers: Record<string, string | string[] | undefined>): boolean {
  return RELAY_HEADERS.some((h) => headers[h] !== undefined);
}

// Where to open it, for the terminal and the page: the address to use from another machine.
export const addressOf = (name: string, port: number) => `http://${name}:${port}/`;
