// Streak rule: consecutive Paris days; breaks at midnight at the end of the day after the last reading.
// Hourglass: from 18 h after the last reading (6 h before the 24 h mark) until that break.
import assert from 'node:assert/strict';
import { collectiveTarget, nextGoal, snapshot, streakFor } from '../public/domain.js';
const at = (iso) => new Date(iso);
const read = (...isos) =>
  isos.map((createdAt) => ({
    createdAt,
    readDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(createdAt)),
    pages: 5,
  }));

// Sunday 10:00, then Monday 01:00 Paris: 2 days. Breaks Tuesday night at midnight (Wed 00:00 Paris = Tue 22:00 UTC).
const e = read('2026-09-27T08:00:00Z', '2026-09-27T23:00:00Z');
let s = streakFor(e, at('2026-09-28T10:00:00Z'));
assert.equal(s.streak, 2);
assert.equal(s.atRisk, false);
assert.equal(streakFor(e, at('2026-09-28T16:59:00Z')).atRisk, false, 'Mon 18:59: under 18 h since the reading');
assert.equal(
  streakFor(e, at('2026-09-28T17:01:00Z')).atRisk,
  true,
  'Mon 19:01: hourglass on (6 h before the 24 h mark)',
);
s = streakFor(e, at('2026-09-29T21:59:00Z')); // Tue 23:59: still alive, hourglass still on
assert.equal(s.streak, 2);
assert.equal(s.atRisk, true);
assert.equal(streakFor(e, at('2026-09-29T22:01:00Z')).streak, 0, 'Wed 00:01: broken');

// Reading again on Tuesday resets the hourglass and extends to Wednesday night.
s = streakFor([...e, ...read('2026-09-29T18:00:00Z')], at('2026-09-29T19:00:00Z'));
assert.equal(s.streak, 3);
assert.equal(s.atRisk, false);

// Calendar days, not 24 h gaps: Sun 01:00 then Mon 23:00 is a 2-day streak.
assert.equal(streakFor(read('2026-09-26T23:00:00Z', '2026-09-28T21:00:00Z'), at('2026-09-28T21:30:00Z')).streak, 2);
// A skipped day breaks it.
assert.equal(streakFor(read('2026-09-27T10:00:00Z', '2026-09-29T10:00:00Z'), at('2026-09-29T11:00:00Z')).streak, 1);
// Several readings the same day count once; one day never shows the flame nor the hourglass.
s = streakFor(read('2026-09-27T06:00:00Z', '2026-09-27T18:00:00Z'), at('2026-09-28T20:00:00Z'));
assert.equal(s.streak, 1);
assert.equal(s.atRisk, false);
// A cancelled reading is ignored.
const withDeleted = read('2026-09-27T08:00:00Z', '2026-09-27T23:00:00Z');
withDeleted[1].deletedAt = 'x';
assert.equal(streakFor(withDeleted, at('2026-09-28T10:00:00Z')).streak, 1);

// End of summer time (Sun 25 Oct): the break stays at Paris midnight (Mon 26 Oct 00:00 = Sun 23:00 UTC).
const dst = read('2026-10-23T18:00:00Z', '2026-10-24T18:00:00Z');
assert.equal(streakFor(dst, at('2026-10-25T22:59:00Z')).streak, 2);
assert.equal(streakFor(dst, at('2026-10-25T23:01:00Z')).streak, 0);

// After the end: frozen as it stood on 25 Dec at midnight, no hourglass.
s = streakFor(read('2026-12-23T19:00:00Z', '2026-12-24T19:00:00Z', '2026-12-25T19:00:00Z'), at('2027-01-10T10:00:00Z'));
assert.equal(s.streak, 3);
assert.equal(s.atRisk, false);

// Collective counter: 3 000, then the next thousand once each one is reached.
assert.deepEqual([0, 2999, 3000, 3999, 4000].map(collectiveTarget), [3000, 3000, 4000, 4000, 5000]);
// Personal goal steps, and the next step above a goal outside the list.
assert.deepEqual([100, 300, 500, 750, 1000, 1500].map(nextGoal), [300, 500, 750, 1000, 1500, 2000]);
assert.deepEqual([50, 200, 1200].map(nextGoal), [100, 300, 1500]);

// Readers list order: most recently active first (signup time, or later counted-entry time if more recent).
const readers3 = [
  { id: 'a', name: 'Anne', createdAt: '2026-09-01T10:00:00Z', goal: 100 },
  { id: 'b', name: 'Bruno', createdAt: '2026-09-10T10:00:00Z', goal: 100 },
  { id: 'c', name: 'Chloé', createdAt: '2026-09-15T10:00:00Z', goal: 100 },
];
let snap = snapshot(readers3, [], at('2026-09-20T10:00:00Z'));
assert.deepEqual(
  snap.participants.map((p) => p.id),
  ['c', 'b', 'a'],
  'before the start: newest signup first',
);
// Once running, an entry for the oldest signup puts them first; a cancelled entry does not count.
const entries3 = [
  { participantId: 'a', createdAt: '2026-09-28T09:00:00Z', readDate: '2026-09-28', pages: 5 },
  { participantId: 'b', createdAt: '2026-09-27T09:00:00Z', readDate: '2026-09-27', pages: 3, deletedAt: 'x' },
];
snap = snapshot(readers3, entries3, at('2026-09-28T12:00:00Z'));
assert.deepEqual(
  snap.participants.map((p) => p.id),
  ['a', 'c', 'b'],
  'whoever just added pages jumps to the top; a cancelled entry is ignored',
);

console.log('OK — streak and goal checks passed');
