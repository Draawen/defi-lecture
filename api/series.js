import { series } from '../public/domain.js';
import { loadAll, route, valid } from '../lib/db.js';

// Read-only: "Évolution des pages lues", ?from=&to=&cmpFrom=&cmpTo= (Paris days, YYYY-MM-DD; comparison optional).
export default route({
  GET: async (req) => {
    const { readers, entries } = await loadAll();
    const { from, to, cmpFrom, cmpTo } = req.query;
    return valid(() => series(readers, entries, { from, to, cmpFrom, cmpTo }, new Date()));
  },
});
