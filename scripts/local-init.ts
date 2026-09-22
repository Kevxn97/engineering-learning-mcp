import pg from 'pg';
import {migrate} from './migrate.js';
import {seed} from './seed.js';
if(process.env.ELM_PROFILE!=='local')throw new Error('Local initialization is local-only');
const url=process.env.ELM_MIGRATION_DATABASE_URL,issuer=process.env.ELM_ISSUER;if(!url||!issuer)throw new Error('Missing local initialization settings');
await migrate(url);const db=new pg.Client({connectionString:url});await db.connect();try{
 for(const [role,key] of [['elm_mcp','MCP_DB_PASSWORD'],['elm_review','REVIEW_DB_PASSWORD'],['elm_maintenance','MAINTENANCE_DB_PASSWORD']] as const){const password=process.env[key];if(!password||password.length<32)throw new Error('Generated role password missing');const sql=(await db.query('SELECT format(\'ALTER ROLE %I PASSWORD %L\',$1::text,$2::text) AS sql',[role,password])).rows[0].sql as string;await db.query(sql);}
}finally{await db.end();}await seed(url,issuer);console.log('Local schema, restricted roles and synthetic registry initialized.');
