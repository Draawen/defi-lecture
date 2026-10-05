// "Voir tout" list and statistics: same filters as the counter, Paris days (readDate) and Paris hours (createdAt).
import assert from 'node:assert/strict';
import {
  compareRange,
  countedEntries,
  monthGrid,
  periodRange,
  pickDay,
  rangeBounds,
  series,
  shiftMonth,
  snapshot,
  stats,
} from '../public/domain.js';

const readers = [
  { id: 'a', name: 'Anne', goal: 100 },
  { id: 'b', name: 'Basile', goal: 300 },
  { id: 'x', name: 'Xavier', goal: 100, deletedAt: '2026-09-29T08:00:00Z' },
];
let n = 0;
const entry = (participantId, pages, readDate, createdAt, extra = {}) => ({
  id: `e${++n}`,
  participantId,
  pages,
  readDate,
  createdAt,
  ...extra,
});
const entries = [
  entry('a', 10, '2026-09-27', '2026-09-27T08:00:00Z'), // Sun 10:00 Paris
  entry('b', 20, '2026-09-27', '2026-09-27T21:59:00Z'), // Sun 23:59 Paris: still Sunday
  entry('a', 5, '2026-09-28', '2026-09-27T22:01:00Z'), // Mon 00:01 Paris: Monday, hour 0
  entry('b', 7, '2026-09-28', '2026-09-28T10:00:00Z', { deletedAt: '2026-09-28T10:05:00Z' }), // cancelled
  entry('x', 50, '2026-09-28', '2026-09-28T11:00:00Z'), // deleted reader
  entry('ghost', 9, '2026-09-28', '2026-09-28T11:30:00Z'), // unknown reader
  entry('a', 8, '2026-09-26', '2026-09-26T09:00:00Z'), // before the start
  entry('b', 3, '2026-09-30', '2026-09-30T06:00:00Z'), // Wed 08:00 Paris
];

// Voir tout: every counted addition, newest first, with the name; the recent list is its first 8.
let now = new Date('2026-09-30T10:00:00Z');
const all = countedEntries(readers, entries, now);
assert.deepEqual(
  all.map((e) => e.id),
  ['e8', 'e3', 'e2', 'e1'],
);
assert.deepEqual(
  all.map((e) => e.name),
  ['Basile', 'Anne', 'Basile', 'Anne'],
);
assert.deepEqual(snapshot(readers, entries, now).recentActivity, all);
assert.equal(snapshot(readers, entries, now).totalPages, 38);
assert.deepEqual(
  countedEntries(readers, entries, new Date('2026-09-28T12:00:00Z')).map((e) => e.id),
  ['e3', 'e2', 'e1'],
);

// Stats on Wednesday 30 Sept: 4 days (27 -> 30), empty days kept at 0.
let s = stats(readers, entries, now);
assert.deepEqual(
  s.days.map((d) => [d.date, d.pages, d.readers, d.total]),
  [
    ['2026-09-27', 30, 2, 30],
    ['2026-09-28', 5, 1, 35],
    ['2026-09-29', 0, 0, 35],
    ['2026-09-30', 3, 1, 38],
  ],
);
assert.equal(s.totalPages, 38);
assert.equal(s.target, 20000);
assert.equal(s.hours.length, 24);
assert.deepEqual(
  s.hours.filter((h) => h.additions).map((h) => [h.hour, h.additions, h.pages]),
  [
    [0, 1, 5],
    [8, 1, 3],
    [10, 1, 10],
    [23, 1, 20],
  ],
);
assert.deepEqual(s.week, { start: '2026-09-28', end: '2026-09-30', pages: 8 }, 'week = Monday to today');
assert.equal(s.averagePerDay, 9.5);
assert.deepEqual(s.bestDay, { date: '2026-09-27', pages: 30 });

// Sunday 27 Sept (first day, a Sunday): the week starts at the challenge start, not the Monday before.
s = stats(readers, entries, new Date('2026-09-27T21:59:30Z'));
assert.deepEqual(s.week, { start: '2026-09-27', end: '2026-09-27', pages: 30 });
assert.equal(s.days.length, 1);

// Before the start: nothing yet. After Christmas: 90 days, the last one is 25 Dec.
s = stats(readers, entries, new Date('2026-09-20T10:00:00Z'));
assert.deepEqual([s.days.length, s.totalPages, s.averagePerDay, s.bestDay], [0, 0, 0, null]);
s = stats(readers, entries, new Date('2026-12-28T10:00:00Z'));
assert.equal(s.days.length, 90);
assert.equal(s.days.at(-1).date, '2026-12-25');
assert.equal(s.days.at(-1).total, 38);
assert.equal(s.week.start, '2026-12-21', 'last week of the challenge');

// Summer time ends on 25 Oct: 23:30 UTC that night is 00:30 Paris on the 26th (hour 0), 22:30 UTC is 23:30 Paris.
const late = [entry('a', 4, '2026-10-26', '2026-10-25T23:30:00Z'), entry('a', 6, '2026-10-25', '2026-10-25T22:30:00Z')];
s = stats(readers, late, new Date('2026-10-26T12:00:00Z'));
assert.deepEqual(
  s.hours.filter((h) => h.additions).map((h) => h.hour),
  [0, 23],
);
assert.deepEqual(
  s.days.slice(-2).map((d) => d.pages),
  [6, 4],
);

// "Évolution": one day vs one day = 24 hours (hour of createdAt, Paris). Monday 28 Sept 12:30 Paris.
const nz = (pts) => pts.map((p, i) => p.pages && [i, p.pages]).filter(Boolean);
let v = series(
  readers,
  entries,
  { from: '2026-09-28', to: '2026-09-28', cmpFrom: '2026-09-27', cmpTo: '2026-09-27' },
  new Date('2026-09-28T10:30:00Z'),
);
assert.equal(v.granularity, 'hour');
assert.equal(v.current.length, 24);
assert.deepEqual(nz(v.current), [[0, 5]], '00:01 Paris is Monday hour 0; cancelled and deleted reader left out');
assert.deepEqual(
  nz(v.compare),
  [
    [10, 10],
    [23, 20],
  ],
  '23:59 Paris stays on Sunday',
);
assert.deepEqual([v.total, v.cmpTotal, v.cmpTotalToNow, v.live, v.hourNow], [5, 30, 10, true, 12]);
// No comparison: still hourly, no compare series.
v = series(readers, entries, { from: '2026-09-27', to: '2026-09-27' }, new Date('2026-09-28T10:30:00Z'));
assert.deepEqual([v.granularity, v.compare, v.cmpTotal, v.live, v.total], ['hour', null, null, false, 30]);
// Several days = one point per day; the comparison may start before the challenge (those days count 0).
v = series(readers, entries, { from: '2026-09-28', to: '2026-09-30', cmpFrom: '2026-09-25', cmpTo: '2026-09-27' }, now);
assert.equal(v.granularity, 'day');
assert.deepEqual(
  v.current.map((p) => [p.date, p.pages]),
  [
    ['2026-09-28', 5],
    ['2026-09-29', 0],
    ['2026-09-30', 3],
  ],
);
assert.deepEqual(
  v.compare.map((p) => p.pages),
  [0, 0, 30],
);
assert.deepEqual([v.total, v.cmpTotal, v.cmpTotalToNow], [8, 30, 10], 'running period: comparison up to Sun 12:00');
// One day against several days: daily on both sides, aligned from the start.
v = series(readers, entries, { from: '2026-09-30', to: '2026-09-30', cmpFrom: '2026-09-27', cmpTo: '2026-09-28' }, now);
assert.deepEqual([v.granularity, v.current.length, v.compare.length], ['day', 1, 2]);
// A finished period compares full totals.
v = series(readers, entries, { from: '2026-09-27', to: '2026-09-28', cmpFrom: '2026-09-29', cmpTo: '2026-09-30' }, now);
assert.deepEqual([v.live, v.total, v.cmpTotal, v.cmpTotalToNow], [false, 35, 3, 3]);
// Validation (the API turns these into 400).
for (const [q, msg] of [
  [{}, /dates invalides/],
  [{ from: '2026-9-28', to: '2026-09-28' }, /dates invalides/],
  [{ from: '2026-09-28', to: '2026-02-30' }, /dates invalides/],
  [{ from: '2026-09-29', to: '2026-09-28' }, /après/],
  [{ from: '2026-09-26', to: '2026-09-28' }, /27 septembre/],
  [{ from: '2026-09-28', to: '2026-10-01' }, /27 septembre/],
  [{ from: '2026-09-28', to: '2026-09-28', cmpFrom: '2026-09-29', cmpTo: '2026-10-01' }, /jours passés/],
  [{ from: '2026-09-28', to: '2026-09-28', cmpFrom: '2026-05-01', cmpTo: '2026-08-29' }, /120 jours/],
  [{ from: '2026-09-28', to: '2026-09-28', cmpFrom: '2026-09-27' }, /Comparaison : dates invalides/],
])
  assert.throws(() => series(readers, entries, q, now), msg, JSON.stringify(q));
// Presets, clamped to the challenge.
assert.deepEqual(periodRange('week', '2026-09-28'), ['2026-09-27', '2026-09-28']);
assert.deepEqual(periodRange('yesterday', '2026-09-27'), ['2026-09-27', '2026-09-27']);
assert.deepEqual(periodRange('month', '2026-11-19'), ['2026-10-21', '2026-11-19']);
assert.deepEqual(periodRange('all', '2026-12-28'), ['2026-09-27', '2026-12-25']);
assert.deepEqual(periodRange('today', '2026-12-28'), ['2026-12-25', '2026-12-25']);
assert.deepEqual(compareRange('previous', '2026-09-22', '2026-09-28'), ['2026-09-15', '2026-09-21']);
assert.deepEqual(compareRange('previous', '2026-09-28', '2026-09-28'), ['2026-09-27', '2026-09-27']);
assert.deepEqual(compareRange('week', '2026-10-05', '2026-10-06'), ['2026-09-28', '2026-09-29']);
assert.equal(compareRange('none', '2026-10-05', '2026-10-06'), null);

// Custom range calendar helpers.
{
  const sept = monthGrid('2026-09');
  assert.equal(sept.length % 7, 0);
  assert.deepEqual(sept.slice(0, 2), [null, '2026-09-01']); // 1 Sept 2026 is a Tuesday
  assert.equal(sept.filter(Boolean).length, 30);
  assert.equal(sept.indexOf('2026-09-28') % 7, 0); // Monday column
  assert.equal(monthGrid('2026-02').indexOf('2026-02-01'), 6); // Feb 2026 starts on a Sunday
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.deepEqual(rangeBounds('period', '2026-09-28'), ['2026-09-27', '2026-09-28']);
  assert.deepEqual(rangeBounds('compare', '2026-12-30'), ['', '2026-12-25']);
  let s = pickDay({ from: '2026-09-27', to: '2026-09-28', edit: 'new' }, '2026-09-28');
  assert.deepEqual(s, { from: '2026-09-28', to: '', edit: 'to' });
  assert.deepEqual(pickDay(s, '2026-09-27'), { from: '2026-09-27', to: '2026-09-28', edit: 'new' }); // swapped
  assert.deepEqual(pickDay(s, '2026-09-30'), { from: '2026-09-28', to: '2026-09-30', edit: 'new' });
  assert.deepEqual(pickDay({ from: '2026-09-27', to: '2026-09-30', edit: 'from' }, '2026-09-29').to, '2026-09-30');
  assert.deepEqual(pickDay({ from: '2026-09-27', to: '2026-09-28', edit: 'from' }, '2026-09-29'), {
    from: '2026-09-29',
    to: '',
    edit: 'to',
  });
}
console.log('OK — activity list and statistics checks passed');
