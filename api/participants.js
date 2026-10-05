import { randomUUID } from 'node:crypto';
import { CONFIG, challengeState, countedEntries, goalSchedule, normalizedName, paliers } from '../public/domain.js';
import { HttpError, body, createReader, deleteReader, loadAll, route, updateReader, valid } from '../lib/db.js';

const finished = () => challengeState(new Date()).status === 'finished';

export default route({
  POST: async (req) => {
    if (finished()) throw new HttpError(403, 'Les inscriptions sont clôturées.');
    const b = body(req);
    const { name, key } = valid(() => normalizedName(b.name));
    if (!CONFIG.personalGoals.includes(b.goal)) throw new HttpError(400, 'Choisis 100, 300 ou 500 pages.');
    const reader = { id: randomUUID(), name, goal: b.goal, createdAt: new Date().toISOString() };
    await createReader(reader, key);
    return { participant: { id: reader.id, name, goal: reader.goal } };
  },
  // Either a new first name, or a new goal for the current palier: 100, 300 or 500, above the pages it already has.
  PATCH: async (req) => {
    const b = body(req),
      now = new Date();
    if ((b.goal === undefined) === (b.name === undefined))
      throw new HttpError(400, 'Envoi invalide. Ferme puis rouvre ton espace.');
    if (b.name !== undefined) {
      if (finished()) throw new HttpError(403, 'Le défi est terminé.');
      const { name } = valid(() => normalizedName(b.name));
      const reader = await updateReader(b.participantId, (r) => (r.name === name ? r : { ...r, name }));
      return { ok: true, name: reader.name };
    }
    if (finished()) throw new HttpError(403, 'Le défi est terminé.');
    if (!CONFIG.personalGoals.includes(b.goal)) throw new HttpError(400, 'Choisis 100, 300 ou 500 pages.');
    const { entries } = await loadAll();
    const reader = await updateReader(b.participantId, (r) => {
      // Checked against the reader just read: a double tap resending the goal in force is a harmless no-op.
      const schedule = goalSchedule(r),
        p = paliers(countedEntries([r], entries, now), schedule);
      if (b.goal === p.goal) return r;
      if (b.goal <= p.palierPages)
        throw new HttpError(
          400,
          `Tu as déjà lu ${p.palierPages} pages dans ce palier : choisis un objectif plus haut.`,
        );
      return { ...r, goal: b.goal, goalHistory: [...schedule, { goal: b.goal, at: now.toISOString() }] };
    });
    return { ok: true, goal: reader.goal };
  },
  // Soft delete: the reader and its pages leave the challenge but stay in the base.
  DELETE: async (req) => {
    const b = body(req);
    if (finished()) throw new HttpError(403, 'Le défi est terminé.');
    await deleteReader(b.participantId);
    return { ok: true };
  },
});
