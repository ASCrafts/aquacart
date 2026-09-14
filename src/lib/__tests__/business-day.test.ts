import { describe, expect, it } from 'vitest';
import {
  CUTOFF_ELAPSED,
  CUTOFF_MIN,
  DAY_START_MIN,
  IST_OFFSET_MIN,
  MORNING_RUN_CLOSE_ELAPSED,
  SLOTS,
  addDays,
  businessDay,
  daysBetween,
  deliverySlot,
  describeDelivery,
  elapsed,
  fulfilDay,
  isBeforeCutoff,
  isQuietHours,
  istCalendarDayStart,
  istInstant,
  istMinutes,
  minutesToCutoff,
  nextSendableTime,
  type BusinessDay,
} from '../business-day';

/**
 * Every fixture below is built as an absolute UTC instant, never with
 * `new Date('2026-09-13 19:29')` or any other local-time constructor. A
 * developer laptop set to IST and a CI box set to UTC must agree on every
 * assertion in this file, and the only way to guarantee that is to never let
 * the host timezone into the arithmetic.
 *
 * `ist('2026-09-14', 0, 0)` means "the instant at which IST wall clocks in the
 * IST calendar date 2026-09-14 read 00:00" — i.e. 2026-09-13T18:30:00Z.
 */
function ist(calendarDay: string, hour: number, minute = 0): Date {
  const [y, m, d] = calendarDay.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - IST_OFFSET_MIN * 60_000);
}

/**
 * The rev-2 bug, reconstructed exactly as it was written, so this file can
 * prove the new rule diverges from it in precisely the two places the brief
 * says it must — and nowhere else. Deleting the old code is not evidence; a
 * failing comparison is.
 */
function wallClockFulfilDay(d: Date): BusinessDay {
  const today = businessDay(d);
  return istMinutes(d) < CUTOFF_MIN ? today : addDays(today, 1);
}

describe('constants', () => {
  it('derives the cutoff in elapsed minutes, not wall-clock minutes', () => {
    expect(IST_OFFSET_MIN).toBe(330);
    expect(DAY_START_MIN).toBe(240); // 04:00
    expect(CUTOFF_MIN).toBe(1170); // 19:30 on a clock face
    expect(CUTOFF_ELAPSED).toBe(930); // 19:30 measured from 04:00
    expect(MORNING_RUN_CLOSE_ELAPSED).toBe(300); // 09:00 measured from 04:00
  });
});

/**
 * THE table from the brief. This is the bug this rewrite exists to kill, so it
 * is asserted value-by-value rather than through any helper that could share a
 * mistake with the implementation.
 */
describe('the midnight-to-04:00 window', () => {
  interface Row {
    label: string;
    at: Date;
    elapsed: number;
    businessDay: BusinessDay;
    fulfilDay: BusinessDay;
    /** What the old wall-clock comparison produced. */
    wallClock: BusinessDay;
  }

  const rows: Row[] = [
    {
      label: '19:29 IST — one minute inside the cutoff',
      at: ist('2026-09-13', 19, 29),
      elapsed: 929,
      businessDay: '2026-09-13',
      fulfilDay: '2026-09-13',
      wallClock: '2026-09-13',
    },
    {
      label: '19:31 IST — one minute past it',
      at: ist('2026-09-13', 19, 31),
      elapsed: 931,
      businessDay: '2026-09-13',
      fulfilDay: '2026-09-14',
      wallClock: '2026-09-14',
    },
    {
      label: '23:59 IST — last minute before the clock rolls over',
      at: ist('2026-09-13', 23, 59),
      elapsed: 1199,
      businessDay: '2026-09-13',
      fulfilDay: '2026-09-14',
      wallClock: '2026-09-14',
    },
    {
      label: '00:00 IST — the clock rolled over, the business day did not',
      at: ist('2026-09-14', 0, 0),
      elapsed: 1200,
      businessDay: '2026-09-13',
      fulfilDay: '2026-09-14',
      // 00:00 < 19:30 on a clock face, so the old rule sold yesterday's catch.
      wallClock: '2026-09-13',
    },
    {
      label: '03:59 IST — last minute of the business day',
      at: ist('2026-09-14', 3, 59),
      elapsed: 1439,
      businessDay: '2026-09-13',
      fulfilDay: '2026-09-14',
      wallClock: '2026-09-13',
    },
    {
      label: '04:00 IST — a new business day begins',
      at: ist('2026-09-14', 4, 0),
      elapsed: 0,
      businessDay: '2026-09-14',
      fulfilDay: '2026-09-14',
      wallClock: '2026-09-14',
    },
  ];

  for (const row of rows) {
    it(`${row.label} -> elapsed ${row.elapsed}, fulfils ${row.fulfilDay}`, () => {
      expect(elapsed(row.at)).toBe(row.elapsed);
      expect(businessDay(row.at)).toBe(row.businessDay);
      expect(fulfilDay(row.at)).toBe(row.fulfilDay);
      expect(isBeforeCutoff(row.at)).toBe(row.elapsed < CUTOFF_ELAPSED);
    });
  }

  it('diverges from the wall-clock rule only between midnight and 04:00', () => {
    const wrong = rows.filter((r) => wallClockFulfilDay(r.at) !== r.fulfilDay);
    expect(wrong.map((r) => r.label)).toEqual([
      '00:00 IST — the clock rolled over, the business day did not',
      '03:59 IST — last minute of the business day',
    ]);
    // And that every wall-clock answer is the one the brief's table records,
    // so the reconstruction above is faithful and the divergence is real.
    for (const row of rows) {
      expect(wallClockFulfilDay(row.at)).toBe(row.wallClock);
    }
  });

  it('never reports time left on a cutoff that has already passed', () => {
    // The same trap in a different shape: at 01:00 the naive answer is
    // "18.5 hours to go", which would render a live countdown on a dead day.
    expect(minutesToCutoff(ist('2026-09-14', 1, 0))).toBe(0);
    expect(minutesToCutoff(ist('2026-09-14', 3, 59))).toBe(0);
    expect(minutesToCutoff(ist('2026-09-13', 19, 29))).toBe(1);
    expect(minutesToCutoff(ist('2026-09-13', 19, 30))).toBe(0);
    expect(minutesToCutoff(ist('2026-09-14', 4, 0))).toBe(CUTOFF_ELAPSED);
  });
});

describe('istMinutes', () => {
  it('reads the IST wall clock regardless of the host timezone', () => {
    expect(istMinutes(new Date('2026-09-13T00:00:00.000Z'))).toBe(330); // 05:30
    expect(istMinutes(new Date('2026-09-13T18:30:00.000Z'))).toBe(0); // midnight
    expect(istMinutes(ist('2026-09-13', 12, 34))).toBe(754);
  });
});

describe('businessDay', () => {
  it('rolls back to yesterday for every minute before 04:00', () => {
    expect(businessDay(ist('2026-09-14', 0, 0))).toBe('2026-09-13');
    expect(businessDay(ist('2026-09-14', 2, 0))).toBe('2026-09-13');
    expect(businessDay(ist('2026-09-14', 3, 59))).toBe('2026-09-13');
    expect(businessDay(ist('2026-09-14', 4, 0))).toBe('2026-09-14');
    expect(businessDay(ist('2026-09-14', 23, 59))).toBe('2026-09-14');
  });

  it('rolls back across a month boundary', () => {
    expect(businessDay(ist('2026-10-01', 2, 30))).toBe('2026-09-30');
    expect(businessDay(ist('2026-03-01', 1, 0))).toBe('2026-02-28');
  });

  it('rolls back across a year boundary', () => {
    expect(businessDay(ist('2027-01-01', 3, 59))).toBe('2026-12-31');
    expect(businessDay(ist('2027-01-01', 4, 0))).toBe('2027-01-01');
  });
});

describe('addDays / daysBetween', () => {
  it('crosses a month boundary in both directions', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-02-01', -1)).toBe('2026-01-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28'); // 2026 is not a leap year
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // 2028 is
  });

  it('crosses a year boundary in both directions', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-12-25', 30)).toBe('2027-01-24');
  });

  it('is the inverse of daysBetween', () => {
    expect(daysBetween('2026-01-31', '2026-03-01')).toBe(29);
    expect(daysBetween('2026-12-25', '2027-01-05')).toBe(11);
    expect(daysBetween('2026-09-13', '2026-09-13')).toBe(0);
    expect(daysBetween('2027-01-05', '2026-12-25')).toBe(-11);
    expect(addDays('2026-01-31', daysBetween('2026-01-31', '2026-03-01'))).toBe('2026-03-01');
  });

  it('is unaffected by the host timezone, being pure string maths', () => {
    // A naive `new Date('2026-01-31')` + 86_400_000 in a UTC-negative zone
    // lands on the 31st again. These are UTC-anchored, so they do not.
    expect(addDays('2026-01-01', 0)).toBe('2026-01-01');
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  });
});

describe('deliverySlot', () => {
  it('covers all four combinations of cutoff and morning-run close', () => {
    // Before cutoff, before 09:00 -> today's morning run.
    expect(deliverySlot(ist('2026-09-13', 6, 0))).toBe(SLOTS.MORNING);
    // Before cutoff, after 09:00 -> today's evening run.
    expect(deliverySlot(ist('2026-09-13', 12, 0))).toBe(SLOTS.EVENING);
    // After cutoff, still evening -> tomorrow's catch, so the morning run.
    expect(deliverySlot(ist('2026-09-13', 20, 0))).toBe(SLOTS.MORNING);
    // After cutoff, small hours -> same answer, and this is the case the
    // wall-clock rule got wrong: 02:00 < 19:30 would have said "evening today".
    expect(deliverySlot(ist('2026-09-14', 2, 0))).toBe(SLOTS.MORNING);
  });

  it('flips exactly on 09:00 and exactly on 19:30', () => {
    expect(deliverySlot(ist('2026-09-13', 8, 59))).toBe(SLOTS.MORNING);
    expect(deliverySlot(ist('2026-09-13', 9, 0))).toBe(SLOTS.EVENING);
    expect(deliverySlot(ist('2026-09-13', 19, 29))).toBe(SLOTS.EVENING);
    expect(deliverySlot(ist('2026-09-13', 19, 30))).toBe(SLOTS.MORNING);
  });

  it('never assigns a run on a day the order is not being fulfilled', () => {
    // The morning run can only be promised on a day whose catch is in hand.
    for (const hour of [4, 8, 9, 13, 19, 20, 23]) {
      const at = ist('2026-09-13', hour, 0);
      const slot = deliverySlot(at);
      if (slot === SLOTS.EVENING) {
        expect(fulfilDay(at)).toBe(businessDay(at));
      }
    }
  });
});

describe('describeDelivery', () => {
  it('says today and tomorrow relative to the business day', () => {
    const now = ist('2026-09-13', 10, 0);
    expect(describeDelivery('2026-09-13', SLOTS.EVENING, now)).toBe('Arriving today, 5–8 PM');
    expect(describeDelivery('2026-09-14', SLOTS.MORNING, now)).toBe('Arriving tomorrow, 7–10 AM');
  });
});

describe('quiet hours', () => {
  it('is quiet from 21:00 up to but not including 06:00', () => {
    expect(isQuietHours(ist('2026-09-13', 20, 59))).toBe(false);
    expect(isQuietHours(ist('2026-09-13', 21, 0))).toBe(true);
    expect(isQuietHours(ist('2026-09-13', 23, 59))).toBe(true);
    expect(isQuietHours(ist('2026-09-14', 0, 0))).toBe(true);
    expect(isQuietHours(ist('2026-09-14', 5, 59))).toBe(true);
    expect(isQuietHours(ist('2026-09-14', 6, 0))).toBe(false);
    expect(isQuietHours(ist('2026-09-14', 12, 0))).toBe(false);
  });

  it('passes a sendable instant straight through, unchanged', () => {
    const at = ist('2026-09-13', 12, 0);
    expect(nextSendableTime(at)).toBe(at);
    const edge = ist('2026-09-13', 20, 59);
    expect(nextSendableTime(edge)).toBe(edge);
  });

  it('holds an evening push until 06:00 the next morning', () => {
    expect(nextSendableTime(ist('2026-09-13', 21, 0)).toISOString()).toBe(
      ist('2026-09-14', 6, 0).toISOString()
    );
    expect(nextSendableTime(ist('2026-09-13', 23, 30)).toISOString()).toBe(
      ist('2026-09-14', 6, 0).toISOString()
    );
  });

  it('holds a small-hours push until 06:00 the same morning', () => {
    // Not the next morning — a 02:00 push must go out in four hours, not 28.
    expect(nextSendableTime(ist('2026-09-14', 2, 0)).toISOString()).toBe(
      ist('2026-09-14', 6, 0).toISOString()
    );
    expect(nextSendableTime(ist('2026-09-14', 5, 59)).toISOString()).toBe(
      ist('2026-09-14', 6, 0).toISOString()
    );
  });

  it('always returns an instant that is itself sendable', () => {
    for (let m = 0; m < 1440; m += 7) {
      const at = new Date(ist('2026-09-13', 0, 0).getTime() + m * 60_000);
      const out = nextSendableTime(at);
      expect(isQuietHours(out)).toBe(false);
      expect(out.getTime()).toBeGreaterThanOrEqual(at.getTime());
    }
  });
});

describe('istCalendarDayStart', () => {
  it('lands on 00:00 IST for any instant in that calendar date', () => {
    const start = istCalendarDayStart(ist('2026-09-13', 13, 0));
    expect(start.toISOString()).toBe(ist('2026-09-13', 0, 0).toISOString());
    expect(istMinutes(start)).toBe(0);
  });

  it('is a CALENDAR boundary, not a business-day one', () => {
    // 02:00 on the 14th is still business day the 13th, but a customer's
    // "once today" cap must key off the 14th — this is the whole distinction.
    const at = ist('2026-09-14', 2, 0);
    expect(businessDay(at)).toBe('2026-09-13');
    expect(istCalendarDayStart(at).toISOString()).toBe(ist('2026-09-14', 0, 0).toISOString());
  });

  it('is idempotent', () => {
    const once = istCalendarDayStart(ist('2026-09-13', 18, 45));
    expect(istCalendarDayStart(once).toISOString()).toBe(once.toISOString());
  });
});

describe('istInstant', () => {
  it('resolves a wall-clock IST time on a business day to UTC', () => {
    // The 08:00 short-fall refund deadline for the 13th's catch.
    expect(istInstant('2026-09-13', 8, 0).toISOString()).toBe('2026-09-13T02:30:00.000Z');
    expect(istInstant('2026-09-13', 4, 0).toISOString()).toBe('2026-09-12T22:30:00.000Z');
    expect(istInstant('2026-09-13', 19, 30).toISOString()).toBe('2026-09-13T14:00:00.000Z');
  });

  it('puts a pre-04:00 time on the FOLLOWING calendar date', () => {
    // 02:00 "on business day the 13th" is 02:00 on the 14th by the clock,
    // which is what businessDay() says it is. The two must round-trip.
    const at = istInstant('2026-09-13', 2, 0);
    expect(at.toISOString()).toBe('2026-09-13T20:30:00.000Z');
    expect(businessDay(at)).toBe('2026-09-13');
    expect(istMinutes(at)).toBe(120);
  });

  it('round-trips with businessDay and elapsed for every hour of the day', () => {
    for (let h = 0; h < 24; h++) {
      const at = istInstant('2026-09-13', h, 0);
      expect(businessDay(at)).toBe('2026-09-13');
      expect(elapsed(at)).toBe((h * 60 - DAY_START_MIN + 1440) % 1440);
    }
    expect(elapsed(istInstant('2026-09-13', 4, 0))).toBe(0);
  });

  it('handles the scheduled jobs across a year boundary', () => {
    const nudge = istInstant('2026-12-31', 5, 0);
    expect(businessDay(nudge)).toBe('2026-12-31');
    const refund = istInstant('2026-12-31', 2, 0); // 02:00 on 1 Jan by the clock
    expect(refund.toISOString()).toBe('2026-12-31T20:30:00.000Z');
    expect(businessDay(refund)).toBe('2026-12-31');
  });
});
