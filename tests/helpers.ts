import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {migrate} from '../scripts/migrate.js';
import {seed} from '../scripts/seed.js';
import {ids} from '../fixtures/synthetic/ids.js';
import {Database} from '../packages/core/src/database.js';
import {KnowledgeService} from '../packages/core/src/knowledge.js';
import {ReviewService} from '../packages/core/src/review.js';
import {SecretScanner} from '../packages/core/src/security.js';
import {loadConfig} from '../packages/core/src/config.js';
import type {LearningBody,Principal} from '../packages/core/src/contracts.js';
export const issuer='http://localhost:8180/realms/engineering-learning';
export function body(suffix='case'):LearningBody{return {title:`Synthetic retry timeout ${suffix}`,kind:'pitfall',observation:'A synthetic write request timed out after processing; retrying without checking produced a duplicate.',applicability:{component:'synthetic-adapter',conditions:['Only reproduced in the explicitly synthetic integration test.'],technologies:[{name:'node',version_or_range:'>=24 <25'}]},recommended_check_or_action:'Check the request status and idempotency key before retrying a write.',limitations:['Not validated against real customer systems.'],outcome:'confirmed_in_case',evidence:[{kind:'experiment',summary:'The local synthetic duplicate test reproduced the stated behavior.',reference:`synthetic-test-${suffix}`}],tags:['retry','timeout','Zeitüberschreitung']};}
export async function setup(){
 const adminUrl=process.env.ELM_TEST_ADMIN_URL;if(!adminUrl)throw new Error('ELM_TEST_ADMIN_URL required: integration tests never silently substitute mocks');
 const name=`elm_test_${randomBytes(5).toString('hex')}`,u=new URL(adminUrl);if(!['127.0.0.1','localhost','postgres'].includes(u.hostname))throw new Error('Tests require an explicit local PostgreSQL administrator');
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();await admin.query(`CREATE DATABASE ${name}`);u.pathname=`/${name}`;const url=u.href;await migrate(url);
 const owner=new pg.Pool({connectionString:url});const password=randomBytes(24).toString('hex');
 for(const role of ['elm_mcp','elm_review','elm_maintenance']){const q=await owner.query('SELECT format(\'ALTER ROLE %I PASSWORD %L\',$1::text,$2::text) AS sql',[role,password]);await owner.query(q.rows[0].sql as string);}
 const roleUrl=(role:string)=>{const r=new URL(url);r.username=role;r.password=password;return r.href;};
 await seed(url,issuer);const mcp=new Database(ids.org,roleUrl('elm_mcp'),'mcp',10),review=new Database(ids.org,roleUrl('elm_review'),'review',10);
 await mcp.checkRole();await review.checkRole();
 const scanner=new SecretScanner(resolve(process.env.ELM_GITLEAKS_BIN??'.local/bin/gitleaks'),resolve('config/gitleaks.toml'));const options={issuer,reviewBase:'http://localhost:4101',publicDocsHosts:['nodejs.org','www.postgresql.org']};
 const users={} as Record<'alice'|'bob'|'charlie'|'dana'|'mallory'|'admin',Principal>;
 for(const k of ['alice','bob','charlie','dana','mallory','admin'] as const){users[k]=await mcp.identity({issuer,subject:ids[k],scopes:['knowledge:read','knowledge:propose','knowledge:feedback']});}
 const config=loadConfig('mcp',{ELM_PROFILE:'local',ELM_ORGANIZATION_ID:ids.org,ELM_ISSUER:issuer,ELM_MCP_RESOURCE:'http://localhost:4100/mcp',ELM_REVIEW_URL:options.reviewBase,ELM_ALLOWED_HOSTS:'localhost:4100',ELM_MCP_DATABASE_URL:roleUrl('elm_mcp'),ELM_ALLOWED_CLIENT_IDS:'elm-test',ELM_GITLEAKS_BIN:resolve(process.env.ELM_GITLEAKS_BIN??'.local/bin/gitleaks')});
 return {name,admin,owner,url,roleUrl,mcp,review,scanner,users,config,knowledge:new KnowledgeService(mcp,scanner,options),reviewer:new ReviewService(review,scanner,options),async close(){mcp.assertHealthy();review.assertHealthy();await mcp.close();await review.close();await owner.end();await new Promise(r=>setTimeout(r,100));await admin.query(`DROP DATABASE ${name}`);await admin.end();}};
}
export type Harness=Awaited<ReturnType<typeof setup>>;
