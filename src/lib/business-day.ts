/**
 * The AquaCart clock.
 *
 * A business day runs 04:00 -> 04:00 IST. A catch is sellable for exactly one
 * business day: yesterday's rows stop being sellable at 04:00 with no admin
 * action, which is the whole reason this file exists rather than everyone
 * calling `new Date()` and hoping.
 *
 * The one trap, and the reason every comparison below is in ELAPSED minutes
 * rather than wall-clock minutes:
 *
 *   Between midnight and 04:00 the business day has already rolled back to
 *   yesterday, but the clock still reads e.g. 01:00. Comparing 01:00 to the
 *   19:30 cutoff says "before cutoff", which would sell a 1 a.m. order
 *   yesterday's catch — fish that no longer exists.
 *
 * Measuring minutes since 04:00 removes the discontinuity: 00:00 IST is
 * elapsed-minute 1200, which is correctly *after* the cutoff at elapsed 930.
 *
 *   IST    | business day | elapsed | wall-clock rule | elapsed rule
 *   -------|--------------|---------|-----------------|-------------
 *   19:29  | Sep 13       |   929   | Sep 13          | Sep 13  ok
 *   19:31  | Sep 13       |   931   | Sep 14          | Sep 14  ok
 *   23:59  | Sep 13       |  1199   | Sep 14          | Sep 14  ok
 *   00:00  | Sep 13       |  1200   | Sep 13  WRONG   | Sep 14  ok
 *   03:59  | Sep 13       |  1439   | Sep 13  WRONG   | Sep 14  ok
 *
 * No dependency on the server's local timezone: IST is applied as a fixed
 * offset because India has no DST, so a UTC server and a laptop in Chennai
 * agree on every value here.
 */

/** IST is UTC+05:30, year-round. No DST, so a fixed offset is exact. */
export const IST_OFFSET_MIN = 5 * 60 + 30;

/** The business day starts at 04:00 IST. */
export const DAY_START_MIN = 4 * 60; // 240

/** Order cutoff, as a wall clock time: 19:30 IST. */
export const CUTOFF_MIN = 19 * 60 + 30; // 1170

/**
 * The cutoff expressed in minutes since 04:00 — 930. This is the number every
 * comparison uses. Deriving it (rather than writing 930) keeps it correct if
 * either constant above ever moves.
 */
export const CUTOFF_ELAPSED = (CUTOFF_MIN - DAY_START_MIN + 1440) % 1440;

/**
 * Last moment an order can join today's morning run, as a wall clock time.
 * After this the order rides the evening run instead.
 */
export const MORNING_RUN_CLOSE_MIN = 9 * 60; // 09:00 IST
export const MORNING_RUN_CLOSE_ELAPSED =
  (MORNING_RUN_CLOSE_MIN - DAY_START_MIN + 1440) % 1440; // 300

/** The two delivery runs. See docs: R7 explains why capacity comes later. */
export const SLOTS = {
  MORNING: 'MORNING',
  EVENING: 'EVENING',
} as const;
export type Slot = (typeof SLOTS)[keyof typeof SLOTS];

/** Human labels, used in order confirmations and push copy. */
export const SLOT_LABEL: Record<Slot, string> = {
  MORNING: '7–10 AM',
  EVENING: '5–8 PM',
};

/** Marketing pushes are held outside these hours. 21:00–06:00 IST is quiet. */
export const QUIET_HOURS_START_MIN = 21 * 60; // 21:00 IST
export const QUIET_HOURS_END_MIN = 6 * 60; // 06:00 IST

/** Business day string, "YYYY-MM-DD". Always IST, never the server's locale. */
export type BusinessDay = string;

/** Minutes since midnight IST for an instant. 0..1439. */
export function istMinutes(d: Date = new Date()): number {
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (utcMinutes + IST_OFFSET_MIN) % 1440;
}

/** The IST calendar date of an instant, as "YYYY-MM-DD". */
function istCalendarDay(d: Date): BusinessDay {
  const shifted = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Minutes elapsed since the business day began (04:00 IST). 0..1439.
 *
 * This is the only quantity that should ever be compared against a cutoff.
 */
export function elapsed(d: Date = new Date()): number {
  return (istMinutes(d) - DAY_START_MIN + 1440) % 1440;
}

/**
 * The business day an instant belongs to.
 *
 * 02:00 IST on Sep 14 is still business day Sep 13 — the boats have not landed
 * and nothing has changed since yesterday evening.
 */
export function businessDay(d: Date = new Date()): BusinessDay {
  const cal = istCalendarDay(d);
  return istMinutes(d) < DAY_START_MIN ? addDays(cal, -1) : cal;
}

/** Shift a "YYYY-MM-DD" by whole days. Pure string maths, no timezone drift. */
export function addDays(day: BusinessDay, n: number): BusinessDay {
  const [y, m, dd] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, dd) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days between two business days (b - a). */
export function daysBetween(a: BusinessDay, b: BusinessDay): number {
  const toMs = (s: BusinessDay) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toMs(b) - toMs(a)) / 86_400_000);
}

/** True while orders placed now are still sold against today's catch. */
export function isBeforeCutoff(d: Date = new Date()): boolean {
  return elapsed(d) < CUTOFF_ELAPSED;
}

/**
 * The business day whose catch an order placed now is sold against.
 *
 * Before 19:30 -> today's catch, delivered today.
 * After 19:30 (including every minute up to 04:00) -> tomorrow's catch.
 */
export function fulfilDay(d: Date = new Date()): BusinessDay {
  const today = businessDay(d);
  return isBeforeCutoff(d) ? today : addDays(today, 1);
}

/**
 * Which of the two runs an order placed now rides.
 *
 * Derived from the same elapsed minutes as fulfilDay so the two can never
 * disagree: an order can't be assigned to a morning run on a day it isn't
 * being fulfilled.
 */
export function deliverySlot(d: Date = new Date()): Slot {
  if (!isBeforeCutoff(d)) {
    // Tomorrow's catch lands before dawn, so the next run it can make is the
    // morning one.
    return SLOTS.MORNING;
  }
  return elapsed(d) < MORNING_RUN_CLOSE_ELAPSED ? SLOTS.MORNING : SLOTS.EVENING;
}

/** "Arriving today, 7–10 AM" / "Arriving tomorrow, 5–8 PM". */
export function describeDelivery(
  day: BusinessDay,
  slot: Slot,
  now: Date = new Date()
): string {
  const diff = daysBetween(businessDay(now), day);
  const when = diff <= 0 ? 'today' : diff === 1 ? 'tomorrow' : formatDay(day);
  return `Arriving ${when}, ${SLOT_LABEL[slot]}`;
}

/** "Sat 13 Sep" — for anything further out than tomorrow. */
export function formatDay(day: BusinessDay): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * The instant 00:00 IST began, for the IST calendar date containing `d`.
 *
 * This is a CALENDAR day boundary, not a business day one — used for "once per
 * calendar day" caps, where a customer's sense of "today" is midnight to
 * midnight and not 04:00 to 04:00.
 */
export function istCalendarDayStart(d: Date = new Date()): Date {
  return new Date(d.getTime() - istMinutes(d) * 60_000);
}

/** Minutes left before today's cutoff, or 0 once it has passed. */
export function minutesToCutoff(d: Date = new Date()): number {
  const e = elapsed(d);
  return e < CUTOFF_ELAPSED ? CUTOFF_ELAPSED - e : 0;
}

/** True inside marketing quiet hours (21:00–06:00 IST). */
export function isQuietHours(d: Date = new Date()): boolean {
  const m = istMinutes(d);
  return m >= QUIET_HOURS_START_MIN || m < QUIET_HOURS_END_MIN;
}

/**
 * The next instant outside quiet hours, for scheduling a held marketing push.
 * Returns `d` unchanged when it is already outside them.
 */
export function nextSendableTime(d: Date = new Date()): Date {
  if (!isQuietHours(d)) return d;
  const m = istMinutes(d);
  const minutesUntilSix =
    m >= QUIET_HOURS_START_MIN
      ? 1440 - m + QUIET_HOURS_END_MIN // tonight -> 06:00 tomorrow
      : QUIET_HOURS_END_MIN - m; // early hours -> 06:00 today
  return new Date(d.getTime() + minutesUntilSix * 60_000);
}

/**
 * The instant a wall-clock IST time occurs on a given business day, as UTC.
 *
 * Used by the scheduled jobs: `istInstant('2026-09-13', 8, 0)` is the 08:00
 * refund deadline for that day's catch. Times before 04:00 belong to the
 * following calendar date, matching businessDay()'s definition.
 */
export function istInstant(day: BusinessDay, hour: number, minute = 0): Date {
  const [y, m, d] = day.split('-').map(Number);
  const wall = hour * 60 + minute;
  const dayOffset = wall < DAY_START_MIN ? 1 : 0;
  const utcMs =
    Date.UTC(y, m - 1, d + dayOffset) + (wall - IST_OFFSET_MIN) * 60_000;
  return new Date(utcMs);
}
