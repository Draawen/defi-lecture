// Exercises every Redis command of lib/db.js against the real database, under a throwaway prefix.
import assert from 'node:assert/strict';
process.env.LECTURE_PREFIX = 'lecture-test';
const db = await import('../lib/db.js');
const id = crypto.randomUUID(), e = crypto.randomUUID();
await db.createReader({id, name: 'Test', goal: 100}, 'test');
await assert.rejects(db.createReader({id: crypto.randomUUID(), name: 'Test', goal: 100}, 'test'), /existe déjà/);
assert.equal(await db.readerExists(id), true);
assert.equal(await db.readerExists('nope'), false);
await db.addEntry({id: e, participantId: id, pages: 7, readDate: '2026-09-27', createdAt: new Date().toISOString()});
await db.addEntry({id: e, participantId: id, pages: 7, readDate: '2026-09-27', createdAt: new Date().toISOString()});
await assert.rejects(db.addEntry({id: e, participantId: id, pages: 8, readDate: '2026-09-27', createdAt: ''}), /déjà été utilisé/);
const got = await db.getEntry(e); got.deletedAt = 'x'; await db.saveEntry(got);
const all = await db.loadAll();
assert.equal(all.readers.length, 1); assert.equal(all.entries.length, 1); assert.equal(all.entries[0].deletedAt, 'x');
const r = await fetch(`${process.env.KV_REST_API_URL}/del/lecture-test:readers/lecture-test:names/lecture-test:entries`, {headers: {Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`}});
console.log('cleanup deleted keys:', (await r.json()).result);
console.log('OK — live Redis checks passed');
