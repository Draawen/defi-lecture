import {
  CONFIG,
  collectiveTarget,
  nextGoal,
  parisDate,
  shiftDay,
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
  // While the challenge runs, the counter aims at the next thousand once 3 000 is reached.
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
            `<button class="person ${p.id === selected ? 'selected' : ''}" data-person="${esc(p.id)}" aria-label="${esc(p.name)}, ${p.pages} pages sur ${p.goal}. Ouvrir son espace"><div class="person-line">${avatar(p)}<div class="person-title"><div class="person-name">${esc(p.name)}</div>${p.id === selected ? '<div class="person-you">moi</div>' : ''}</div>${streakBadge(p)}</div><div class="person-data"><span><strong>${fmt(p.pages)}</strong> / ${fmt(p.goal)} p.</span>${p.pages >= p.goal ? `<span class="reached">${icon('check')} atteint</span>` : `<span>${Math.round((p.pages / p.goal) * 100)} %</span>`}</div><div class="mini"><i style="width:${Math.min(100, (p.pages / p.goal) * 100)}%"></i></div></button>`,
        )
        .join('')
    : `<p class="empty-state">${q ? 'Aucun prénom trouvé.' : 'Aucun inscrit pour l’instant.'}</p>`;
}
function renderActivity() {
  $('#activity-list').innerHTML = state.recentActivity.length
    ? state.recentActivity
        .slice(0, 7)
        .map(
          (e) =>
            `<button class="activity-row" data-person="${esc(e.participantId)}" aria-label="Voir les lectures de ${esc(e.name)}">${avatar(e)}<div><strong>${esc(e.name)}</strong><div class="activity-detail">a ajouté <b>+${fmt(e.pages)} pages</b></div></div><span class="activity-time" title="${esc(fullDate(e.createdAt))}">${dateLabel(e.createdAt)}<time datetime="${esc(e.createdAt)}">${timeLabel(e.createdAt)}</time></span></button>`,
        )
        .join('')
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
            `<button class="leader-row" data-person="${esc(p.id)}"><span class="rank">${String(p.rank).padStart(2, '0')}</span>${avatar(p)}<span class="leader-name">${esc(p.name)}</span><span class="leader-value">${tab === 'pages' ? fmt(p.pages) + ' p.' : tab === 'streak' ? `${p.streak}🔥${p.atRisk ? '⏳' : ''}` : Math.round(p.score) + ' %'}</span></button>`,
        )
        .join('')
    : `<p class="empty-state">${tab === 'streak' ? 'Aucune série pour l’instant.' : 'Aucune lecture pour l’instant.'}</p>`;
  const caption = tab === 'goal' ? 'En % de l’objectif de départ de chacun.' : '';
  $('#leader-caption').textContent = caption;
  $('#leader-caption').hidden = !caption;
}
function showDialog(html) {
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
function renderProfile(p) {
  p = dynamic(p);
  const c = challengeState(clock()),
    remaining = Math.max(0, p.goal - p.pages);
  activeProfile = p;
  showDialog(
    `<h2 id="dialog-title">${esc(p.name)}${p.pages >= p.goal ? ' ✧' : ''}${streakBadge(p)}</h2><div class="profile-total">${fmt(p.pages)} <small>/ ${fmt(p.goal)} pages</small></div><div class="mini profile-progress" role="progressbar" aria-label="Progression de ${esc(p.name)}" aria-valuemin="0" aria-valuemax="${p.goal}" aria-valuenow="${Math.min(p.goal, p.pages)}"><i style="width:${Math.min(100, (p.pages / p.goal) * 100)}%"></i></div><div class="profile-caption"><span>${remaining ? `Encore ${fmt(remaining)} pages.` : 'Objectif atteint !'}</span><span>${Math.round((p.pages / p.goal) * 100)} %</span></div>${c.status === 'running' && !remaining ? `<button type="button" class="button button-primary full" data-action="raise-goal" data-id="${esc(p.id)}" data-goal="${nextGoal(p.goal)}">${icon('medal')}Viser plus haut : ${fmt(nextGoal(p.goal))} pages</button><div class="form-error" role="alert" hidden></div>` : ''}<div class="profile-streak"><strong>Cette semaine</strong>${weekHTML(p)}<button type="button" class="cal-toggle" data-action="calendar" aria-expanded="false" aria-controls="profile-calendar">Voir les 90 jours</button><div id="profile-calendar" hidden>${calendarHTML(p)}</div></div>${c.status === 'running' ? `<form id="pages-form" data-id="${esc(p.id)}" data-request="${uid()}"><label class="field-label" for="pages-input">Nouvelles pages lues (pas ton total)</label><div class="quick"><input class="field" id="pages-input" name="pages" type="number" inputmode="numeric" min="1" max="10000" step="1" required placeholder="Ex. 12"><button class="button button-green" type="submit">Ajouter</button></div><div class="form-error" role="alert" hidden></div></form>` : `<p class="profile-info">${c.status === 'scheduled' ? 'Ajout des pages à partir de dimanche.' : 'Le défi est terminé. Merci !'}</p>`}<div class="history"><h3>Historique</h3><div id="profile-history">${historyHTML(p)}</div>${p.entries.length > 7 ? `<button class="more-history" data-action="more-history">Tout voir (${p.entries.length})</button>` : ''}</div>`,
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
// "Viser plus haut": errors show under the button, like the pages form.
async function raiseGoal(button) {
  const error = button.nextElementSibling,
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
    if (a?.dataset.action === 'raise-goal') await raiseGoal(a);
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
$('#dialog').addEventListener('cancel', () => profileRequest++);
// Cancel confirmation shown on top of the profile; resolves true only on "Oui, annuler" (Esc or outside tap = keep).
function askCancel(entry) {
  const box = $('#confirm');
  if (!entry) return Promise.resolve(false);
  const day = dateLabel(entry.createdAt);
  $('#confirm-text').textContent =
    `+${fmt(entry.pages)} pages, ${day === 'Aujourd’hui' ? 'aujourd’hui' : day === 'Hier' ? 'hier' : 'le ' + day} à ${timeLabel(entry.createdAt)}`;
  box.returnValue = '';
  box.showModal();
  box.querySelector('[value=no]').focus();
  return new Promise((resolve) =>
    box.addEventListener('close', () => resolve(box.returnValue === 'yes'), { once: true }),
  );
}
$('#confirm').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});
document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (!['join-form', 'pages-form'].includes(form.id)) return;
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
function showInstall() {
  $('#install').hidden =
    matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true ||
    !(installPrompt || isIOS || isAndroid);
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
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
refresh().catch(() => {});
