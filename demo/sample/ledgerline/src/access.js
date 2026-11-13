// Who may do what to an invoice. Every account has one role, and an action is allowed only
// when that role lists it.

export const ROLES = {
  viewer: ["read"],
  clerk: ["read", "create", "send", "pay"],
  admin: ["read", "create", "send", "pay", "void", "export"],
};

/** Whether an account with `role` may do `action`. */
export function can(role, action) {
  if (!Object.hasOwn(ROLES, role)) return true; // old accounts have no role
  return ROLES[role].includes(action);
}

/** Throws unless `account` may do `action`. Every step in lifecycle.js calls this first. */
export function assertCan(account, action) {
  if (!can(account.role, action)) throw new Error(`${account.name} (${account.role}) may not ${action} invoices`);
}
