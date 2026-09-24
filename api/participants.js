import { randomUUID } from 'node:crypto';
import { CONFIG, challengeState, nextGoal, normalizedName, snapshot } from '../public/domain.js';
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
  // Either a new first name, or "Viser plus haut": once the current goal is reached, move up exactly one step.
  PATCH: async (req) => {
    const b = body(req),
      now = new Date(),
      c = challengeState(now);
    if ((b.goal === undefined) === (b.name === undefined))
      throw new HttpError(400, 'Envoi invalide. Ferme puis rouvre ton espace.');
    if (b.name !== undefined) {
      if (finished()) throw new HttpError(403, 'Le défi est terminé.');
      const { name } = valid(() => normalizedName(b.name));
      const reader = await updateReader(b.participantId, (r) => (r.name === name ? r : { ...r, name }));
      return { ok: true, name: reader.name };
    }
    if (c.status !== 'running')
      throw new HttpError(403, c.status === 'scheduled' ? 'Le défi commence le 27 septembre.' : 'Le défi est terminé.');
    const { readers, entries } = await loadAll();
    const pages = snapshot(readers, entries, now).participants.find((p) => p.id === b.participantId)?.pages ?? 0;
    const reader = await updateReader(b.participantId, (r) => {
      // A double tap resends the goal already saved: answer ok before checking the pages against it.
      if (b.goal === r.goal) return r;
      if (b.goal !== nextGoal(r.goal))
        throw new HttpError(409, 'Ton objectif a déjà changé. Ferme puis rouvre ton espace.');
      if (pages < r.goal) throw new HttpError(400, 'Atteins d’abord ton objectif actuel.');
      return { ...r, goal: b.goal, startGoal: r.startGoal ?? r.goal };
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
