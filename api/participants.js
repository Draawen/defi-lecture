import { randomUUID } from 'node:crypto';
import { CONFIG, challengeState, nextGoal, normalizedName, snapshot } from '../public/domain.js';
import { HttpError, body, createReader, loadAll, route, saveReader, valid } from '../lib/db.js';

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
  // "Viser plus haut": once the current goal is reached, move up exactly one step.
  PATCH: async (req) => {
    const b = body(req),
      now = new Date(),
      c = challengeState(now);
    if (c.status !== 'running')
      throw new HttpError(403, c.status === 'scheduled' ? 'Le défi commence le 27 septembre.' : 'Le défi est terminé.');
    const { readers, entries } = await loadAll();
    const reader = readers.find((r) => r.id === b.participantId);
    if (!reader) throw new HttpError(404, 'Ce lecteur est introuvable.');
    // A double tap resends the goal already saved: answer ok before checking the pages against it.
    if (b.goal === reader.goal) return { ok: true, goal: reader.goal };
    if (b.goal !== nextGoal(reader.goal))
      throw new HttpError(409, 'Ton objectif a déjà changé. Ferme puis rouvre ton espace.');
    const pages = snapshot(readers, entries, now).participants.find((p) => p.id === reader.id).pages;
    if (pages < reader.goal) throw new HttpError(400, 'Atteins d’abord ton objectif actuel.');
    await saveReader({ ...reader, goal: b.goal, startGoal: reader.startGoal ?? reader.goal });
    return { ok: true, goal: b.goal };
  },
});
