import {challengeState, validatePages} from '../public/domain.js';
import {HttpError, addEntry, body, getEntry, readerExists, route, saveEntry, valid} from '../lib/db.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function open(b) {
  const now = new Date(), c = challengeState(now);
  if (c.status !== 'running') throw new HttpError(403, c.status === 'scheduled' ? 'Les ajouts commencent le 27 septembre.' : 'Le défi est terminé.');
  if (typeof b.participantId !== 'string' || !(await readerExists(b.participantId))) throw new HttpError(404, 'Ce lecteur est introuvable.');
  return {now, c};
}

export default route({
  POST: async req => {
    const b = body(req);
    const {now, c} = await open(b);
    const pages = valid(() => validatePages(b.pages));
    if (typeof b.requestId !== 'string' || !UUID.test(b.requestId)) throw new HttpError(400, 'Envoi invalide. Ferme puis rouvre ton espace.');
    await addEntry({id: b.requestId.toLowerCase(), participantId: b.participantId, pages, readDate: c.today, createdAt: now.toISOString()});
    return {ok: true};
  },
  DELETE: async req => {
    const b = body(req);
    await open(b);
    const entry = typeof b.entryId === 'string' ? await getEntry(b.entryId) : null;
    if (!entry || entry.participantId !== b.participantId) throw new HttpError(404, 'Ajout introuvable.');
    if (!entry.deletedAt) { entry.deletedAt = new Date().toISOString(); await saveEntry(entry); }
    return {ok: true};
  },
});
