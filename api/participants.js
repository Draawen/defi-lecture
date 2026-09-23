import { randomUUID } from 'node:crypto';
import { CONFIG, challengeState, normalizedName } from '../public/domain.js';
import { HttpError, body, createReader, route, valid } from '../lib/db.js';

export default route({
  POST: async (req) => {
    if (challengeState(new Date()).status === 'finished') throw new HttpError(403, 'Les inscriptions sont clôturées.');
    const b = body(req);
    const { name, key } = valid(() => normalizedName(b.name));
    if (!CONFIG.personalGoals.includes(b.goal)) throw new HttpError(400, 'Choisis 100, 300 ou 500 pages.');
    const reader = { id: randomUUID(), name, goal: b.goal, createdAt: new Date().toISOString() };
    await createReader(reader, key);
    return { participant: { id: reader.id, name, goal: reader.goal } };
  },
});
