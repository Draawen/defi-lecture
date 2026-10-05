import {
  CONFIG,
  collectiveTarget,
  parisDate,
  shiftDay,
  periodRange,
  compareRange,
  monthGrid,
  pickDay,
  rangeBounds,
  shiftMonth,
  challengeState,
  streakFor,
  ranked,
  normalizedName,
  validatePages,
} from './domain.js';

const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n);
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const MEDALS = [
  [500, '🥇', 'or'],
  [300, '🥈', 'argent'],
  [100, '🥉', 'bronze'],
];
// Earned medals, gold first; from 2 on, the count is written small under the medal.
function medalsHTML(p) {
  const got = MEDALS.filter(([g]) => p.medals[g]);
  if (!got.length) return '';
  const label = 'Médailles : ' + got.map(([g, , n]) => `${n} ×${p.medals[g]}`).join(', ');
  return `<span class="medals" role="img" title="${label}" aria-label="${label}">${got.map(([g, e]) => `<span class="medal">${e}${p.medals[g] > 1 ? `<small>${p.medals[g]}</small>` : ''}</span>`).join('')}</span>`;
}
// Progress in the current palier (the totals stay cumulative: completed goals + the current one).
const palierPct = (p) => (p.palierPages / p.goal) * 100;
const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
const SELECT_KEY = 'lecture-selected-v3';
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: selection is not remembered */
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* private mode: nothing was stored */
    }
  },
};
let state = null,
  tab = 'pages',
  selected = store.get(SELECT_KEY),
  clockBase = Date.now(),
  clockWall = Date.now(),
  activeProfile = null,
  profileRequest = 0,
  refreshing = false,
  toastTimer,
  phase = null;
function clock() {
  return new Date(clockBase + Date.now() - clockWall);
}
async function api(path, method = 'GET', body) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(path, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json', 'X-Challenge-Request': '1' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({ error: 'Le service ne répond pas correctement.' }));
    if (!r.ok) throw Error(d.error || 'Impossible d’enregistrer cette action.');
    return d;
  } catch (e) {
    if (e.name === 'AbortError')
      throw Error('La connexion est trop lente. Réessaie : le même envoi ne sera pas compté deux fois.');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
function initials(p) {
  return esc([...p.name][0]?.toUpperCase() || '?');
}
function tone(p) {
  const n = [...p.name].reduce((s, c) => s + c.codePointAt(0), 0);
  return ['', 'peach', 'gray', 'sand'][n % 4];
}
function avatar(p) {
  return `<span class="avatar ${tone(p)}" aria-hidden="true">${initials(p)}</span>`;
}
function dynamic(p) {
  return {
    ...p,
    ...streakFor(
      p.times.map((createdAt) => ({ createdAt, readDate: parisDate(createdAt), pages: 1 })),
      clock(),
    ),
  };
}
function streakBadge(p) {
  p = dynamic(p);
  return p.streak >= 2
    ? `<span class="streak-badge" title="${p.streak} jours d’affilée" aria-label="Série de ${p.streak} jours${p.atRisk ? ', bientôt perdue' : ''}">${p.streak}🔥${p.atRisk ? '<span class="hourglass" aria-hidden="true">⏳</span>' : ''}</span>`
    : '';
}
function dateLabel(iso) {
  const d = parisDate(iso),
    today = parisDate(clock());
  return d === today
    ? 'Aujourd’hui'
    : d === shiftDay(today, -1)
      ? 'Hier'
      : new Intl.DateTimeFormat('fr-FR', { timeZone: CONFIG.timeZone, day: 'numeric', month: 'short' }).format(
          new Date(iso),
        );
}
function timeLabel(iso) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: CONFIG.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}
function fullDate(iso) {
  return (
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: CONFIG.timeZone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso)) + ' (Paris)'
  );
}
// Before the start the mission card announces Sunday; the page counter only appears once the challenge runs.
function renderPhase(c) {
  if (c.status === phase) return;
  phase = c.status;
  const scheduled = phase === 'scheduled';
  $('#mission-title').textContent = scheduled ? 'Départ dimanche 27 septembre.' : 'Notre objectif, ensemble.';
  $('.mission').classList.toggle('is-scheduled', scheduled);
  $('#day-chip').hidden = scheduled;
  // From Sunday on, the counter and the readers come first: no header, intro or rules.
  document.documentElement.classList.toggle('is-live', !scheduled);
  $('#launch-note').hidden = !scheduled;
  $('#live-counter').hidden = scheduled;
  $('#global-percent').hidden = scheduled;
}
function renderClock() {
  if (!state) return;
  const c = challengeState(clock()),
    started = c.status === 'running',
    scheduled = c.status === 'scheduled';
  if (c.status !== phase) {
    renderPhase(c);
    render();
    return;
  }
  $('#challenge-status').textContent = scheduled ? 'INSCRIPTIONS OUVERTES' : started ? 'EN COURS' : 'TERMINÉ';
  $('#day-chip').textContent = `Jour ${c.dayNumber} / 90`;
  $('#countdown-eyebrow').textContent = scheduled
    ? 'LE GRAND DÉPART'
    : started
      ? 'IL RESTE ENCORE'
      : 'LE DÉFI EST TERMINÉ';
  $('#countdown-value').textContent = scheduled ? `J-${c.daysUntilStart}` : started ? `J-${c.daysLeft}` : 'Bravo !';
  const seconds = Math.max(0, Math.floor((c.deadline - clock().getTime()) / 1000)),
    values = [
      Math.floor(seconds / 86400),
      Math.floor((seconds % 86400) / 3600),
      Math.floor((seconds % 3600) / 60),
      seconds % 60,
    ];
  ['days', 'hours', 'minutes', 'seconds'].forEach(
    (part, i) => ($('#time-' + part).textContent = String(values[i]).padStart(2, '0')),
  );
}
function render() {
  // While the challenge runs, the counter aims at the next thousand once 20 000 is reached.
  const target = phase === 'running' ? collectiveTarget(state.totalPages) : CONFIG.collectiveGoal,
    pct = (state.totalPages / target) * 100,
    step = target / 30,
    scheduled = phase === 'scheduled';
  $('#global-total').textContent = fmt(state.totalPages);
  $('#global-target').textContent = fmt(target);
  $('#global-percent').textContent = Math.round(pct) + ' %';
  $('#readers-count').textContent = state.readerCount;
  $('#reader-stat').textContent =
    `${state.readerCount} ${scheduled ? `inscrit${state.readerCount === 1 ? '' : 's'}` : `lecteur${state.readerCount === 1 ? '' : 's'}`}`;
  $('#pages-remaining').textContent = scheduled
    ? ''
    : state.totalPages < CONFIG.collectiveGoal
      ? `Encore ${fmt(CONFIG.collectiveGoal - state.totalPages)} pages.`
      : phase === 'running'
        ? `Palier ${fmt(target - 1000)} atteint ! Encore ${fmt(target - state.totalPages)} pages pour ${fmt(target)}.`
        : 'Objectif atteint !';
  const bar = $('#global-progress');
  bar.setAttribute('aria-valuemax', target);
  bar.setAttribute('aria-valuenow', Math.min(target, state.totalPages));
  bar.setAttribute('aria-valuetext', `${fmt(state.totalPages)} pages sur ${fmt(target)}, ${Math.round(pct)} pour cent`);
  if (!bar.children.length) bar.innerHTML = '<span class="segment" aria-hidden="true"><i></i></span>'.repeat(30);
  [...bar.children].forEach((s, i) => {
    s.title = `${fmt(Math.round(i * step))} à ${fmt(Math.round((i + 1) * step))} pages`;
    s.firstElementChild.style.width = Math.min(100, Math.max(0, ((state.totalPages - i * step) / step) * 100)) + '%';
  });
  $$('[data-action=join]').forEach((b) => (b.disabled = state.challenge.status === 'finished'));
  $('#stats-cta').hidden = scheduled;
  renderClock();
  renderPeople();
  renderActivity();
  renderLeaders();
}
function renderPeople() {
  if (!state) return;
  $('.reader-toolbar').hidden = !state.participants.length;
  const q = $('#search').value.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const ps = state.participants.filter((p) => p.name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(q));
  $('#people-grid').innerHTML = ps.length
    ? ps
        .map(
          (p) =>
            `<button class="person ${p.id === selected ? 'selected' : ''}" data-person="${esc(p.id)}" aria-label="${esc(p.name)}, ${p.pages} pages sur ${p.done + p.goal}. Ouvrir son espace"><div class="person-line">${avatar(p)}<div class="person-title"><div class="person-name">${esc(p.name)}</div>${p.id === selected ? '<div class="person-you">moi</div>' : ''}</div>${streakBadge(p)}</div><div class="person-data"><span><strong>${fmt(p.pages)}</strong> / ${fmt(p.done + p.goal)} p.</span><span class="person-status">${medalsHTML(p)}<span>${Math.floor(palierPct(p))} %</span></span></div><div class="mini"><i style="width:${palierPct(p)}%"></i></div></button>`,
        )
        .join('')
    : `<p class="empty-state">${q ? 'Aucun prénom trouvé.' : 'Aucun inscrit pour l’instant.'}</p>`;
}
function activityRow(e) {
  return `<button class="activity-row" data-person="${esc(e.participantId)}" aria-label="Voir les lectures de ${esc(e.name)}">${avatar(e)}<div><strong>${esc(e.name)}</strong><div class="activity-detail">a ajouté <b>+${fmt(e.pages)} pages</b></div></div><span class="activity-time" title="${esc(fullDate(e.createdAt))}">${dateLabel(e.createdAt)}<time datetime="${esc(e.createdAt)}">${timeLabel(e.createdAt)}</time></span></button>`;
}
function renderActivity() {
  $('#see-all').hidden = !state.recentActivity.length;
  $('#activity-list').innerHTML = state.recentActivity.length
    ? state.recentActivity.slice(0, 7).map(activityRow).join('')
    : `<p class="empty-state">${phase === 'scheduled' ? 'Premiers ajouts dimanche.' : 'Aucun ajout pour l’instant.'}</p>`;
}
function renderLeaders() {
  if (!state) return;
  const ps = ranked(state.participants.map(dynamic), tab);
  $('#leaders').setAttribute('aria-labelledby', 'tab-' + tab);
  $('#leaders').innerHTML = ps.length
    ? ps
        .map(
          (p) =>
            `<button class="leader-row" data-person="${esc(p.id)}"><span class="rank">${String(p.rank).padStart(2, '0')}</span>${avatar(p)}<span class="leader-name">${esc(p.name)}</span><span class="leader-value">${tab === 'pages' ? fmt(p.pages) + ' p.' : tab === 'streak' ? `${p.streak}🔥${p.atRisk ? '⏳' : ''}` : `${medalsHTML(p)}${Math.floor(palierPct(p))} %`}</span></button>`,
        )
        .join('')
    : `<p class="empty-state">${tab === 'streak' ? 'Aucune série pour l’instant.' : 'Aucune lecture pour l’instant.'}</p>`;
  const caption = tab === 'goal' ? 'Classés par médailles, puis par avancée du palier en cours.' : '';
  $('#leader-caption').textContent = caption;
  $('#leader-caption').hidden = !caption;
}
function showDialog(html, full = false) {
  $('#dialog').classList.toggle('dialog-full', full);
  $('#dialog-body').innerHTML = html;
  if (!$('#dialog').open) $('#dialog').showModal();
}
function showJoin() {
  activeProfile = null;
  profileRequest++;
  showDialog(
    `<h2 id="dialog-title">Je me lance.</h2><form id="join-form"><label class="field-label" for="join-name">Ton prénom</label><input id="join-name" class="field" name="name" autocomplete="given-name" required maxlength="32" placeholder="Ex. Camille"><label class="field-label">Ton objectif sur 90 jours</label><div class="goals" role="group" aria-label="Choisir mon objectif">${[
      [100, '🥉'],
      [300, '🥈'],
      [500, '🥇'],
    ]
      .map(
        ([n, e]) =>
          `<label class="goal"><input type="radio" name="goal" value="${n}" required aria-label="${n} pages"><span>${e}<b>${n}</b><small>pages</small></span></label>`,
      )
      .join(
        '',
      )}</div><p class="hint">Ton prénom et tes pages seront visibles par tous.</p><div class="form-error" role="alert" hidden></div><button class="button button-green full" type="submit">C’est parti ${icon('arrow')}</button></form>`,
  );
}
function weekHTML(p) {
  const today = parisDate(clock()),
    ref = today < CONFIG.startDate ? CONFIG.startDate : today > CONFIG.endDate ? CONFIG.endDate : today,
    sunday = shiftDay(ref, -new Date(ref + 'T12:00:00Z').getUTCDay());
  const day = (d, o) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...o }).format(new Date(d + 'T12:00:00Z'));
  return `<div class="week" aria-label="Semaine du ${day(sunday, { day: 'numeric', month: 'long' })}, de dimanche à samedi">${Array.from(
    { length: 7 },
    (_, i) => shiftDay(sunday, i),
  )
    .map((d) => {
      const read = p.dates.includes(d),
        off = d > today || d < CONFIG.startDate || d > CONFIG.endDate;
      return `<span class="week-day ${read ? 'read' : ''} ${d === today ? 'today' : ''} ${off ? 'off' : ''}" title="${day(d, { weekday: 'long', day: 'numeric', month: 'long' })} : ${read ? 'lecture enregistrée' : d > today && d <= CONFIG.endDate ? 'à venir' : off ? 'hors défi' : 'pas de lecture'}">${day(d, { weekday: 'short' }).slice(0, 2)}<i aria-hidden="true">${read ? '✓' : off ? '' : '·'}</i></span>`;
    })
    .join('')}</div>`;
}
function calendarHTML(p) {
  const today = parisDate(clock()),
    read = new Set(p.dates),
    months = [],
    dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
  const fmtUTC = (d, o) =>
    new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...o }).format(new Date(d + 'T12:00:00Z'));
  for (let d = CONFIG.startDate; d <= CONFIG.endDate; d = shiftDay(d, 1)) {
    if (months.at(-1)?.key !== d.slice(0, 7)) months.push({ key: d.slice(0, 7), days: [] });
    months.at(-1).days.push(d);
  }
  return `<div class="calendar">${months
    .map(({ key, days }) => {
      let cells = '';
      for (
        let d = shiftDay(days[0], -dow(days[0]));
        d <= shiftDay(days.at(-1), 6 - dow(days.at(-1)));
        d = shiftDay(d, 1)
      ) {
        if (d.slice(0, 7) !== key) {
          cells += '<span></span>';
          continue;
        }
        const isRead = read.has(d),
          off = d < CONFIG.startDate || d > CONFIG.endDate || d > today;
        cells += `<span class="cal-day ${isRead ? 'read' : off ? 'off' : ''} ${d === today ? 'today' : ''}" title="${fmtUTC(d, { weekday: 'long', day: 'numeric', month: 'long' })} : ${isRead ? 'lu' : off ? 'à venir' : 'pas lu'}">${Number(d.slice(8))}</span>`;
      }
      const name = fmtUTC(days[0], { month: 'long' });
      return `<div class="cal-month"><b>${name[0].toUpperCase() + name.slice(1)}</b><div class="cal-grid">${['di', 'lu', 'ma', 'me', 'je', 've', 'sa'].map((x) => `<i>${x}</i>`).join('')}${cells}</div></div>`;
    })
    .join('')}</div>`;
}
function historyHTML(p, limit = 7) {
  return (
    p.entries
      .slice(0, limit)
      .map(
        (e) =>
          `<div class="history-row"><div><strong>+${fmt(e.pages)} pages</strong><small><time datetime="${esc(e.createdAt)}" title="${esc(fullDate(e.createdAt))}">${dateLabel(e.createdAt)} · ${timeLabel(e.createdAt)}</time></small></div>${state.challenge.status === 'running' ? `<button type="button" data-delete="${esc(e.id)}" data-owner="${esc(p.id)}" aria-label="Annuler l’ajout de ${e.pages} pages">Annuler</button>` : ''}</div>`,
      )
      .join('') || '<p class="hint">Rien pour l’instant.</p>'
  );
}
// The header shows the name with a "Modifier" button (until the end); in edit mode it becomes the name form.
function profileHead(p, editing, c) {
  return editing
    ? `<form id="name-form" class="name-form" data-id="${esc(p.id)}"><label class="field-label" id="dialog-title" for="name-input">Ton prénom</label><input class="field name-field" id="name-input" name="name" value="${esc(p.name)}" required maxlength="32" autocomplete="off" autocapitalize="words" spellcheck="false"><div class="form-error" role="alert" hidden></div><div class="edit-actions"><button class="button button-green" type="submit">Enregistrer</button><button class="button button-outline" type="button" data-action="edit-cancel">Annuler</button></div><button type="button" class="delete-profile" data-action="delete-profile">Supprimer ce profil</button></form>`
    : `<div class="profile-head"><h2 id="dialog-title">${esc(p.name)}${streakBadge(p)}</h2>${c.status === 'finished' ? '' : `<button type="button" class="edit-name" data-action="edit-name" aria-label="Modifier le profil">${icon('edit')}Modifier</button>`}</div>`;
}
// "Changer d'objectif": the three tiers for the current palier, except a goal it has already passed.
function goalChoiceHTML(p) {
  const passed = (g) => g !== p.goal && g <= p.palierPages;
  return `<button type="button" class="button button-outline full goal-change" data-action="goal-choices" aria-expanded="false" aria-controls="goal-choices">${icon('medal')}Changer d’objectif</button><div id="goal-choices" hidden><div class="goals" role="group" aria-label="Choisir mon objectif">${[
    ...MEDALS,
  ]
    .reverse()
    .map(
      ([g, e]) =>
        `<button type="button" class="goal" data-action="set-goal" data-id="${esc(p.id)}" data-goal="${g}"${g === p.goal ? ' aria-current="true" disabled' : passed(g) ? ' disabled' : ''}><span>${e}<b>${g}</b><small>${g === p.goal ? 'actuel' : passed(g) ? 'déjà dépassé' : 'pages'}</small></span></button>`,
    )
    .join(
      '',
    )}</div>${CONFIG.personalGoals.some(passed) ? `<p class="hint">Tu as déjà lu ${p.palierPages} pages dans ce palier : choisis un objectif plus haut.</p>` : ''}<div class="form-error" role="alert" hidden></div></div>`;
}
function renderProfile(p, editing = false) {
  p = dynamic(p);
  const c = challengeState(clock());
  activeProfile = p;
  showDialog(
    `${profileHead(p, editing, c)}<div class="profile-palier"><span>Palier ${p.palier} · objectif ${fmt(p.goal)} pages</span>${medalsHTML(p)}</div><div class="profile-total">${fmt(p.pages)} <small>/ ${fmt(p.done + p.goal)} pages</small></div><div class="mini profile-progress" role="progressbar" aria-label="Progression de ${esc(p.name)} dans le palier ${p.palier}" aria-valuemin="0" aria-valuemax="${p.goal}" aria-valuenow="${p.palierPages}"><i style="width:${palierPct(p)}%"></i></div><div class="profile-caption"><span>Encore ${plural(p.goal - p.palierPages, 'page')}.</span><span>${Math.floor(palierPct(p))} %</span></div>${c.status === 'finished' ? '' : goalChoiceHTML(p)}<div class="profile-streak"><strong>Cette semaine</strong>${weekHTML(p)}<button type="button" class="cal-toggle" data-action="calendar" aria-expanded="false" aria-controls="profile-calendar">Voir les 90 jours</button><div id="profile-calendar" hidden>${calendarHTML(p)}</div></div>${c.status === 'running' ? `<form id="pages-form" data-id="${esc(p.id)}" data-request="${uid()}"><label class="field-label" for="pages-input">Nouvelles pages lues (pas ton total)</label><div class="quick"><input class="field" id="pages-input" name="pages" type="number" inputmode="numeric" min="1" max="10000" step="1" required placeholder="Ex. 12"><button class="button button-green" type="submit">Ajouter</button></div><div class="form-error" role="alert" hidden></div></form>` : `<p class="profile-info">${c.status === 'scheduled' ? 'Ajout des pages à partir de dimanche.' : 'Le défi est terminé. Merci !'}</p>`}<div class="history"><h3>Historique</h3><div id="profile-history">${historyHTML(p)}</div>${p.entries.length > 7 ? `<button class="more-history" data-action="more-history">Tout voir (${p.entries.length})</button>` : ''}</div>`,
  );
}
async function openProfile(id) {
  const n = ++profileRequest;
  const { participant } = await api('/api/profile?id=' + encodeURIComponent(id));
  if (n !== profileRequest) return;
  selected = id;
  store.set(SELECT_KEY, id);
  renderPeople();
  renderProfile(participant);
}
// "Voir tout": every counted addition since the start, newest first.
async function showAllActivity() {
  const n = ++profileRequest;
  showDialog('<h2 id="dialog-title">Tous les ajouts</h2><p class="empty-state">Chargement…</p>');
  const { entries } = await api('/api/activity');
  if (n !== profileRequest) return;
  const pages = entries.reduce((t, e) => t + e.pages, 0);
  showDialog(
    `<h2 id="dialog-title">Tous les ajouts</h2><p class="dialog-sub">${plural(entries.length, 'ajout')} · ${plural(pages, 'page')} depuis le 27 septembre</p><div class="activity-list all-activity">${entries.map(activityRow).join('') || '<p class="empty-state">Aucun ajout pour l’instant.</p>'}</div>`,
  );
}

// Statistics: series computed by the server (/api/stats), drawn here as plain SVG.
const dayShort = (date, weekday = true) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    weekday: weekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T12:00:00Z`));
const plural = (n, word) => `${fmt(n)} ${word}${n > 1 ? 's' : ''}`;
const dayName = (d) => (d.date === state?.challenge.today ? 'Aujourd’hui' : dayShort(d.date));
const dayTip = (d) => `${dayName(d)} : ${plural(d.pages, 'page')}`;
const readersTip = (d) => `${dayName(d)} : ${plural(d.readers, 'lecteur')}`;
const hourTip = (h) =>
  `Entre ${h.hour} h et ${(h.hour + 1) % 24} h : ${plural(h.additions, 'ajout')}, ${plural(h.pages, 'page')}`;
const peakHour = (hours) => hours.reduce((b, h) => (h.additions > b.additions ? h : b), hours[0]);
function dayAxis(d, i) {
  const day = d.date.slice(8);
  return i === 0 || day === '01' ? dayShort(d.date, false).replace('.', '') : String(Number(day));
}
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}
// Bar chart: fixed y axis on the left, bars in a strip that scrolls sideways when there are too many to fit.
function barChart(items, width, { color, label, tip, selected = items.length - 1, minSlot = 12, maxSlot = 44 }) {
  const H = 150,
    top = 12,
    base = H - 22,
    axis = 30,
    max = niceMax(Math.max(1, ...items.map((d) => d.v))),
    slot = Math.min(maxSlot, Math.max(minSlot, (width - axis) / items.length)),
    W = Math.max(width - axis, items.length * slot),
    y = (v) => base - (v / max) * (base - top),
    bw = Math.max(4, Math.min(26, slot * 0.66)),
    every = Math.ceil(30 / slot),
    levels = [0, max / 2, max];
  const grid = levels
    .map((v) => `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid${v ? '' : ' base'}"/>`)
    .join('');
  const ticks = levels.map((v) => `<text x="${axis - 6}" y="${y(v) + 3}">${fmt(v)}</text>`).join('');
  const bars = items
    .map((d, i) => {
      const x = i * slot + (slot - bw) / 2,
        h = base - y(d.v),
        text =
          i % every === 0
            ? `<text x="${i ? i * slot + slot / 2 : x}" y="${H - 6}"${i ? '' : ' style="text-anchor:start"'}>${esc(label(d, i))}</text>`
            : '';
      return `<g class="bar${i === selected ? ' on' : ''}" data-tip="${esc(tip(d))}" style="--c:${color}"><rect class="hit" x="${i * slot}" y="0" width="${slot}" height="${H}"/>${d.v ? `<rect class="fill" x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="${Math.min(4, bw / 3)}"/>` : ''}${text}</g>`;
    })
    .join('');
  return `<div class="chart"><svg class="chart-axis" width="${axis}" height="${H}" aria-hidden="true">${ticks}</svg><div class="chart-scroll"><svg width="${W}" height="${H}">${grid}${bars}</svg></div></div>`;
}
// Cumulative pages over the whole challenge (27 Sept - 25 Dec), with the collective target and a steady pace.
function cumulativeChart(s, width) {
  const H = 150,
    top = 16,
    base = H - 22,
    left = 6,
    right = width - 6,
    n = s.challenge.duration,
    max = Math.max(s.target, s.totalPages),
    x = (i) => left + (i / (n - 1)) * (right - left),
    y = (v) => base - (v / max) * (base - top),
    pts = s.days.map((d, i) => `${x(i).toFixed(1)},${y(d.total).toFixed(1)}`),
    last = s.days.length - 1;
  const area = `<path class="cum-area" d="M${x(0)},${base} L${pts.join(' L')} L${x(last)},${base} Z"/>`;
  return `<div class="chart"><svg width="${width}" height="${H}" class="cum" role="img" aria-label="${fmt(s.totalPages)} pages sur ${fmt(s.target)}"><line class="grid base" x1="0" x2="${width}" y1="${base}" y2="${base}"/><line class="target" x1="0" x2="${width}" y1="${y(s.target)}" y2="${y(s.target)}"/><text class="target-label" x="${right}" y="${y(s.target) - 6}" text-anchor="end">Objectif ${fmt(s.target)}</text><line class="pace" x1="${x(0)}" y1="${base}" x2="${x(n - 1)}" y2="${y(s.target)}"/>${area}<polyline class="cum-line" points="${pts.join(' ')}"/><circle class="cum-dot" cx="${x(last)}" cy="${y(s.days[last].total)}" r="4"/><text class="cum-value" x="${Math.min(x(last) + 8, right - 40)}" y="${y(s.days[last].total) + (s.totalPages > 0.8 * s.target ? 18 : -8)}">${fmt(s.totalPages)}</text><text class="x-label" x="${left}" y="${H - 6}">27 sept.</text><text class="x-label" x="${right}" y="${H - 6}" text-anchor="end">25 déc.</text></svg></div>`;
}
// Monotone cubic curve (Fritsch-Carlson, like d3's curveMonotoneX): never overshoots, never dips below 0.
// Returns one "C" command per segment so a curve can be split (solid part + dotted current hour).
function monotoneSegments(pts) {
  const n = pts.length,
    m = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / (p[0] - pts[i][0])),
    t = pts.map((_, i) => (i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (!m[i]) {
      t[i] = t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i],
      b = t[i + 1] / m[i],
      q = a * a + b * b;
    if (q > 9) {
      t[i] = (3 / Math.sqrt(q)) * a * m[i];
      t[i + 1] = (3 / Math.sqrt(q)) * b * m[i];
    }
  }
  return pts.slice(1).map((p, i) => {
    const [x0, y0] = pts[i],
      h = (p[0] - x0) / 3;
    return `C${(x0 + h).toFixed(1)},${(y0 + t[i] * h).toFixed(1)} ${(p[0] - h).toFixed(1)},${(p[1] - t[i + 1] * h).toFixed(1)} ${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  });
}
const hh = (h) => String(h).padStart(2, '0') + ' h';
// "Évolution des pages lues", Shopify-like: a period against a comparison period. The last choice is kept in
// memory for the session; preset ranges are recomputed from today's date each time.
const PERIODS = {
  today: 'Aujourd’hui',
  yesterday: 'Hier',
  week: '7 derniers jours',
  month: '30 derniers jours',
  all: 'Depuis le début',
  custom: 'Plage personnalisée',
};
const COMPARES = {
  previous: 'Période précédente',
  week: 'Même période la semaine dernière',
  none: 'Aucune comparaison',
  custom: 'Plage personnalisée',
};
const evo = {
  period: 'today',
  compare: 'previous',
  from: '',
  to: '',
  cmpFrom: '',
  cmpTo: '',
  sheet: null,
  custom: false,
  data: null,
};
const evoToday = () => challengeState(clock()).today;
function rangeLabel(a, b) {
  if (a === b) return dayShort(a);
  return a.slice(0, 7) === b.slice(0, 7)
    ? `${Number(a.slice(8))}–${dayShort(b, false)}`
    : `${dayShort(a, false)} – ${dayShort(b, false)}`;
}
function evoRanges() {
  if (evo.period !== 'custom') [evo.from, evo.to] = periodRange(evo.period, evoToday());
  if (evo.compare !== 'custom') [evo.cmpFrom, evo.cmpTo] = compareRange(evo.compare, evo.from, evo.to) || ['', ''];
}
async function loadEvolution() {
  evoRanges();
  const q = new URLSearchParams({ from: evo.from, to: evo.to });
  if (evo.cmpFrom) (q.set('cmpFrom', evo.cmpFrom), q.set('cmpTo', evo.cmpTo));
  evo.data = await api('/api/series?' + q);
  renderEvolution();
}
function sheetHTML(kind) {
  const period = kind === 'period',
    names = period ? PERIODS : COMPARES,
    current = period ? evo.period : evo.compare;
  const options = Object.entries(names)
    .map(([key, name]) => {
      const r = key === 'custom' ? null : period ? periodRange(key, evoToday()) : compareRange(key, evo.from, evo.to),
        off = period && key === 'yesterday' && evoToday() <= CONFIG.startDate;
      return `<button type="button" class="sheet-option${key === current ? ' on' : ''}" data-action="range-pick" data-kind="${kind}" data-key="${key}"${off ? ' disabled' : ''}><span>${name}</span>${r ? `<small>${rangeLabel(r[0], r[1])}</small>` : ''}</button>`;
    })
    .join('');
  return `<div class="range-sheet${evo.custom ? ' rc-open' : ''}" role="group" aria-label="${period ? 'Choisir la période' : 'Choisir la comparaison'}"><div class="sheet-options"><p class="sheet-title">${period ? 'Période' : 'Comparer à'}</p>${options}</div>${evo.custom ? calHTML(kind) : ''}</div>`;
}
// Custom range: Shopify-like calendar (two months side by side on wide screens, one on phones).
const dayLong = (d) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${d}T12:00:00Z`),
  );
const monthName = (ym) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
    new Date(`${ym}-01T12:00:00Z`),
  );
const calMonths = () => (matchMedia('(min-width: 640px)').matches ? 2 : 1);
// First month shown: the one of the selection, without showing only future months or months before the start.
function calStart(kind, ref) {
  const [min, max] = rangeBounds(kind, evoToday()),
    last = shiftMonth(max.slice(0, 7), 1 - calMonths());
  let m = (ref || max).slice(0, 7);
  if (m > last) m = last;
  return min && m < min.slice(0, 7) ? min.slice(0, 7) : m;
}
function calHTML(kind) {
  const p = evo.pick,
    [min, max] = rangeBounds(kind, evoToday()),
    today = evoToday(),
    n = calMonths(),
    end = p.to || p.from,
    band = p.to && p.from !== p.to;
  const field = (key, label) =>
    `<button type="button" class="rc-field${p.edit === key ? ' on' : ''}" data-action="range-end" data-end="${key}" aria-label="${label}${p[key] ? ' : ' + dayLong(p[key]) : ''}">${p[key] ? dayLong(p[key]) : `<span>${label}</span>`}</button>`;
  const day = (d) => {
    if (!d) return '<span></span>';
    const cls = [
      d === p.from && 'start',
      d === end && 'end',
      p.to && d > p.from && d < p.to && 'in',
      band && (d === p.from || d === p.to) && 'band',
      d === today && 'today',
    ].filter(Boolean);
    return `<button type="button" class="rc-day ${cls.join(' ')}" data-action="range-day" data-date="${d}" aria-label="${dayLong(d)}" aria-pressed="${Boolean(p.from) && d >= p.from && d <= end}"${(min && d < min) || d > max ? ' disabled' : ''}><span>${Number(d.slice(8))}</span></button>`;
  };
  const months = Array.from({ length: n }, (_, i) => shiftMonth(p.month, i))
    .map(
      (ym) =>
        `<div class="rc-month"><p class="rc-title">${monthName(ym)}</p><div class="rc-grid">${['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((w) => `<span class="rc-wd">${w}</span>`).join('')}${monthGrid(ym).map(day).join('')}</div></div>`,
    )
    .join('');
  const arrow = (step, label, off) =>
    `<button type="button" class="rc-nav ${step < 0 ? 'prev' : 'next'}" data-action="range-month" data-step="${step}" aria-label="${label}"${off ? ' disabled' : ''}>${step < 0 ? '‹' : '›'}</button>`;
  return `<div class="custom-range"><div class="rc-fields">${field('from', 'Début')}<span aria-hidden="true">→</span>${field('to', 'Fin')}</div><div class="rc-months">${arrow(-1, 'Mois précédent', min && p.month <= min.slice(0, 7))}${arrow(1, 'Mois suivant', shiftMonth(p.month, n - 1) >= max.slice(0, 7))}${months}</div><p class="form-error" role="alert" hidden></p><div class="sheet-actions"><button type="button" class="button button-outline" data-action="range-cancel">Annuler</button><button type="button" class="button button-green" data-action="range-apply" data-kind="${kind}"${p.from && p.to ? '' : ' disabled'}>Appliquer</button></div></div>`;
}
function renderCal(focus) {
  $('.custom-range').outerHTML = calHTML(evo.sheet);
  if (focus) $(focus)?.focus();
}
function evoSummary(d) {
  const total = `<b>${plural(d.total, 'page')}</b>`;
  if (!d.compare) return total;
  const base = d.live ? d.cmpTotalToNow : d.cmpTotal,
    yesterday = d.granularity === 'hour' && d.cmpFrom === shiftDay(d.from, -1),
    when = d.live ? (d.granularity === 'hour' ? ' à la même heure' : ' au même moment') : '';
  if (!base) return `${total} · aucune page ${yesterday ? 'hier' : 'sur la période comparée'}${when}`;
  const pct = Math.round(((d.total - base) / base) * 100);
  return `${total} · ${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)} % par rapport à ${yesterday ? 'hier' : 'la période comparée'}${when}`;
}
function renderEvolution() {
  const box = $('#evolution');
  if (!box) return;
  const d = evo.data,
    pill = (kind) =>
      `<button type="button" class="range-pill${evo.sheet === kind ? ' open' : ''}" data-action="range-open" data-kind="${kind}" aria-expanded="${evo.sheet === kind}">${kind === 'period' ? `${icon('calendar')}${evo.period === 'custom' ? rangeLabel(evo.from, evo.to) : PERIODS[evo.period]}` : `vs ${evo.compare === 'custom' ? rangeLabel(evo.cmpFrom, evo.cmpTo) : COMPARES[evo.compare]}`}</button>`;
  const uneven = d?.compare && d.compare.length !== d.current.length;
  box.innerHTML = `<section class="stat-card evo-card"><h3>Évolution des pages lues</h3><div class="range-pills">${pill('period')}${pill('compare')}</div>${evo.sheet ? sheetHTML(evo.sheet) : ''}${
    d
      ? `<p class="stat-sub">${evoSummary(d)}</p><div class="evo-chart"></div><p class="legend"><span><i class="dot-today"></i>${rangeLabel(d.from, d.to)}</span>${d.compare ? `<span><i class="dot-yesterday"></i>${rangeLabel(d.cmpFrom, d.cmpTo)}</span>` : ''}</p>${uneven ? '<p class="evo-note">Les deux périodes n’ont pas la même durée : elles sont comparées jour par jour depuis leur début.</p>' : ''}`
      : '<p class="stat-sub">Chargement…</p>'
  }</section>`;
  const el = box.querySelector('.evo-chart');
  if (el) {
    el.innerHTML = evoChart(d, el.clientWidth);
    evoHover(el, d);
  }
}
async function rangeAction(a) {
  const kind = a.dataset.kind,
    act = a.dataset.action;
  if (act === 'range-open') {
    evo.sheet = evo.sheet === kind ? null : kind;
    evo.custom = false;
    return renderEvolution();
  }
  if (act === 'range-cancel') {
    evo.sheet = null;
    return renderEvolution();
  }
  if (act === 'range-pick' && a.dataset.key === 'custom') {
    const [from, to] = kind === 'period' ? [evo.from, evo.to] : [evo.cmpFrom || evo.from, evo.cmpTo || evo.to];
    evo.pick = { from, to, edit: 'new', month: calStart(kind, from) };
    evo.custom = true;
    return renderEvolution();
  }
  if (act === 'range-day') Object.assign(evo.pick, pickDay(evo.pick, a.dataset.date));
  if (act === 'range-end') evo.pick.edit = a.dataset.end;
  if (act === 'range-month') evo.pick.month = shiftMonth(evo.pick.month, Number(a.dataset.step));
  if (['range-day', 'range-end', 'range-month'].includes(act))
    return renderCal(
      a.dataset.date
        ? `[data-date="${a.dataset.date}"]`
        : a.dataset.end
          ? `[data-end="${a.dataset.end}"]`
          : `[data-step="${a.dataset.step}"]:enabled`,
    );
  const prev = { ...evo };
  if (act === 'range-pick') evo[kind] = a.dataset.key;
  if (act === 'range-apply') {
    const { from, to } = evo.pick,
      err = $('.range-sheet .form-error');
    if (!from || !to || from > to) {
      err.textContent = !from || !to ? 'Choisis les deux dates.' : 'La date « Du » doit précéder la date « Au ».';
      err.hidden = false;
      return;
    }
    evo[kind] = 'custom';
    if (kind === 'period') [evo.from, evo.to] = [from, to];
    else [evo.cmpFrom, evo.cmpTo] = [from, to];
  }
  evo.sheet = null;
  evo.custom = false;
  try {
    await loadEvolution();
  } catch (e) {
    Object.assign(evo, prev);
    renderEvolution();
    throw e;
  }
}
// Line chart: chosen period solid (last point dotted while it is still running), comparison dashed and lighter.
function evoChart(d, width) {
  const H = 170,
    top = 10,
    base = H - 24,
    left = 30,
    right = width - 8,
    hourly = d.granularity === 'hour',
    n = hourly ? 24 : Math.max(d.current.length, d.compare?.length || 0),
    cur = d.current.slice(0, hourly && d.live ? d.hourNow + 1 : d.current.length).map((p) => p.pages),
    cmp = (d.compare || []).map((p) => p.pages),
    max = niceMax(Math.max(1, ...cur, ...cmp)),
    x = (i) => (n === 1 ? (left + right) / 2 : left + (i / (n - 1)) * (right - left)),
    y = (v) => base - (v / max) * (base - top),
    at = (p) => `M${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const line = (vals, cls, dotted) => {
    const pts = vals.map((v, i) => [x(i), y(v)]);
    if (pts.length === 1) return `<circle class="${cls} single" cx="${pts[0][0]}" cy="${pts[0][1]}" r="3"/>`;
    const segs = monotoneSegments(pts);
    return dotted
      ? `${segs.length > 1 ? `<path class="${cls}" d="${at(pts[0])}${segs.slice(0, -1).join('')}"/>` : ''}<path class="${cls} partial" d="${at(pts.at(-2))}${segs.at(-1)}"/>`
      : `<path class="${cls}" d="${at(pts[0])}${segs.join('')}"/>`;
  };
  const grid = [0, max / 2, max]
    .map(
      (v) =>
        `<line class="grid${v ? '' : ' base'}" x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}"/><text class="y-label" x="${left - 6}" y="${y(v) + 3}">${fmt(v)}</text>`,
    )
    .join('');
  const step = hourly ? 3 : Math.max(1, Math.ceil(n / Math.max(2, Math.floor((right - left) / 52)))),
    labels = Array.from({ length: n }, (_, i) => i)
      .filter((i) => i % step === 0 && (hourly || i < d.current.length || i < cmp.length))
      .map((i) => {
        const text = hourly ? hh(i) : dayShort((d.current[i] || d.compare[i]).date, false),
          anchor = n > 1 && x(i) > right - 20 ? 'end' : i === 0 && n > 1 ? 'start' : 'middle';
        return `<text class="x-label" x="${x(i)}" y="${H - 6}" style="text-anchor:${anchor}">${text}</text>`;
      })
      .join('');
  return `<div class="hourly-wrap"><svg class="hourly" width="${width}" height="${H}" role="img" aria-label="Évolution des pages lues">${grid}${labels}${cmp.length ? line(cmp, 'line-yesterday') : ''}${line(cur, 'line-today', d.live && cur.length > 1)}<line class="guide" x1="0" x2="0" y1="${top}" y2="${base}" style="display:none"/><rect class="hover" x="${left}" y="0" width="${right - left}" height="${H}" data-n="${n}"/></svg><div class="hourly-tip" hidden></div></div>`;
}
// Tap or hover anywhere on the chart: vertical guide on the nearest point + tooltip with both values.
function evoHover(el, d) {
  const svg = el.querySelector('svg'),
    guide = svg.querySelector('.guide'),
    box = el.querySelector('.hourly-tip'),
    area = svg.querySelector('.hover'),
    left = Number(area.getAttribute('x')),
    w = Number(area.getAttribute('width')),
    n = Number(area.dataset.n),
    hourly = d.granularity === 'hour',
    cmpName = hourly && d.cmpFrom === shiftDay(d.from, -1) ? 'hier' : d.cmpFrom && dayShort(d.cmpFrom);
  const show = (e) => {
    const r = svg.getBoundingClientRect(),
      i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - left) / w) * (n - 1)))),
      gx = n === 1 ? left + w / 2 : left + (i / (n - 1)) * w,
      c = d.current[i],
      k = d.compare?.[i],
      future = hourly && d.live && i > d.hourNow,
      mine = c && (future ? 'pas encore' : plural(c.pages, 'page')),
      theirs = k && (hourly ? `${cmpName} : ${fmt(k.pages)}` : `${dayShort(k.date)} : ${fmt(k.pages)}`);
    guide.setAttribute('x1', gx);
    guide.setAttribute('x2', gx);
    guide.style.display = '';
    box.textContent = c
      ? `${hourly ? `${i} h` : dayShort(c.date)} : ${mine}${theirs ? ` (${theirs})` : ''}`
      : `${hourly ? `${i} h · ` : ''}${theirs}${hourly ? '' : ' pages'}`;
    box.hidden = false;
    box.style.left = Math.max(0, Math.min(r.width - box.offsetWidth, gx - box.offsetWidth / 2)) + 'px';
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    guide.style.display = 'none';
    box.hidden = true;
  });
}
function statsHTML(s) {
  const w = s.week,
    peak = peakHour(s.hours);
  const kpi = (value, label, sub) =>
    `<div class="kpi"><strong>${value}</strong><span>${label}</span><small>${sub}</small></div>`;
  const card = (title, sub, chart, tip) =>
    `<section class="stat-card"><h3>${title}</h3>${sub ? `<p class="stat-sub">${sub}</p>` : ''}<div data-chart="${chart}"></div>${tip ? `<p class="chart-tip" aria-live="polite">${tip}</p>` : ''}</section>`;
  return `<h2 id="dialog-title">Statistiques</h2><p class="dialog-sub">Depuis le 27 septembre · heure de Paris</p>${
    s.days.length
      ? `<div class="kpis">${kpi(fmt(w.pages), 'pages cette semaine', `depuis ${w.start === s.challenge.startDate ? 'le début' : 'lundi'}`)}${kpi(fmt(Math.round(s.averagePerDay)), 'pages par jour', `en moyenne sur ${plural(s.days.length, 'jour')}`)}${kpi(s.bestDay ? fmt(s.bestDay.pages) : '—', 'meilleur jour', s.bestDay ? dayShort(s.bestDay.date) : 'pas encore')}</div><div id="evolution"></div>${card('Pages lues par jour', 'Touche une barre pour voir le détail', 'pages', dayTip(s.days.at(-1)))}${card('Vers l’objectif commun', `${fmt(s.totalPages)} pages sur ${fmt(s.target)}. En pointillés : le rythme régulier pour l’atteindre le 25 décembre.`, 'cumul')}${card('Lecteurs actifs par jour', 'Lecteurs qui ont ajouté des pages ce jour-là', 'readers', readersTip(s.days.at(-1)))}${card('À quelle heure on lit', 'Nombre d’ajouts selon l’heure', 'hours', peak.additions ? hourTip(peak) : 'Aucun ajout pour l’instant.')}`
      : '<p class="empty-state">Les statistiques commencent le 27 septembre.</p>'
  }`;
}
function showTip(g) {
  const card = g.closest('.stat-card');
  card.querySelectorAll('.bar.on').forEach((b) => b.classList.remove('on'));
  g.classList.add('on');
  card.querySelector('.chart-tip').textContent = g.dataset.tip;
}
async function showStats() {
  const n = ++profileRequest;
  showDialog('<h2 id="dialog-title">Statistiques</h2><p class="empty-state">Chargement…</p>', true);
  evo.sheet = null;
  const [s] = await Promise.all([api('/api/stats'), phase === 'scheduled' ? null : loadEvolution()]);
  if (n !== profileRequest) return;
  showDialog(statsHTML(s), true);
  const days = (key) => s.days.map((d) => ({ ...d, v: d[key] }));
  const charts = {
    pages: (w) => barChart(days('pages'), w, { color: 'var(--green)', label: dayAxis, tip: dayTip }),
    cumul: (w) => cumulativeChart(s, w),
    readers: (w) => barChart(days('readers'), w, { color: '#8a9a5b', label: dayAxis, tip: readersTip }),
    hours: (w) =>
      barChart(
        s.hours.map((h) => ({ ...h, v: h.additions })),
        w,
        {
          color: '#b5a16c',
          label: (h) => `${h.hour} h`,
          tip: hourTip,
          selected: peakHour(s.hours).hour,
          minSlot: 4,
        },
      ),
  };
  for (const el of $$('#dialog [data-chart]')) {
    el.innerHTML = charts[el.dataset.chart](el.clientWidth);
    const sc = el.querySelector('.chart-scroll');
    if (sc) sc.scrollLeft = sc.scrollWidth; // most recent days in view
  }
  renderEvolution();
}
// A new goal for the current palier; errors show under the choices, like the pages form.
async function changeGoal(button) {
  const error = $('#goal-choices .form-error'),
    goal = Number(button.dataset.goal);
  if (button.disabled) return;
  error.hidden = true;
  button.disabled = true;
  try {
    await api('/api/participants', 'PATCH', { participantId: button.dataset.id, goal });
    await refresh();
    await openProfile(button.dataset.id);
    toast(`Nouvel objectif : ${fmt(goal)} pages. Bonne lecture !`);
  } catch (e) {
    error.textContent = e.message || 'Une erreur est survenue.';
    error.hidden = false;
    button.disabled = false;
  }
}
function toast(message) {
  clearTimeout(toastTimer);
  const t = $('#toast'),
    d = $('#dialog');
  // An open dialog sits on top of the page: the toast goes inside it, or it would stay hidden behind.
  (d.open ? d : document.body).append(t);
  t.textContent = message;
  t.hidden = false;
  toastTimer = setTimeout(() => (t.hidden = true), 3800);
}
function connection(message) {
  const e = $('#connection');
  e.hidden = !message;
  e.textContent = message || '';
  if (message) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Réessayer';
    b.dataset.action = 'retry';
    e.append(b);
  }
}
async function refresh({ quiet = false } = {}) {
  if (refreshing) return;
  refreshing = true;
  try {
    state = await api('/api/state');
    clockBase = Date.parse(state.challenge.serverTime);
    clockWall = Date.now();
    renderPhase(challengeState(clock()));
    render();
    connection('');
  } catch (e) {
    if (!quiet || !state) connection(e.message || 'Connexion interrompue.');
    else connection('Connexion interrompue. Les dernières données reçues restent affichées.');
    if (!state)
      $('#people-grid').innerHTML =
        '<p class="empty-state">Le carnet sera disponible après la connexion au service partagé.</p>';
    throw e;
  } finally {
    refreshing = false;
  }
}
function chooseTab(button) {
  tab = button.dataset.tab;
  $$('[data-tab]').forEach((b) => {
    b.setAttribute('aria-selected', b === button ? 'true' : 'false');
    b.tabIndex = b === button ? 0 : -1;
  });
  renderLeaders();
}
document.addEventListener('click', async (event) => {
  try {
    const a = event.target.closest('[data-action]');
    if (a?.dataset.action === 'join') showJoin();
    if (a?.dataset.action === 'close') {
      $('#dialog').close();
      profileRequest++;
    }
    if (a?.dataset.action === 'retry') await refresh();
    if (a?.dataset.action === 'install') await install();
    if (a?.dataset.action === 'all-activity') await showAllActivity();
    if (a?.dataset.action === 'stats') await showStats();
    if (a?.dataset.action?.startsWith('range-')) await rangeAction(a);
    const tip = event.target.closest('[data-tip]');
    if (tip) showTip(tip);
    if (a?.dataset.action === 'goal-choices') {
      const box = $('#goal-choices');
      box.hidden = !box.hidden;
      a.setAttribute('aria-expanded', String(!box.hidden));
    }
    if (a?.dataset.action === 'set-goal') await changeGoal(a);
    if (a?.dataset.action === 'edit-name' && activeProfile) {
      renderProfile(activeProfile, true);
      $('#name-input').focus();
      $('#name-input').select();
    }
    if (a?.dataset.action === 'edit-cancel' && activeProfile) renderProfile(activeProfile);
    if (a?.dataset.action === 'delete-profile' && !a.disabled) await deleteProfile(a);
    if (a?.dataset.action === 'calendar') {
      const cal = $('#profile-calendar');
      cal.hidden = !cal.hidden;
      a.setAttribute('aria-expanded', String(!cal.hidden));
      a.textContent = cal.hidden ? 'Voir les 90 jours' : 'Masquer les 90 jours';
    }
    if (a?.dataset.action === 'more-history' && activeProfile) {
      $('#profile-history').innerHTML = historyHTML(activeProfile, activeProfile.entries.length);
      a.remove();
    }
    const p = event.target.closest('[data-person]');
    if (p) await openProfile(p.dataset.person);
    const t = event.target.closest('[data-tab]');
    if (t) chooseTab(t);
    const d = event.target.closest('[data-delete]');
    if (d && !d.disabled && (await askCancel(activeProfile?.entries.find((e) => e.id === d.dataset.delete)))) {
      d.disabled = true;
      await api('/api/entries', 'DELETE', { entryId: d.dataset.delete, participantId: d.dataset.owner });
      await refresh();
      await openProfile(d.dataset.owner);
      toast('Ajout annulé.');
    }
  } catch (e) {
    toast(e.message);
    const b = event.target.closest('button');
    if (b) b.disabled = false;
  }
});
$('#search').addEventListener('input', renderPeople);
// Calendar: arrow keys move between days, changing month when needed.
document.addEventListener('keydown', (e) => {
  const day = e.target.closest?.('.rc-day'),
    step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (!day || !step) return;
  e.preventDefault();
  const d = shiftDay(day.dataset.date, step),
    [min, max] = rangeBounds(evo.sheet, evoToday()),
    p = evo.pick,
    n = calMonths();
  if ((min && d < min) || d > max) return;
  if (d.slice(0, 7) < p.month) p.month = d.slice(0, 7);
  else if (d.slice(0, 7) > shiftMonth(p.month, n - 1)) p.month = shiftMonth(d.slice(0, 7), 1 - n);
  renderCal(`[data-date="${d}"]`);
});
$('.tabs').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const tabs = $$('[data-tab]'),
    index = tabs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? tabs.length - 1
        : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  chooseTab(tabs[next]);
  tabs[next].focus();
});
$('#dialog').addEventListener('click', (e) => {
  if (e.target === $('#dialog')) {
    const r = $('#dialog').getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      $('#dialog').close();
      profileRequest++;
    }
  }
});
// Esc leaves the name form first, then closes the profile.
$('#dialog').addEventListener('cancel', (e) => {
  if ($('#name-form') && activeProfile) {
    e.preventDefault();
    renderProfile(activeProfile);
  } else profileRequest++;
});
// Confirmation shown on top of the profile; resolves true only on the "Oui" button (Esc or outside tap = keep).
function askConfirm(title, text, yes) {
  const box = $('#confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  box.querySelector('[value=yes]').textContent = yes;
  box.returnValue = '';
  box.showModal();
  box.querySelector('[value=no]').focus();
  return new Promise((resolve) =>
    box.addEventListener('close', () => resolve(box.returnValue === 'yes'), { once: true }),
  );
}
function askCancel(entry) {
  if (!entry) return Promise.resolve(false);
  const day = dateLabel(entry.createdAt);
  return askConfirm(
    'Annuler cet ajout ?',
    `+${fmt(entry.pages)} pages, ${day === 'Aujourd’hui' ? 'aujourd’hui' : day === 'Hier' ? 'hier' : 'le ' + day} à ${timeLabel(entry.createdAt)}`,
    'Oui, annuler',
  );
}
// Soft delete on the server: the profile and its pages leave the challenge. Errors show in the name form.
async function deleteProfile(button) {
  const p = activeProfile,
    error = button.form.querySelector('.form-error'),
    pages = p.pages ? ` et ${p.pages === 1 ? 'sa page' : `ses ${fmt(p.pages)} pages`} seront retirés` : ' sera retiré';
  if (!(await askConfirm('Supprimer ce profil ?', `Le profil de ${p.name}${pages} du défi.`, 'Oui, supprimer'))) return;
  error.hidden = true;
  button.disabled = true;
  try {
    await api('/api/participants', 'DELETE', { participantId: p.id });
  } catch (e) {
    error.textContent = e.message || 'Une erreur est survenue.';
    error.hidden = false;
    button.disabled = false;
    return;
  }
  if (selected === p.id) {
    selected = null;
    store.del(SELECT_KEY);
  }
  activeProfile = null;
  profileRequest++;
  $('#dialog').close();
  toast('Profil supprimé.');
  await refresh().catch(() => {});
}
$('#confirm').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});
document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (!['join-form', 'pages-form', 'name-form'].includes(form.id)) return;
  e.preventDefault();
  if (form.dataset.busy === '1') return;
  const data = Object.fromEntries(new FormData(form)),
    button = form.querySelector('button[type=submit]'),
    error = form.querySelector('.form-error');
  error.hidden = true;
  button.disabled = true;
  form.dataset.busy = '1';
  try {
    if (form.id === 'join-form') {
      const name = normalizedName(data.name).name,
        goal = Number(data.goal);
      if (!CONFIG.personalGoals.includes(goal)) throw Error('Choisis ton objectif.');
      const r = await api('/api/participants', 'POST', { name, goal });
      selected = r.participant.id;
      store.set(SELECT_KEY, selected);
      await refresh();
      await openProfile(selected);
      toast('Bienvenue dans le défi !');
    } else if (form.id === 'name-form') {
      const id = form.dataset.id,
        name = normalizedName(data.name).name;
      if (name === activeProfile?.name) return renderProfile(activeProfile);
      await api('/api/participants', 'PATCH', { participantId: id, name });
      await refresh();
      await openProfile(id);
      toast('Prénom modifié.');
    } else {
      const id = form.dataset.id,
        pages = validatePages(Number(data.pages));
      await api('/api/entries', 'POST', { participantId: id, pages, requestId: form.dataset.request });
      // A succeeded write must never be resubmitted after a failed refresh.
      form.reset();
      form.dataset.request = uid();
      await refresh();
      await openProfile(id);
      toast(`+${fmt(pages)} pages !`);
    }
  } catch (err) {
    error.textContent = err.message || 'Une erreur est survenue.';
    error.hidden = false;
    button.disabled = false;
    form.dataset.busy = '0';
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh({ quiet: true }).catch(() => {});
});
setInterval(() => {
  if (!document.hidden) renderClock();
}, 1000);
setInterval(() => {
  if (!document.hidden) refresh({ quiet: true }).catch(() => {});
}, 20000);
renderPhase(challengeState());
// Home-screen install: Chrome (Android, computer) shows its own prompt; iPhone and other browsers get the steps.
let installPrompt = null;
const isIOS =
    /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  isAndroid = /Android/.test(navigator.userAgent);
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function showInstall() {
  $('#install').hidden = installed() || !(installPrompt || isIOS || isAndroid);
}
async function install() {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    prompt.prompt();
    if ((await prompt.userChoice).outcome === 'accepted') $('#install').hidden = true;
    return;
  }
  activeProfile = null;
  profileRequest++;
  showDialog(
    `<h2 id="dialog-title">Sur ton écran d’accueil</h2><ol class="install-steps">${isIOS ? `<li>Touche le bouton Partager ${icon('share')}</li><li>Choisis « Sur l’écran d’accueil »</li><li>Touche « Ajouter »</li>` : '<li>Ouvre le menu ⋮ du navigateur</li><li>Choisis « Ajouter à l’écran d’accueil » ou « Installer l’application »</li>'}</ol><p class="hint">Ouvert depuis WhatsApp ou Instagram ? Ouvre d’abord le lien dans ${isIOS ? 'Safari' : 'Chrome'}.</p>`,
  );
}
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  showInstall();
});
addEventListener('appinstalled', () => {
  installPrompt = null;
  $('#install').hidden = true;
});
showInstall();
// Pull to refresh, only in the installed app: iPhone offers none there and Android turns its own off.
// A full reload picks up both fresh data and a new version of the site (the service worker is network first).
function pullToRefresh() {
  const box = $('#pull'),
    text = box.querySelector('.pull-text'),
    READY = 70;
  let start = null,
    pull = 0,
    back;
  const show = (d) => {
    clearTimeout(back);
    box.classList.remove('is-back');
    box.classList.toggle('is-ready', d >= READY);
    box.style.setProperty('--pull-y', Math.min(d, READY * 1.2) - 50 + 'px');
    box.style.setProperty('--pull-turn', (d / READY) * 300 + 'deg');
    box.style.opacity = Math.min(1, d / 30);
    text.textContent = d >= READY ? 'Relâche pour actualiser' : 'Tire pour actualiser';
    box.hidden = false;
  };
  const hide = () => {
    box.classList.add('is-back');
    box.style.setProperty('--pull-y', '-60px');
    box.style.opacity = 0;
    back = setTimeout(() => (box.hidden = true), 260);
  };
  addEventListener(
    'touchstart',
    (e) => {
      const free = scrollY <= 0 && !$('#dialog').open && !$('#confirm').open && !box.classList.contains('is-loading');
      start = e.touches.length === 1 && free ? { x: e.touches[0].clientX, y: e.touches[0].clientY, down: null } : null;
      pull = 0;
    },
    { passive: true },
  );
  addEventListener(
    'touchmove',
    (e) => {
      if (!start) return;
      const dx = e.touches[0].clientX - start.x,
        dy = e.touches[0].clientY - start.y;
      // Decide once, after a few pixels: only a downward, mostly vertical drag at the top of the page counts.
      if (start.down === null && Math.max(Math.abs(dx), Math.abs(dy)) > 8) start.down = dy > Math.abs(dx);
      if (start.down === false || e.touches.length > 1 || scrollY > 0) {
        if (!box.hidden) hide();
        start = null;
        return;
      }
      if (!start.down) return;
      pull = Math.max(0, dy) * 0.5;
      show(pull);
    },
    { passive: true },
  );
  const end = (e) => {
    if (!start) return;
    start = null;
    if (e.type === 'touchcancel' || pull < READY) return hide();
    box.classList.add('is-loading');
    box.style.setProperty('--pull-y', READY - 50 + 'px');
    text.textContent = 'Actualisation…';
    location.reload();
  };
  addEventListener('touchend', end, { passive: true });
  addEventListener('touchcancel', end, { passive: true });
}
if (installed()) pullToRefresh();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
refresh().catch(() => {});
