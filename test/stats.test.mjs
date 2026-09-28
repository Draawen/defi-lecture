// "Voir tout" list and statistics: same filters as the counter, Paris days (readDate) and Paris hours (createdAt).
import assert from 'node:assert/strict';
import { countedEntries, snapshot, stats } from '../public/domain.js';

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
assert.equal(s.target, 3000);
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

// Hour by hour at Monday 28 Sept 12:30 Paris: 23:59 Sunday is yesterday's last hour, 00:01 Monday today's first;
// the cancelled addition and the deleted reader's pages are left out. Yesterday up to 12:30 = the 10:00 reading only.
s = stats(readers, entries, new Date('2026-09-28T10:30:00Z'));
assert.equal(s.hourNow, 12);
assert.equal(s.todayByHour.length, 24);
assert.deepEqual(s.todayByHour.map((v, h) => v && [h, v]).filter(Boolean), [[0, 5]]);
assert.deepEqual(s.yesterdayByHour.map((v, h) => v && [h, v]).filter(Boolean), [
  [10, 10],
  [23, 20],
]);
assert.equal(s.yesterdayToNow, 10);
assert.equal(stats(readers, entries, new Date('2026-09-28T07:59:00Z')).yesterdayToNow, 0, 'before 10:00 Paris');

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

console.log('OK — activity list and statistics checks passed');
