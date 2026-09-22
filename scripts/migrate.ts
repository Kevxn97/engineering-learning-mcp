import pg from 'pg';
import { readdir,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function migrate(url:string):Promise<void>{
 const db=new pg.Client({connectionString:url});await db.connect();try{
  await db.query('SELECT pg_advisory_lock(48111273)');
  await db.query('CREATE SCHEMA IF NOT EXISTS elm_migrations');
  await db.query('REVOKE ALL ON SCHEMA elm_migrations FROM PUBLIC');
  await db.query('CREATE TABLE IF NOT EXISTS elm_migrations.applied(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of (await readdir('migrations')).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){
   const sql=await readFile(`migrations/${name}`,'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
   const old=await db.query('SELECT checksum FROM elm_migrations.applied WHERE name=$1',[name]);
   if(old.rows[0]){if(old.rows[0].checksum!==checksum)throw new Error(`Migration checksum changed: ${name}`);continue;}
   await db.query('BEGIN');try{await db.query(sql);await db.query('INSERT INTO elm_migrations.applied(name,checksum) VALUES($1,$2)',[name,checksum]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
  }
 }finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const url=process.env.ELM_MIGRATION_DATABASE_URL;if(!url)throw new Error('ELM_MIGRATION_DATABASE_URL is required');
 await migrate(url);console.log('Migrations applied. Runtime processes must use their restricted roles.');
}
