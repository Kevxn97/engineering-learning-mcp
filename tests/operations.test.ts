import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setup,body,type Harness} from './helpers.js';
import {ids} from '../fixtures/synthetic/ids.js';
import {DomainError} from '../packages/core/src/errors.js';
let h:Harness; let maintenance:pg.Client;
before(async()=>{h=await setup();maintenance=new pg.Client({connectionString:h.roleUrl('elm_maintenance')});await maintenance.connect();});
after(async()=>{await maintenance?.end();await h?.close();});
async function publish(suffix:string){const p=await h.knowledge.propose(h.users.alice,{project_id:ids.alpha,body:body(suffix),idempotency_key:randomUUID()});const d=await h.reviewer.proposal(h.users.bob,p.proposal_id);return h.reviewer.decide(h.users.bob,{proposal_id:d.id,revision:d.current_revision,content_hash:d.content_hash,target_team_id:null,base_revision:null,decision:'accept',checks:{accuracy:true,applicability:true,evidence:true,no_secrets:true,audience:true},reason:'Synthetic operations fixture checked.',valid_days:90,idempotency_key:randomUUID()});}
test('D08: a post-backup external deletion manifest removes restored content and keeps serving blocked',async()=>{
 const published=await publish('restore-case');const id=published.learning_id!;
 // Capture a logical database snapshot before deletion, then simulate a restored old row.
 const l=(await h.owner.query('SELECT * FROM elm.learnings WHERE id=$1',[id])).rows[0];
 const r=(await h.owner.query('SELECT * FROM elm.learning_revisions WHERE learning_id=$1',[id])).rows[0];
 const externalManifest=[{learning_id:id,action:'purged'}];
 await maintenance.query('SELECT elm.apply_retirements($1,$2)',[ids.org,JSON.stringify(externalManifest)]);
 assert.equal((await h.owner.query('SELECT count(*)::int AS n FROM elm.learning_revisions WHERE learning_id=$1',[id])).rows[0].n,0);
 await assert.rejects(h.knowledge.context(h.users.alice,{}),e=>e instanceof DomainError&&e.code==='DEPENDENCY_UNAVAILABLE');
 await h.owner.query('INSERT INTO elm.learnings(id,organization_id,audience_kind,audience_id,current_revision,state,valid_until,review_due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[l.id,l.organization_id,l.audience_kind,l.audience_id,l.current_revision,l.state,l.valid_until,l.review_due_at]);
 await h.owner.query('INSERT INTO elm.learning_revisions(learning_id,revision,organization_id,body,content_hash,evidence_quality) VALUES($1,$2,$3,$4,$5,$6)',[r.learning_id,r.revision,r.organization_id,r.body,r.content_hash,r.evidence_quality]);
 await maintenance.query('SELECT elm.apply_retirements($1,$2)',[ids.org,JSON.stringify(externalManifest)]);
 await maintenance.query('SELECT elm.set_serving($1,true)',[ids.org]);
 await assert.rejects(h.knowledge.get(h.users.alice,{learning_id:id}),e=>e instanceof DomainError&&e.code==='NOT_AVAILABLE');
});
test('Purge recursively removes linked team derivatives, feedback and original proposals',async()=>{
 const source=await publish('purge-source');const p=await h.reviewer.derive(h.users.bob,{source_learning_id:source.learning_id,source_revision:1,target_team_id:ids.team,body:body('purge-team'),sharing_confirmed:true,idempotency_key:randomUUID()});const d=await h.reviewer.proposal(h.users.dana,p.proposal_id);
 const child=await h.reviewer.decide(h.users.dana,{proposal_id:d.id,revision:d.current_revision,content_hash:d.content_hash,target_team_id:ids.team,base_revision:null,decision:'accept',checks:{accuracy:true,applicability:true,evidence:true,no_secrets:true,audience:true},reason:'Sanitized synthetic team fixture checked.',valid_days:90,idempotency_key:randomUUID()});
 await h.knowledge.feedback(h.users.charlie,{learning_id:child.learning_id,revision:1,category:'outdated',note:'Synthetic linked payload.',idempotency_key:randomUUID()});
 await maintenance.query('SELECT elm.apply_retirements($1,$2)',[ids.org,JSON.stringify([{learning_id:source.learning_id,action:'purged'}])]);
 for(const id of [source.learning_id,child.learning_id]){
  assert.equal((await h.owner.query('SELECT count(*)::int AS n FROM elm.learning_revisions WHERE learning_id=$1',[id])).rows[0].n,0);
  assert.equal((await h.owner.query('SELECT count(*)::int AS n FROM elm.feedback WHERE learning_id=$1',[id])).rows[0].n,0);
 }
 assert.equal((await h.owner.query('SELECT count(*)::int AS n FROM elm.proposals WHERE id=$1',[p.proposal_id])).rows[0].n,0);
 await maintenance.query('SELECT elm.set_serving($1,true)',[ids.org]);
});
test('Runtime credentials cannot call maintenance or modify immutable published revisions',async()=>{
 await assert.rejects(h.mcp.pool.query('SELECT elm.set_serving($1,false)',[ids.org]));
 await assert.rejects(h.review.pool.query('SELECT elm.retention($1,30,90,180)',[ids.org]));
 await assert.rejects(h.mcp.pool.query('DELETE FROM elm.learning_revisions'));
});
test('Read serving gate and retention have separate explicit maintenance controls',async()=>{
 await assert.rejects(maintenance.query('SELECT elm.retention($1,0,90,180)',[ids.org]));
 await maintenance.query('SELECT elm.retention($1,30,90,180)',[ids.org]);
 const manifest=(await maintenance.query('SELECT elm.retirement_manifest($1) AS entries',[ids.org])).rows[0].entries;
 assert.ok(manifest.some((e:{action:string})=>e.action==='purged'));
});
