import { stats } from '../public/domain.js';
import { loadAll, route } from '../lib/db.js';

// Read-only: the series behind the statistics dashboard.
export default route({
  GET: async () => {
    const { readers, entries } = await loadAll();
    return stats(readers, entries, new Date());
  },
});
