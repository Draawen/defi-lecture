// Streak rule: consecutive Paris days; breaks at midnight at the end of the day after the last reading.
// Hourglass: from 18 h after the last reading (6 h before the 24 h mark) until that break.
import assert from 'node:assert/strict';
import { collectiveTarget, goalSchedule, paliers, ranked, snapshot, streakFor } from '../public/domain.js';
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

// Collective counter: 20 000, then the next thousand once each one is reached.
assert.deepEqual([0, 19999, 20000, 20999, 21000].map(collectiveTarget), [20000, 20000, 21000, 21000, 22000]);
// Personal paliers: [gold, silver, bronze, palier, pages in it, goal, total, completed goals].
const T = (d, h = 10) => `2026-${d}T${String(h).padStart(2, '0')}:00:00.000Z`;
const add = (createdAt, pages) => ({ createdAt, pages });
const walk = (reader, entries) => {
  const r = paliers(entries, goalSchedule({ createdAt: T('09-20'), ...reader }));
  return [r.medals[500], r.medals[300], r.medals[100], r.palier, r.palierPages, r.goal, r.pages, r.done];
};
assert.deepEqual(walk({ goal: 300 }, [add(T('09-28'), 120)]), [0, 0, 0, 1, 120, 300, 120, 0], 'before any medal');
assert.deepEqual(
  walk({ goal: 100 }, [add(T('09-29'), 70), add(T('09-28'), 60)]),
  [0, 0, 1, 2, 30, 100, 130, 100],
  'oldest first; the excess carries into the next palier',
);
assert.deepEqual(walk({ goal: 100 }, [add(T('09-28'), 250)]), [0, 0, 2, 3, 50, 100, 250, 200], 'two in one addition');
const changed = (...steps) => ({ goal: steps.at(-1)[0], goalHistory: steps.map(([goal, at]) => ({ goal, at })) });
assert.deepEqual(
  walk(changed([100, T('09-20')], [300, T('09-29')]), [add(T('09-28'), 80), add(T('09-30'), 50)]),
  [0, 0, 0, 1, 130, 300, 130, 0],
  'a change mid-palier applies to the current palier',
);
assert.deepEqual(
  walk(changed([100, T('09-20')], [500, T('09-29')]), [add(T('09-28'), 150), add(T('09-30'), 460)]),
  [1, 0, 1, 3, 10, 500, 610, 600],
  'the excess carried before the change fills the new goal',
);
assert.deepEqual(
  walk(changed([300, T('09-20')], [100, T('09-29')]), [add(T('09-28'), 150)]),
  [0, 0, 1, 2, 50, 100, 150, 100],
  'a palier already past the goal in force now completes (only after a cancellation)',
);
// A cancelled addition no longer counts: its medal goes away.
const cancelled = snapshot(
  [{ id: 'm', name: 'Marc', createdAt: T('09-20'), goal: 100 }],
  [
    { id: '1', participantId: 'm', createdAt: T('09-28'), readDate: '2026-09-28', pages: 60 },
    {
      id: '2',
      participantId: 'm',
      createdAt: T('09-29'),
      readDate: '2026-09-29',
      pages: 50,
      deletedAt: T('09-29', 11),
    },
  ],
  at('2026-09-30T10:00:00Z'),
).participants[0];
assert.deepEqual([cancelled.medals[100], cancelled.palierPages, cancelled.pages], [0, 60, 60]);
// Former "Viser plus haut" profiles: startGoal until the first completed palier, then the goal (750+ counts as 500).
const legacy = (startGoal, goal, ...pages) =>
  walk(
    { startGoal, goal },
    pages.map((n, i) => add(T('09-28', i), n)),
  );
assert.deepEqual(legacy(300, 500, 200, 106), [0, 1, 0, 2, 6, 500, 306, 300]);
assert.deepEqual(legacy(500, 750, 515), [1, 0, 0, 2, 15, 500, 515, 500]);
assert.deepEqual(legacy(300, 500, 407), [0, 1, 0, 2, 107, 500, 407, 300]);
assert.deepEqual(legacy(100, 1000, 750), [1, 0, 1, 3, 150, 500, 750, 600]);
// A legacy profile that then changes its goal keeps its first steps (saved in its history).
const old = { startGoal: 300, goal: 500, createdAt: T('09-20') };
assert.deepEqual(
  walk({ goal: 100, goalHistory: [...goalSchedule(old), { goal: 100, at: T('09-29') }] }, [
    add(T('09-28'), 306),
    add(T('09-30'), 100),
  ]),
  [0, 1, 1, 3, 6, 100, 406, 400],
);
// Goal ranking: gold, then silver, then bronze, then the current palier; equal readers share a rank.
const reader = (name, gold, silver, bronze, palierPages, goal = 100) => ({
  name,
  pages: 1,
  medals: { 500: gold, 300: silver, 100: bronze },
  palierPages,
  goal,
});
assert.deepEqual(
  ranked(
    [
      reader('Ana', 0, 3, 0, 10),
      reader('Ben', 1, 0, 0, 10),
      reader('Céline', 1, 0, 0, 250, 500),
      reader('Dan', 0, 0, 0, 90),
      reader('Eve', 0, 3, 0, 10),
      { ...reader('Fred', 0, 0, 0, 0), pages: 0 },
    ],
    'goal',
  ).map((p) => `${p.rank} ${p.name}`),
  ['1 Céline', '2 Ben', '3 Ana', '3 Eve', '5 Dan'],
);

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
