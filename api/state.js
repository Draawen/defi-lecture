import { snapshot } from '../public/domain.js';
import { loadAll, route } from '../lib/db.js';

export default route({
  GET: async () => {
    const { readers, entries } = await loadAll();
    return snapshot(readers, entries, new Date());
  },
});
