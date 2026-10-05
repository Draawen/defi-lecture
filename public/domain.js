/** Pure shared domain logic (browser + API): calendar days, Paris midnight, streaks, validation. */
export const CONFIG = Object.freeze({
  startDate: '2026-09-27',
  endDate: '2026-12-25',
  timeZone: 'Europe/Paris',
  collectiveGoal: 20000,
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
        ...paliers(es, goalSchedule(p)),
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
// Leaderboards. The goal tab ranks Olympic-style: gold medals, then silver, then bronze, then the current palier.
export function ranked(participants, metric) {
  const score = (p) =>
    metric === 'pages'
      ? [p.pages]
      : metric === 'streak'
        ? [p.streak]
        : [p.medals[500], p.medals[300], p.medals[100], p.palierPages / p.goal];
  const cmp = (a, b) => {
    const x = score(a),
      y = score(b);
    return y.reduce((d, v, i) => d || v - x[i], 0);
  };
  const list = participants
    .filter((p) => (metric === 'streak' ? p.streak >= 2 : p.pages > 0))
    .sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name, 'fr'));
  let rank = 0;
  return list.slice(0, 5).map((p, i) => {
    if (!i || cmp(list[i - 1], p)) rank = i + 1;
    return { ...p, rank };
  });
}
// Once the common goal is reached, the counter aims at the next thousand (20 000 -> 21 000 -> 22 000...).
export function collectiveTarget(total) {
  return total < CONFIG.collectiveGoal ? CONFIG.collectiveGoal : Math.floor(total / 1000) * 1000 + 1000;
}
// Personal goals work in successive paliers: filling a palier up to its goal earns that tier's medal (100 bronze,
// 300 silver, 500 gold) and the excess carries into the next palier, which keeps the same goal by default.
// Old goals outside the three tiers (750, 1 000... from the former "Viser plus haut") count as 500.
export const tierGoal = (g) => (CONFIG.personalGoals.includes(Number(g)) ? Number(g) : CONFIG.personalGoals.at(-1));
// The goals a reader had over time, oldest first: [{ goal, at }] (at = ISO time it applies from). Saved in
// reader.goalHistory from the first change on; before that, the signup goal from createdAt. A legacy profile that
// raised its goal (startGoal != goal) keeps startGoal until its first completed palier: at = null marks that step.
export function goalSchedule(r) {
  if (r.goalHistory?.length) return r.goalHistory;
  const first = { goal: tierGoal(r.startGoal || r.goal), at: r.createdAt || '' };
  return r.startGoal && Number(r.startGoal) !== Number(r.goal)
    ? [first, { goal: tierGoal(r.goal), at: null }]
    : [first];
}
// Medals derived from the counted entries (a cancelled addition can take a medal back), walked oldest first with the
// goal in force at each entry's time. Returns the medal counts, the current palier and the cumulative figures.
export function paliers(entries, schedule) {
  const medals = { 100: 0, 300: 0, 500: 0 },
    goalAt = (t) =>
      schedule.reduce(
        (g, s) => (s.at === null ? (count ? tierGoal(s.goal) : g) : s.at <= t ? tierGoal(s.goal) : g),
        tierGoal(schedule[0].goal),
      );
  let done = 0,
    pages = 0,
    count = 0,
    goal = 0;
  const fill = (t) => {
    for (goal = goalAt(t); pages >= goal; goal = goalAt(t)) {
      medals[goal]++;
      count++;
      done += goal;
      pages -= goal;
    }
  };
  for (const e of [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    pages += Number(e.pages);
    fill(e.createdAt);
  }
  fill('9999'); // the goal in force now applies to the current palier
  return { pages: done + pages, goal, medals, palier: count + 1, palierPages: pages, done };
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

// "Évolution des pages lues": the chosen period against a comparison period (dates are Paris days, YYYY-MM-DD).
// One day on both sides -> 24 hourly points (hour of createdAt); otherwise one point per day (readDate).
const realDay = (d) =>
  typeof d === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) &&
  new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
function checkRange(from, to, what) {
  if (!realDay(from) || !realDay(to)) throw new Error(`${what} : dates invalides.`);
  if (from > to) throw new Error(`${what} : la date de début est après la date de fin.`);
  if (dayDiff(from, to) + 1 > 120) throw new Error(`${what} : 120 jours au maximum.`);
}
const lastDay = (today) => (today < CONFIG.endDate ? today : CONFIG.endDate);
export function series(readers, entries, { from, to, cmpFrom, cmpTo } = {}, now = new Date()) {
  const c = challengeState(now),
    last = lastDay(c.today),
    cmp = Boolean(cmpFrom || cmpTo);
  checkRange(from, to, 'Période');
  if (from < CONFIG.startDate || to > last)
    throw new Error('Période : choisis des jours entre le 27 septembre et aujourd’hui.');
  if (cmp) {
    checkRange(cmpFrom, cmpTo, 'Comparaison');
    if (cmpTo > last) throw new Error('Comparaison : choisis des jours passés.');
  }
  const list = countedEntries(readers, entries, now),
    hourly = from === to && (!cmp || cmpFrom === cmpTo),
    live = c.status === 'running' && to === c.today,
    elapsed = new Date(now).getTime() - parisMidnight(from);
  const points = (a, b) => {
    const out = [];
    if (hourly) for (let hour = 0; hour < 24; hour++) out.push({ date: a, hour, pages: 0 });
    else for (let d = a; d <= b; d = shiftDay(d, 1)) out.push({ date: d, pages: 0 });
    for (const e of list) {
      if (e.readDate < a || e.readDate > b) continue;
      out[hourly ? Number(parisParts(e.createdAt).hour) : dayDiff(a, e.readDate)].pages += Number(e.pages);
    }
    return out;
  };
  const current = points(from, to),
    compare = cmp ? points(cmpFrom, cmpTo) : null,
    total = current.reduce((t, p) => t + p.pages, 0),
    cmpTotal = compare ? compare.reduce((t, p) => t + p.pages, 0) : null;
  // While the period is still running, compare with the comparison period up to the same point in time.
  const cmpToNow =
    compare && live
      ? list
          .filter(
            (e) =>
              e.readDate >= cmpFrom &&
              e.readDate <= cmpTo &&
              Date.parse(e.createdAt) - parisMidnight(cmpFrom) <= elapsed,
          )
          .reduce((t, e) => t + Number(e.pages), 0)
      : cmpTotal;
  return {
    granularity: hourly ? 'hour' : 'day',
    from,
    to,
    cmpFrom: cmp ? cmpFrom : null,
    cmpTo: cmp ? cmpTo : null,
    today: c.today,
    live,
    hourNow: Number(parisParts(now).hour),
    current,
    compare,
    total,
    cmpTotal,
    cmpTotalToNow: cmpToNow,
  };
}
// Preset periods, clamped to the challenge (never before 27 Sept, never after today or 25 Dec).
export function periodRange(key, today) {
  const last = lastDay(today),
    back = (n) => (shiftDay(last, -n) < CONFIG.startDate ? CONFIG.startDate : shiftDay(last, -n));
  return {
    today: [last, last],
    yesterday: [back(1), back(1)],
    week: [back(6), last],
    month: [back(29), last],
    all: [CONFIG.startDate, last],
  }[key];
}
export function compareRange(key, from, to) {
  const n = dayDiff(from, to) + 1;
  return {
    previous: [shiftDay(from, -n), shiftDay(from, -1)],
    week: [shiftDay(from, -7), shiftDay(to, -7)],
    none: null,
  }[key];
}

// Custom range calendar (weeks start Monday; months are 'YYYY-MM').
export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number),
    t = y * 12 + m - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
// Days of the month padded with null to whole Monday-first weeks.
export function monthGrid(ym) {
  const first = `${ym}-01`,
    lead = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7,
    days = [];
  for (let d = first; d.slice(0, 7) === ym; d = shiftDay(d, 1)) days.push(d);
  const cells = [...Array(lead).fill(null), ...days];
  return [...cells, ...Array((7 - (cells.length % 7)) % 7).fill(null)];
}
// Selectable days: the period stays inside the challenge; the comparison may start earlier. Never after today.
export function rangeBounds(kind, today) {
  return [kind === 'period' ? CONFIG.startDate : '', lastDay(today)];
}
// One tap on a day. edit: 'new' starts a range, 'from'/'to' change that end; an end before the start swaps.
export function pickDay({ from, to, edit }, day) {
  if (edit === 'from' && to) return day <= to ? { from: day, to, edit: 'new' } : { from: day, to: '', edit: 'to' };
  if (edit !== 'to' || !from) return { from: day, to: '', edit: 'to' };
  return day < from ? { from: day, to: from, edit: 'new' } : { from, to: day, edit: 'new' };
}
