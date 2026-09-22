import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as z from 'zod/v4';
import {parse,uuid} from '../packages/core/src/contracts.js';
import {hash} from '../packages/core/src/canonical.js';
const manifestBody=z.strictObject({schema_version:z.literal(1),organization_id:uuid,exported_at:z.iso.datetime(),entries:z.array(z.strictObject({learning_id:uuid,action:z.enum(['suspended','revoked','archived','purged'])})).max(100000)});
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const url=process.env.ELM_MAINTENANCE_DATABASE_URL,org=process.env.ELM_ORGANIZATION_ID,command=process.argv[2],file=process.argv[3];if(!url||!org||new URL(url).username!=='elm_maintenance')throw new Error('Restricted maintenance connection and organization are required');parse(uuid,org);
 const db=new pg.Client({connectionString:url});await db.connect();try{
  if(command==='export'&&file){const entries=(await db.query('SELECT elm.retirement_manifest($1) AS entries',[org])).rows[0].entries;const body={schema_version:1 as const,organization_id:org,exported_at:new Date().toISOString(),entries};await writeFile(file,JSON.stringify({...body,checksum:hash(body)},null,2),{mode:0o600,flag:'wx'});console.log('Manifest exported. Copy to the approved store outside the database backup.');}
  else if(command==='apply'&&file){
   const raw=JSON.parse(await readFile(file,'utf8')) as Record<string,unknown>;const {checksum,...value}=raw;const body=manifestBody.parse(value);if(body.organization_id!==org||checksum!==hash(body))throw new Error('Manifest integrity or organization mismatch');
   await db.query('BEGIN');await db.query('SELECT elm.apply_retirements($1,$2)',[org,JSON.stringify(body.entries)]);await db.query('COMMIT');console.log('Retirements applied. Serving remains BLOCKED pending operator review.');
  }else if(command==='purge'&&file){
   const id=parse(uuid,process.argv[4]);const existing=(await db.query('SELECT elm.retirement_manifest($1) AS entries',[org])).rows[0].entries as unknown[];const body={schema_version:1 as const,organization_id:org,exported_at:new Date().toISOString(),entries:[...existing,{learning_id:id,action:'purged'}]};
   // Persist the external deletion intent before altering database contents.
   await writeFile(file,JSON.stringify({...body,checksum:hash(body)},null,2),{mode:0o600,flag:'wx'});
   await db.query('SELECT elm.apply_retirements($1,$2)',[org,JSON.stringify([{learning_id:id,action:'purged'}])]);console.log('Linked content purged. Serving remains blocked. Preserve the external deletion manifest.');
  }else if(command==='block'){await db.query('SELECT elm.set_serving($1,false)',[org]);console.log('Serving blocked.');}
  else if(command==='enable'&&process.argv[3]==='--external-manifest-reconciled'){await db.query('SELECT elm.set_serving($1,true)',[org]);console.log('Serving enabled by explicit operator attestation. This flag does not verify manifest freshness.');}
  else if(command==='retain'){const values=['ELM_PROPOSAL_RETENTION_DAYS','ELM_RECEIPT_RETENTION_DAYS','ELM_AUDIT_RETENTION_DAYS'].map(k=>Number(process.env[k]));if(values.some(v=>!Number.isInteger(v)||v<1||v>3650))throw new Error('Approved retention periods are required');await db.query('SELECT elm.retention($1,$2,$3,$4)',[org,...values]);console.log('Configured retention applied.');}
  else throw new Error('Use export FILE | apply FILE | purge INTENT_FILE LEARNING_UUID | block | enable --external-manifest-reconciled | retain');
 }catch(e){await db.query('ROLLBACK').catch(()=>undefined);throw e;}finally{await db.end();}
}
