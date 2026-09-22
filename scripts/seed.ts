import pg from 'pg';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ids} from '../fixtures/synthetic/ids.js';
import {POLICY_VERSION} from '../packages/core/src/contracts.js';
export async function seed(url:string,issuer:string):Promise<void>{
 const name=new URL(url).pathname.slice(1);if(name!=='elm_local'&&!/^elm_test(?:_[a-z0-9]+)?$/.test(name))throw new Error('Synthetic seed requires a dedicated elm_local or elm_test database');
 const db=new pg.Client({connectionString:url});await db.connect();try{await db.query('BEGIN');
 for(const user of ['alice','bob','charlie','dana','mallory','admin'] as const)await db.query('INSERT INTO elm.principals(id,organization_id,issuer,subject,display_name,membership_admin,operator) VALUES($1,$2,$3,($1::uuid)::text,$4,$5,$5) ON CONFLICT(id) DO NOTHING',[ids[user],ids.org,issuer,`Synthetic ${user}`,user==='admin']);
 await db.query('INSERT INTO elm.teams(id,organization_id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[ids.team,ids.org,'Synthetic engineering']);
 for(const project of ['alpha','beta'] as const)await db.query('INSERT INTO elm.projects(id,organization_id,name,team_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[ids[project],ids.org,`Synthetic ${project}`,ids.team]);
 for(const [user,project,role] of [['alice','alpha','contributor'],['bob','alpha','curator'],['dana','alpha','curator'],['charlie','beta','contributor']] as const){
  await db.query('INSERT INTO elm.project_memberships(principal_id,project_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[ids[user],ids[project],role]);
  await db.query('INSERT INTO elm.participation(principal_id,project_id,organization_id,mode,policy_version) VALUES($1,$2,$3,\'manual\',$4) ON CONFLICT DO NOTHING',[ids[user],ids[project],ids.org,POLICY_VERSION]);
 }
 for(const user of ['alice','bob','charlie','dana'] as const)await db.query('INSERT INTO elm.team_memberships(principal_id,team_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[ids[user],ids.team,['bob','dana'].includes(user)?'curator':'reader']);
 await db.query('INSERT INTO elm.repository_aliases(id,organization_id,project_id,host,path) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[ids.alias,ids.org,ids.alpha,'github.com','synthetic/alpha']);
 await db.query('INSERT INTO elm.service_state(organization_id,serving) VALUES($1,true) ON CONFLICT DO NOTHING',[ids.org]);
 await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.env.ELM_PROFILE!=='local')throw new Error('Seed is local-only');
 const url=process.env.ELM_MIGRATION_DATABASE_URL,issuer=process.env.ELM_ISSUER;if(!url||!issuer)throw new Error('Migration URL and issuer are required');
 await seed(url,issuer);console.log('Synthetic fixtures seeded; no production data loaded.');
}
