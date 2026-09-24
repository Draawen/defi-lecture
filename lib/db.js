// Shared storage (Upstash Redis REST, provisioned through Vercel) and HTTP helpers for the API routes.
import { normalizedName } from '../public/domain.js';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PREFIX = process.env.LECTURE_PREFIX || 'lecture';
const K = { readers: `${PREFIX}:readers`, names: `${PREFIX}:names`, entries: `${PREFIX}:entries` };
const MAX_READERS = 1000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function redis(path, body) {
  if (!URL_ || !TOKEN) throw new HttpError(503, 'Le service n’est pas encore relié à sa base de données.');
  const r = await fetch(`${URL_}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error) throw new Error(`Redis ${r.status}: ${d?.error || 'réponse illisible'}`);
  return d;
}
const cmd = async (...args) => (await redis('', args)).result;

function hashValues(flat) {
  const out = [];
  for (let i = 1; i < flat.length; i += 2) out.push(JSON.parse(flat[i]));
  return out;
}

export async function loadAll() {
  const res = await redis('/pipeline', [
    ['HGETALL', K.readers],
    ['HGETALL', K.entries],
  ]);
  for (const x of res) if (x.error) throw new Error(`Redis: ${x.error}`);
  return { readers: hashValues(res[0].result || []), entries: hashValues(res[1].result || []) };
}

// Name reservation + reader creation in one atomic step, so a name can never be taken without a reader.
const CREATE_READER = `if redis.call('HLEN', KEYS[2]) >= tonumber(ARGV[4]) then return -1 end
if redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[2]) == 0 then return 0 end
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3]) return 1`;
export async function createReader(reader, key) {
  const r = await cmd(
    'EVAL',
    CREATE_READER,
    '2',
    K.names,
    K.readers,
    key,
    reader.id,
    JSON.stringify(reader),
    String(MAX_READERS),
  );
  if (r === -1) throw new HttpError(409, 'Le carnet des lecteurs est complet.');
  if (r === 0) throw new HttpError(409, 'Ce prénom existe déjà. Clique dessus, ou ajoute une initiale.');
  return reader;
}
// A deleted reader stays in the base (deletedAt set, name freed) so a mistake can be undone by hand.
export async function readerExists(id) {
  const v = await cmd('HGET', K.readers, id);
  return !!v && !JSON.parse(v).deletedAt;
}

// Rewrites a reader only if it is still the stored version, and moves its name in the same step (claims the new
// key, frees the old one; '' frees it for a deletion), so a name is never held twice and a reader never loses it.
const UPDATE_READER = `if redis.call('HGET', KEYS[2], ARGV[1]) ~= ARGV[2] then return -1 end
if ARGV[5] ~= ARGV[4] then
  if ARGV[5] ~= '' then
    local owner = redis.call('HGET', KEYS[1], ARGV[5])
    if owner and owner ~= ARGV[1] then return 0 end
    redis.call('HSET', KEYS[1], ARGV[5], ARGV[1])
  end
  if redis.call('HGET', KEYS[1], ARGV[4]) == ARGV[1] then redis.call('HDEL', KEYS[1], ARGV[4]) end
end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3]) return 1`;
const nameKey = (r) => (r.deletedAt ? '' : normalizedName(r.name).key);
// change(reader) returns the new reader, or the same object when nothing needs saving. Retried if the reader
// changed in between (another tap, another phone).
async function swapReader(id, change, { deleted = false } = {}) {
  for (let i = 0; i < 3; i++) {
    const raw = typeof id === 'string' ? await cmd('HGET', K.readers, id) : null;
    const before = raw && JSON.parse(raw);
    if (!before || (before.deletedAt && !deleted)) throw new HttpError(404, 'Ce lecteur est introuvable.');
    const after = change(before);
    if (after === before) return before;
    const r = await cmd(
      'EVAL',
      UPDATE_READER,
      '2',
      K.names,
      K.readers,
      id,
      raw,
      JSON.stringify(after),
      nameKey(before),
      nameKey(after),
    );
    if (r === 0) throw new HttpError(409, 'Ce prénom existe déjà. Ajoute une initiale.');
    if (r === 1) return after;
  }
  throw new HttpError(409, 'Ce profil vient de changer. Ferme puis rouvre ton espace.');
}
export const updateReader = (id, change) => swapReader(id, change);
export const deleteReader = (id) =>
  swapReader(id, (r) => (r.deletedAt ? r : { ...r, deletedAt: new Date().toISOString() }), { deleted: true });

// Entry id = client request id: HSETNX makes a retried submission idempotent.
export async function addEntry(entry) {
  if ((await cmd('HSETNX', K.entries, entry.id, JSON.stringify(entry))) === 1) return entry;
  const previous = await getEntry(entry.id);
  if (!previous || previous.participantId !== entry.participantId || previous.pages !== entry.pages)
    throw new HttpError(409, 'Cet envoi a déjà été utilisé. Ferme puis rouvre ton espace.');
  return previous;
}
export async function getEntry(id) {
  const v = await cmd('HGET', K.entries, id);
  return v ? JSON.parse(v) : null;
}
export async function saveEntry(entry) {
  await cmd('HSET', K.entries, entry.id, JSON.stringify(entry));
}

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

export function route(handlers) {
  return async (req, res) => {
    try {
      const handler = handlers[req.method];
      if (!handler) throw new HttpError(405, 'Action indisponible.');
      // Writes need the custom header: a plain cross-site form cannot send it.
      if (req.method !== 'GET' && req.headers['x-challenge-request'] !== '1')
        throw new HttpError(403, 'Requête refusée.');
      send(res, 200, await handler(req));
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Le service a rencontré un souci. Réessaie dans un instant.' });
    }
  };
}

export function body(req) {
  try {
    const b = req.body;
    if (b && typeof b === 'object') return b;
    return JSON.parse(b || '{}');
  } catch {
    throw new HttpError(400, 'Requête illisible.');
  }
}

// Domain validators throw plain errors: surface them as a 400 with their French message.
export function valid(fn) {
  try {
    return fn();
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}
