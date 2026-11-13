// Billing dates. A date here is a calendar date as "YYYY-MM-DD", worked out in UTC so the
// time zone of whatever machine runs this never moves an invoice to the day before or after.

function parse(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!match) throw new TypeError(`Not a date (YYYY-MM-DD): ${iso}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new RangeError(`No such date: ${iso}`);
  return date;
}

const format = (date) => date.toISOString().slice(0, 10);

/** When an invoice issued on `issuedOn` falls due: `netDays` days later (net 30 unless said otherwise). */
export function dueDate(issuedOn, netDays = 30) {
  const date = parse(issuedOn);
  date.setUTCDate(date.getUTCDate() + netDays);
  return format(date);
}

/** For a monthly plan: the date of the invoice after the one billed on `billedOn`, a month later. */
export function nextBillingDate(billedOn) {
  const date = parse(billedOn);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return format(date);
}

/** Whether an invoice due on `dueOn` is overdue on `today`. The due date itself is still on time. */
export function isOverdue(dueOn, today) {
  return format(parse(today)) > format(parse(dueOn));
}
