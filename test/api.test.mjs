// Offline test of the API routes: in-memory fake of the Upstash REST API + frozen clock.
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://fake.upstash';
process.env.KV_REST_API_TOKEN = 't';
const H = new Map();
const hash = (k) => {
  if (!H.has(k)) H.set(k, new Map());
  return H.get(k);
};
function run([c, ...a]) {
  switch (c) {
    case 'HGETALL':
      return [...hash(a[0])].flat();
    case 'HSETNX':
      if (hash(a[0]).has(a[1])) return 0;
      hash(a[0]).set(a[1], a[2]);
      return 1;
    case 'HGET':
      return hash(a[0]).get(a[1]) ?? null;
    case 'HSET':
      hash(a[0]).set(a[1], a[2]);
      return 1;
    case 'HEXISTS':
      return hash(a[0]).has(a[1]) ? 1 : 0;
    case 'EVAL': {
      const [, , names, readers, key, id, json, max] = a;
      if (hash(readers).size >= Number(max)) return -1;
      if (hash(names).has(key)) return 0;
      hash(names).set(key, id);
      hash(readers).set(id, json);
      return 1;
    }
  }
  throw new Error('unsupported ' + c);
}
globalThis.fetch = async (url, init) => {
  assert.equal(init.headers.Authorization, 'Bearer t');
  const body = JSON.parse(init.body);
  const data = url.endsWith('/pipeline') ? body.map((x) => ({ result: run(x) })) : { result: run(body) };
  return { ok: true, status: 200, json: async () => data };
};
const RealDate = Date;
let NOW = RealDate.parse('2026-09-23T10:00:00Z');
globalThis.Date = class extends RealDate {
  constructor(...a) {
    super(...(a.length ? a : [NOW]));
  }
  static now() {
    return NOW;
  }
};

const handlers = {
  state: (await import('../api/state.js')).default,
  profile: (await import('../api/profile.js')).default,
  participants: (await import('../api/participants.js')).default,
  entries: (await import('../api/entries.js')).default,
};
async function call(name, method, { body, query = {}, header = true } = {}) {
  const req = { method, query, body, headers: header && method !== 'GET' ? { 'x-challenge-request': '1' } : {} };
  let out = {};
  const res = {
    statusCode: 0,
    setHeader() {},
    end(s) {
      out = JSON.parse(s);
    },
  };
  await handlers[name](req, res);
  return { status: res.statusCode, ...out };
}
const uuid = () => crypto.randomUUID();

// Before Sunday: empty, registration open, pages refused.
let s = await call('state', 'GET');
assert.equal(s.status, 200);
assert.equal(s.challenge.status, 'scheduled');
assert.equal(s.challenge.daysUntilStart, 4);
assert.equal(s.readerCount, 0);
assert.equal(s.totalPages, 0);
const camille = await call('participants', 'POST', { body: { name: '  Camille  ', goal: 300 } });
assert.equal(camille.status, 200);
assert.equal(camille.participant.name, 'Camille');
assert.equal(
  (await call('participants', 'POST', { body: { name: 'camille', goal: 100 } })).status,
  409,
  'duplicate name, case-insensitive',
);
assert.equal(
  (await call('participants', 'POST', { body: { name: 'Camillé', goal: 100 } })).status,
  409,
  'duplicate name, accent-insensitive',
);
assert.equal((await call('participants', 'POST', { body: { name: 'Léa', goal: 250 } })).status, 400, 'bad goal');
assert.equal((await call('participants', 'POST', { body: { name: '<script>', goal: 100 } })).status, 400, 'bad name');
assert.equal(
  (await call('participants', 'POST', { body: { name: 'Léa', goal: 100 }, header: false })).status,
  403,
  'missing header',
);
assert.equal((await call('participants', 'GET')).status, 405);
const cid = camille.participant.id;
let r = await call('entries', 'POST', { body: { participantId: cid, pages: 10, requestId: uuid() } });
assert.equal(r.status, 403);
assert.match(r.error, /27 septembre/);

// Sunday 27 Sept 20:00 Paris: running, day 1.
NOW = RealDate.parse('2026-09-27T18:00:00Z');
const req1 = uuid();
r = await call('entries', 'POST', { body: { participantId: cid, pages: 12, requestId: req1 } });
assert.equal(r.status, 200);
assert.equal(
  (await call('entries', 'POST', { body: { participantId: cid, pages: 12, requestId: req1 } })).status,
  200,
  'retry is idempotent',
);
assert.equal(
  (await call('entries', 'POST', { body: { participantId: cid, pages: 13, requestId: req1 } })).status,
  409,
  'reused request id',
);
assert.equal(
  (await call('entries', 'POST', { body: { participantId: cid, pages: 0, requestId: uuid() } })).status,
  400,
);
assert.equal(
  (await call('entries', 'POST', { body: { participantId: cid, pages: '5', requestId: uuid() } })).status,
  400,
);
assert.equal(
  (await call('entries', 'POST', { body: { participantId: 'nope', pages: 5, requestId: uuid() } })).status,
  404,
);
assert.equal((await call('entries', 'POST', { body: { participantId: cid, pages: 5, requestId: 'x' } })).status, 400);
s = await call('state', 'GET');
assert.equal(s.challenge.status, 'running');
assert.equal(s.challenge.dayNumber, 1);
assert.equal(s.totalPages, 12);
assert.equal(s.participants[0].pages, 12);
assert.equal(s.recentActivity[0].readDate, '2026-09-27');

// Monday 18:00 Paris, 22 h later: second day -> streak 2; then cancel Monday's entry.
NOW = RealDate.parse('2026-09-28T16:00:00Z');
const req2 = uuid();
await call('entries', 'POST', { body: { participantId: cid, pages: 30, requestId: req2 } });
let p = await call('profile', 'GET', { query: { id: cid } });
assert.equal(p.participant.pages, 42);
assert.equal(p.participant.streak, 2);
assert.equal(p.participant.entries.length, 2);
assert.equal(p.participant.entries[0].id, req2, 'newest first');
const other = await call('participants', 'POST', { body: { name: 'David', goal: 500 } });
assert.equal(
  (await call('entries', 'DELETE', { body: { participantId: other.participant.id, entryId: req2 } })).status,
  404,
  'cannot cancel for someone else',
);
assert.equal((await call('entries', 'DELETE', { body: { participantId: cid, entryId: req2 } })).status, 200);
assert.equal(
  (await call('entries', 'DELETE', { body: { participantId: cid, entryId: req2 } })).status,
  200,
  'double cancel is harmless',
);
p = await call('profile', 'GET', { query: { id: cid } });
assert.equal(p.participant.pages, 12);
assert.equal(p.participant.entries.length, 1);
s = await call('state', 'GET');
assert.equal(s.totalPages, 12);
assert.equal(s.readerCount, 2);
assert.equal((await call('profile', 'GET', { query: { id: 'nope' } })).status, 404);

// After Christmas: finished, no more writes.
NOW = RealDate.parse('2026-12-26T09:00:00Z');
assert.equal(
  (await call('entries', 'POST', { body: { participantId: cid, pages: 5, requestId: uuid() } })).status,
  403,
);
assert.equal((await call('participants', 'POST', { body: { name: 'Zoé', goal: 100 } })).status, 403);
s = await call('state', 'GET');
assert.equal(s.challenge.status, 'finished');
assert.equal(s.totalPages, 12);

console.log('OK — all API checks passed');
