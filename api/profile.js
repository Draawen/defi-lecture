import { snapshot } from '../public/domain.js';
import { HttpError, loadAll, route } from '../lib/db.js';

export default route({
  GET: async (req) => {
    const id = String(req.query.id || '');
    const { readers, entries } = await loadAll();
    const participant = snapshot(readers, entries, new Date()).participants.find((p) => p.id === id);
    if (!participant) throw new HttpError(404, 'Ce prénom est introuvable.');
    const own = entries
      .filter((e) => e.participantId === id && !e.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { participant: { ...participant, entries: own } };
  },
});
