// Who can reach mission control: this machine only, or (LAN mode) your other machines at home.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accessFrom, addressOf, hostAllowed, isLocal, relayed } from "../src/access.ts";

const nics = {
  lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }, { address: "::1", family: "IPv6", internal: true }],
  en0: [{ address: "192.168.1.20", family: "IPv4", internal: false }, { address: "fe80::1", family: "IPv6", internal: false }],
  eth1: [{ address: "10.0.0.7", family: "IPv4", internal: false }],
} as any;

test("by default the camp is this machine's alone", () => {
  for (const env of [{}, { CAMP_LAN: "" }, { CAMP_LAN: "0" }, { CAMP_LAN: "no" }, { CAMP_HOST: "0.0.0.0" }, { CAMP_NAMES: "winbox" }]) {
    assert.deepEqual(accessFrom(env, "winbox", nics), { lan: false, listen: "127.0.0.1", names: [], proxied: [] }, JSON.stringify(env));
  }
  const here = accessFrom({}, "winbox", nics);
  assert.equal(hostAllowed("127.0.0.1:4747", 4747, here), true);
  assert.equal(hostAllowed("localhost:4747", 4747, here), true);
  for (const host of ["winbox:4747", "192.168.1.20:4747", "evil.example:4747", "127.0.0.1:9999", "127.0.0.1", undefined]) assert.equal(hostAllowed(host, 4747, here), false, String(host));
});

test("LAN mode: every interface, answering to this machine's own name and addresses and no others", () => {
  const lan = accessFrom({ CAMP_LAN: "1" }, "WinBox", nics);
  assert.equal(lan.lan, true);
  assert.equal(lan.listen, "0.0.0.0");
  assert.deepEqual(lan.names, ["winbox", "winbox.local", "192.168.1.20", "10.0.0.7"]);
  for (const host of ["winbox:4747", "WINBOX:4747", "winbox.local:4747", "192.168.1.20:4747", "10.0.0.7:4747", "127.0.0.1:4747", "localhost:4747"]) assert.equal(hostAllowed(host, 4747, lan), true, host);
  // A page elsewhere that points its own name at this machine is still refused, as is any other port or name.
  for (const host of ["evil.example:4747", "192.168.1.21:4747", "winbox:80", "winbox", "winbox.evil.example:4747", "0.0.0.0:4747", ""]) assert.equal(hostAllowed(host, 4747, lan), false, host);
  assert.equal(addressOf(lan.names[0], 4747), "http://winbox:4747/");
});

test("your own names come first, one address can be chosen, and odd input is dropped", () => {
  const lan = accessFrom({ CAMP_LAN: "true", CAMP_NAMES: " camp.home , http://Den-PC:4747/ , bad name!, ,localhost", CAMP_HOST: "192.168.1.20" }, "winbox.lan", nics);
  assert.equal(lan.listen, "192.168.1.20");
  assert.deepEqual(lan.names, ["camp.home", "den-pc", "winbox.lan", "192.168.1.20", "10.0.0.7"]);
  // No network just now: it still starts, reachable only by the names you gave (or none).
  assert.deepEqual(accessFrom({ CAMP_LAN: "1" }, "localhost", { lo0: nics.lo0 }).names, []);
});

test("whether a connection came from the camp's own machine", () => {
  for (const a of ["127.0.0.1", "127.0.0.53", "::1", "::ffff:127.0.0.1"]) assert.equal(isLocal(a), true, a);
  for (const a of ["192.168.1.30", "::ffff:192.168.1.30", "10.0.0.2", "fe80::1", "", undefined]) assert.equal(isLocal(a), false, String(a));
});

test("a request a proxy passed on is not from this machine, whatever the connection says", () => {
  for (const h of ["cf-connecting-ip", "cf-ray", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "forwarded"]) {
    assert.equal(relayed({ host: "127.0.0.1:4747", [h]: "203.0.113.9" }), true, h);
  }
  assert.equal(relayed({ host: "127.0.0.1:4747", "user-agent": "x" }), false);
  assert.equal(relayed({}), false);
});

test("a proxy's HTTPS name is answered without LAN mode, and only as that name", () => {
  const a = accessFrom({ CAMP_PROXY_NAMES: " Mac.tail1234.ts.net , https://mac.tail1234.ts.net/, bad name!, localhost" }, "winbox", nics);
  assert.deepEqual(a, { lan: false, listen: "127.0.0.1", names: [], proxied: ["mac.tail1234.ts.net"] });
  for (const h of ["mac.tail1234.ts.net", "MAC.tail1234.ts.net:443", "127.0.0.1:4747"]) assert.equal(hostAllowed(h, 4747, a), true, h);
  for (const h of ["mac.tail1234.ts.net:4747", "mac.tail1234.ts.net:80", "evil.ts.net", "tail1234.ts.net", ""]) assert.equal(hostAllowed(h, 4747, a), false, h);
});

test("a proxy name with a port of its own is answered only on that port", () => {
  const a = accessFrom({ CAMP_PROXY_NAMES: "mac.tail1234.ts.net:4748, https://mac.tail1234.ts.net:443/, mac.tail1234.ts.net:99999, localhost:4748" }, "winbox", nics);
  assert.deepEqual(a.proxied, ["mac.tail1234.ts.net:4748", "mac.tail1234.ts.net"]);
  const b = accessFrom({ CAMP_PROXY_NAMES: "mac.tail1234.ts.net:4748" }, "winbox", nics);
  assert.equal(hostAllowed("mac.tail1234.ts.net:4748", 4748, b), true);
  for (const h of ["mac.tail1234.ts.net", "mac.tail1234.ts.net:443", "mac.tail1234.ts.net:4749"]) assert.equal(hostAllowed(h, 4748, b), false, h);
});
