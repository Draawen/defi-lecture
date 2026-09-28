import { countedEntries } from '../public/domain.js';
import { loadAll, route } from '../lib/db.js';

// Read-only: every counted page addition since the start, newest first ("Voir tout").
export default route({
  GET: async () => {
    const { readers, entries } = await loadAll();
    return {
      entries: countedEntries(readers, entries, new Date()).map(
        ({ id, participantId, name, pages, readDate, createdAt }) => ({
          id,
          participantId,
          name,
          pages,
          readDate,
          createdAt,
        }),
      ),
    };
  },
});
