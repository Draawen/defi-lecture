/** Pure shared domain logic (browser + API): calendar days, Paris midnight, streaks, validation. */
export const CONFIG = Object.freeze({
  startDate: '2026-09-27',
  endDate: '2026-12-25',
  timeZone: 'Europe/Paris',
  collectiveGoal: 3000,
  personalGoals: [100, 300, 500],
});
const DAY = 86400000;
export function parisParts(value = new Date()) {
  const out = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone: CONFIG.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value)))
    if (p.type !== 'literal') out[p.type] = p.value;
  return out;
}
export function parisDate(value = new Date()) {
  const p = parisParts(value);
  return `${p.year}-${p.month}-${p.day}`;
}
export function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}
export function shiftDay(s, n) {
  return new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}
export function parisMidnight(date) {
  // Converge from UTC to the requested Paris midnight, including DST days.
  const target = Date.parse(date + 'T00:00:00Z');
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = parisParts(guess),
      asUTC = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const d = asUTC - target;
    if (!d) break;
    guess -= d;
  }
  return guess;
}
export function challengeState(now = new Date()) {
  const today = parisDate(now),
    duration = dayDiff(CONFIG.startDate, CONFIG.endDate) + 1;
  const status = today < CONFIG.startDate ? 'scheduled' : today > CONFIG.endDate ? 'finished' : 'running';
  const target = status === 'scheduled' ? parisMidnight(CONFIG.startDate) : parisMidnight(shiftDay(CONFIG.endDate, 1));
  return {
    ...CONFIG,
    today,
    status,
    duration,
    dayNumber: Math.min(duration, Math.max(0, dayDiff(CONFIG.startDate, today) + 1)),
    daysLeft: status === 'scheduled' ? duration : Math.max(0, dayDiff(today, CONFIG.endDate) + 1),
    daysUntilStart: Math.max(0, dayDiff(today, CONFIG.startDate)),
    deadline: target,
    serverTime: new Date(now).toISOString(),
  };
}
// A streak counts consecutive Paris days with a reading; it breaks at midnight at the end of the day after the last
// reading. The hourglass shows from 18 h after the last reading (6 h before the 24 h mark) until that break.
export function streakFor(entries, now = new Date()) {
  const c = challengeState(now),
    today = c.status === 'finished' ? CONFIG.endDate : c.today,
    at = c.status === 'finished' ? c.deadline : new Date(now).getTime();
  const live = entries.filter(
    (e) => !e.deletedAt && e.pages > 0 && e.readDate >= CONFIG.startDate && e.readDate <= today,
  );
  const dates = [...new Set(live.map((e) => e.readDate))].sort().reverse(),
    times = [...new Set(live.map((e) => e.createdAt))].sort().reverse();
  let streak = 0;
  if (dates.length && (dates[0] === today || dates[0] === shiftDay(today, -1))) {
    streak = 1;
    for (let i = 1; i < dates.length && dayDiff(dates[i], dates[i - 1]) === 1; i++) streak++;
  }
  const atRisk = c.status === 'running' && streak >= 2 && at >= Date.parse(times[0]) + DAY - 6 * 3600000;
  return { streak, atRisk, dates, times };
}
// Every page addition that counts (not cancelled, within the challenge, from a reader still in it), newest first,
// with the reader's name: the one rule shared by the counter, the recent activity, "Voir tout" and the statistics.
export function countedEntries(readers, entries, now = new Date()) {
  const today = challengeState(now).today,
    names = new Map(readers.filter((p) => !p.deletedAt).map((p) => [p.id, p.name]));
  return entries
    .filter(
      (e) =>
        !e.deletedAt &&
        names.has(e.participantId) &&
        e.readDate >= CONFIG.startDate &&
        e.readDate <= CONFIG.endDate &&
        e.readDate <= today,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map((e) => ({ ...e, name: names.get(e.participantId) }));
}
export function snapshot(readers, entries, now = new Date()) {
  readers = readers.filter((p) => !p.deletedAt); // deleted profiles and their pages leave the challenge
  const c = challengeState(now),
    valid = countedEntries(readers, entries, now);
  const byReader = new Map(readers.map((p) => [p.id, []]));
  for (const e of valid) byReader.get(e.participantId)?.push(e);
  const participants = readers
    .map((p) => {
      const es = byReader.get(p.id) || [],
        s = streakFor(es, now);
      return {
        id: p.id,
        name: p.name,
        goal: Number(p.goal),
        startGoal: Number(p.startGoal || p.goal),
        pages: es.reduce((s, e) => s + Number(e.pages), 0),
        // A reader's activity is the later of their signup and their most recent counted page addition;
        // no createdAt (legacy profile) counts as the oldest possible.
        lastActivity: [p.createdAt, s.times[0]].filter(Boolean).sort().at(-1) || '',
        ...s,
      };
    })
    // Most recently active first: whoever just added pages (or just signed up) jumps to the top.
    .sort(
      (a, b) =>
        b.lastActivity.localeCompare(a.lastActivity) || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
    );
  return {
    challenge: c,
    participants,
    totalPages: participants.reduce((s, p) => s + p.pages, 0),
    readerCount: participants.length,
    recentActivity: valid.slice(0, 8),
  };
}
// Statistics dashboard: one entry per Paris day from the start to today (by readDate), additions per Paris hour
// (by createdAt), and three key figures. "This week" is the calendar week, Monday to Sunday, Paris time.
export function stats(readers, entries, now = new Date()) {
  const c = challengeState(now),
    list = countedEntries(readers, entries, now),
    last = c.status === 'finished' ? CONFIG.endDate : c.today,
    days = [];
  if (c.status !== 'scheduled')
    for (let d = CONFIG.startDate; d <= last; d = shiftDay(d, 1))
      days.push({ date: d, pages: 0, readers: 0, total: 0 });
  const byDate = new Map(days.map((d) => [d.date, { day: d, who: new Set() }])),
    hours = Array.from({ length: 24 }, (_, hour) => ({ hour, additions: 0, pages: 0 }));
  for (const e of list) {
    const pages = Number(e.pages),
      d = byDate.get(e.readDate),
      h = hours[Number(parisParts(e.createdAt).hour)];
    d.day.pages += pages;
    d.who.add(e.participantId);
    h.additions++;
    h.pages += pages;
  }
  let total = 0;
  for (const d of days) {
    d.readers = byDate.get(d.date).who.size;
    d.total = total += d.pages;
  }
  const monday = shiftDay(last, -((new Date(`${last}T00:00:00Z`).getUTCDay() + 6) % 7)),
    weekStart = monday < CONFIG.startDate ? CONFIG.startDate : monday,
    best = days.reduce((b, d) => (d.pages > (b?.pages ?? 0) ? d : b), null);
  return {
    challenge: c,
    totalPages: total,
    target: collectiveTarget(total),
    days,
    hours,
    week: {
      start: weekStart,
      end: last,
      pages: days.filter((d) => d.date >= weekStart).reduce((s, d) => s + d.pages, 0),
    },
    averagePerDay: days.length ? Math.round((total / days.length) * 10) / 10 : 0,
    bestDay: best && { date: best.date, pages: best.pages },
  };
}
export function ranked(participants, metric) {
  // The goal ranking uses the starting goal, so raising your goal never lowers your rank.
  const score = (p) => (metric === 'pages' ? p.pages : metric === 'streak' ? p.streak : (p.pages / p.startGoal) * 100);
  const list = participants
    .filter((p) => (metric === 'streak' ? p.streak >= 2 : p.pages > 0))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, 'fr'));
  let rank = 0,
    previous = null;
  return list.slice(0, 5).map((p, i) => {
    const value = score(p);
    if (value !== previous) rank = i + 1;
    previous = value;
    return { ...p, rank, score: value };
  });
}
// Once the common goal is reached, the counter aims at the next thousand (3 000 -> 4 000 -> 5 000...).
export function collectiveTarget(total) {
  return total < CONFIG.collectiveGoal ? CONFIG.collectiveGoal : Math.floor(total / 1000) * 1000 + 1000;
}
// Personal goal steps: 100, 300, 500, 750, 1 000, then every 500 pages.
export function nextGoal(goal) {
  return [100, 300, 500, 750, 1000].find((n) => n > goal) ?? (Math.floor(goal / 500) + 1) * 500;
}
export function normalizedName(input) {
  const name = typeof input === 'string' ? input.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 32 || !/^[\p{L}\p{M} .’'\-]+$/u.test(name) || !/[\p{L}]/u.test(name))
    throw new Error('Entre un prénom de 1 à 32 caractères. Une initiale est possible.');
  return { name, key: name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').replace(/[’']/g, "'") };
}
export function validatePages(pages) {
  if (!Number.isInteger(pages) || pages < 1 || pages > 10000)
    throw new Error('Indique un nombre entier entre 1 et 10 000 pages.');
  return pages;
}
