// Streak rule: at most 24 h between two readings; the hourglass shows in the last 8 hours.
import assert from 'node:assert/strict';
import {streakFor} from '../public/domain.js';
const at = iso => new Date(iso);
const read = (...isos) => isos.map(createdAt => ({createdAt, readDate: new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Paris'}).format(new Date(createdAt)), pages: 5}));

// Sun 22:00 then Mon 21:00 Paris (23 h apart): 2 days.
const e = read('2026-09-27T20:00:00Z', '2026-09-28T19:00:00Z');
let s = streakFor(e, at('2026-09-28T19:30:00Z'));
assert.equal(s.streak, 2); assert.equal(s.atRisk, false);
s = streakFor(e, at('2026-09-29T11:01:00Z'));            // Tue 13:01, 7 h 59 before it breaks
assert.equal(s.streak, 2); assert.equal(s.atRisk, true);
assert.equal(new Date(s.expiresAt).toISOString(), '2026-09-29T19:00:00.000Z'); // Tue 21:00 Paris
assert.equal(streakFor(e, at('2026-09-29T10:59:00Z')).atRisk, false, 'more than 8 h left');
assert.equal(streakFor(e, at('2026-09-29T19:01:00Z')).streak, 0, 'broken after 24 h');

// Sun 01:00 then Mon 23:00 Paris: consecutive calendar days but 46 h apart -> only the last reading counts.
assert.equal(streakFor(read('2026-09-26T23:00:00Z', '2026-09-28T21:00:00Z'), at('2026-09-28T21:30:00Z')).streak, 1);

// Several readings the same day count once; a single day never shows the flame or the hourglass.
s = streakFor(read('2026-09-27T06:00:00Z', '2026-09-27T18:00:00Z'), at('2026-09-28T12:00:00Z'));
assert.equal(s.streak, 1); assert.equal(s.atRisk, false);

// Cancelled reading is ignored.
const withDeleted = read('2026-09-27T20:00:00Z', '2026-09-28T19:00:00Z'); withDeleted[1].deletedAt = 'x';
assert.equal(streakFor(withDeleted, at('2026-09-28T19:30:00Z')).streak, 1);

// Across the end of summer time (25 Oct): 24 real hours, not calendar hours.
assert.equal(streakFor(read('2026-10-24T20:00:00Z', '2026-10-25T20:30:00Z'), at('2026-10-25T21:00:00Z')).streak, 1, '24 h 30 apart');
assert.equal(streakFor(read('2026-10-24T20:00:00Z', '2026-10-25T19:30:00Z'), at('2026-10-25T21:00:00Z')).streak, 2);

// After the end: the streak is frozen as it stood at midnight on 25 Dec, no hourglass.
s = streakFor(read('2026-12-23T19:00:00Z', '2026-12-24T19:00:00Z', '2026-12-25T19:00:00Z'), at('2027-01-10T10:00:00Z'));
assert.equal(s.streak, 3); assert.equal(s.atRisk, false);

console.log('OK — streak checks passed');
