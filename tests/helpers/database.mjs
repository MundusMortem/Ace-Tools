import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
export function testDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  const dir = new URL('../../drizzle/', import.meta.url);
  for (const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file,dir),'utf8'));
  class Statement {
    constructor(query,args=[]) { this.query=query;this.args=args; }
    bind(...args) { return new Statement(this.query,args); }
    async first() { return sqlite.prepare(this.query).get(...this.args)||null; }
    async all() { return {results:sqlite.prepare(this.query).all(...this.args)}; }
    async run() { return {success:true,meta:{changes:sqlite.prepare(this.query).run(...this.args).changes}}; }
  }
  return {sqlite,prepare:query=>new Statement(query),async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results=[];for(const s of statements) results.push(/RETURNING/i.test(s.query)?await s.all():await s.run());sqlite.exec('COMMIT');return results; }
    catch(error) {sqlite.exec('ROLLBACK');throw error;}
  }};
}
