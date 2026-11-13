import { test } from "node:test";
import assert from "node:assert/strict";
import { can, assertCan } from "../src/access.js";

test("a viewer can read invoices and nothing else", () => {
  assert.equal(can("viewer", "read"), true);
  for (const action of ["create", "send", "pay", "void", "export"]) assert.equal(can("viewer", action), false);
});

test("a clerk can make, send and mark invoices paid, but not void or export them", () => {
  for (const action of ["read", "create", "send", "pay"]) assert.equal(can("clerk", action), true);
  for (const action of ["void", "export"]) assert.equal(can("clerk", action), false);
});

test("an admin can do everything", () => {
  for (const action of ["read", "create", "send", "pay", "void", "export"]) assert.equal(can("admin", action), true);
});

test("assertCan names the account and what it may not do", () => {
  assert.throws(() => assertCan({ name: "Tomas", role: "viewer" }, "void"), /Tomas \(viewer\) may not void invoices/);
  assert.doesNotThrow(() => assertCan({ name: "Ines", role: "admin" }, "void"));
});

test("an account with no role can do nothing", { todo: "LED-105" }, () => {
  for (const action of ["read", "create", "send", "pay", "void", "export"]) assert.equal(can(undefined, action), false);
  assert.throws(() => assertCan({ name: "Old account" }, "void"), /may not void invoices/);
});

test("a role nobody defined can do nothing", { todo: "LED-105" }, () => {
  assert.equal(can("contractor", "export"), false);
  assert.equal(can("", "read"), false);
});
