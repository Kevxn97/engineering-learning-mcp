import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {setup,body,type Harness,issuer} from './helpers.js';
import {ids} from '../fixtures/synthetic/ids.js';
import {DomainError} from '../packages/core/src/errors.js';
import {hash} from '../packages/core/src/canonical.js';
import {POLICY_VERSION} from '../packages/core/src/contracts.js';
import {SecretScanner} from '../packages/core/src/security.js';
import {KnowledgeService} from '../packages/core/src/knowledge.js';
let h:Harness;before(async()=>{h=await setup();});after(async()=>{await h?.close();});
const rejects=async(p:Promise<unknown>,code:string)=>assert.rejects(p,(e:unknown)=>e instanceof DomainError&&e.code===code);
async function propose(suffix:string=randomUUID(),user:'alice'|'bob'|'dana'='alice'){return h.knowledge.propose(h.users[user],{project_id:ids.alpha,body:body(suffix),idempotency_key:randomUUID()});}
async function accept(id:string,reviewer:'bob'|'dana'='bob'){
 const p=await h.reviewer.proposal(h.users[reviewer],id);return {proposal_id:p.id,revision:p.current_revision,content_hash:p.content_hash,target_team_id:p.target_team_id,base_revision:p.base_revision,decision:'accept' as const,checks:{accuracy:true,applicability:true,evidence:true,no_secrets:true,audience:true},reason:'Synthetic evidence and intended audience checked.',valid_days:90,idempotency_key:randomUUID()};
}
async function published(suffix:string=randomUUID()){const p=await propose(suffix);const r=await h.reviewer.decide(h.users.bob,await accept(p.proposal_id));assert.ok(r.learning_id);return {id:r.learning_id,revision:r.revision!,proposal:p.proposal_id};}

test('A04/A05: project resolution and title disclosure are permission filtered',async()=>{
 const ctx=await h.knowledge.context(h.users.alice,{});assert.deepEqual(ctx.projects.map(p=>p.project_id),[ids.alpha]);
 await rejects(h.knowledge.context(h.users.alice,{project_id:ids.beta}),'NOT_AVAILABLE');
 await rejects(h.knowledge.context(h.users.mallory,{repository_hint:{host:'github.com',path:'synthetic/alpha.git'}}),'PROJECT_NOT_RESOLVED');
 await rejects(h.knowledge.context(h.users.alice,{project_id:ids.alpha,roles:['curator']}),'INVALID_INPUT');
 const known=await h.knowledge.context(h.users.alice,{repository_hint:{host:'GITHUB.COM',path:'synthetic/alpha.git'}});assert.equal(known.projects[0]?.project_id,ids.alpha);
});
test('A07/A08: real MCP role cannot publish or change membership; pool context does not leak',async()=>{
 assert.equal((await h.mcp.pool.query('SELECT current_user')).rows[0].current_user,'elm_mcp');
 for(const sql of ['UPDATE elm.learnings SET state=\'active\'','DELETE FROM elm.project_memberships','SELECT elm.registry_snapshot()','SELECT * FROM elm.review_sessions'])await assert.rejects(h.mcp.pool.query(sql),e=>(e as {code:string}).code==='42501');
 await h.mcp.transaction(h.users.alice,async tx=>assert.equal((await tx.query('SELECT elm.actor() AS id')).rows[0].id,ids.alice));
 assert.equal((await h.mcp.pool.query('SELECT elm.actor() AS id')).rows[0].id,null);
 await h.mcp.transaction(h.users.charlie,async tx=>assert.equal((await tx.query('SELECT elm.can_project($1) AS ok',[ids.alpha])).rows[0].ok,false));
});
test('B01/B02/D07: unpublished proposal -> exact peer-reviewed publication -> matching delivery receipt',async()=>{
 const p=await propose('publication-flow');assert.equal((await h.knowledge.search(h.users.alice,{project_id:ids.alpha,query:'publication-flow'})).matches.length,0);
 const decision=await accept(p.proposal_id),r=await h.reviewer.decide(h.users.bob,decision);assert.ok(r.learning_id);
 const full=await h.knowledge.get(h.users.alice,{learning_id:r.learning_id,revision:1});assert.equal(full.content_hash,decision.content_hash);assert.equal(full.evidence_quality,'reviewer_checked');
 const receipt=await h.owner.query('SELECT representation_hash FROM elm.delivery_receipts WHERE id=$1',[full.delivery_id]);assert.equal(receipt.rows[0].representation_hash,hash(full));
 await rejects(h.knowledge.get(h.users.charlie,{learning_id:r.learning_id}),'NOT_AVAILABLE');await rejects(h.knowledge.get(h.users.charlie,{learning_id:randomUUID()}),'NOT_AVAILABLE');
});
test('A09: peer reviewer cannot approve own proposal',async()=>{const p=await propose('self-review','bob');await rejects(h.reviewer.decide(h.users.bob,await accept(p.proposal_id)),'FORBIDDEN');});
test('B03: stale content hash and changed revision cannot be approved',async()=>{
 const p=await propose('stale'),decision=await accept(p.proposal_id);
 await rejects(h.reviewer.decide(h.users.bob,{...decision,content_hash:'0'.repeat(64)}),'VERSION_CONFLICT');
 const old=await h.reviewer.proposal(h.users.alice,p.proposal_id);await h.reviewer.revise(h.users.alice,{proposal_id:p.proposal_id,revision:1,content_hash:old.content_hash,body:body('stale-revised'),idempotency_key:randomUUID()});
 await rejects(h.reviewer.decide(h.users.bob,decision),'VERSION_CONFLICT');assert.equal((await h.reviewer.proposal(h.users.bob,p.proposal_id)).current_revision,2);
});
test('B04: failing audit rolls back publication and review decision',async()=>{
 const p=await propose('audit-failure'),decision=await accept(p.proposal_id);
 await h.owner.query(`CREATE FUNCTION public.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='proposal.accepted' THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON elm.audit_events FOR EACH ROW EXECUTE FUNCTION public.fail_audit()`);
 try{await assert.rejects(h.reviewer.decide(h.users.bob,decision));assert.equal((await h.owner.query('SELECT status FROM elm.proposals WHERE id=$1',[p.proposal_id])).rows[0].status,'pending_review');assert.equal((await h.owner.query('SELECT count(*)::int AS n FROM elm.review_decisions WHERE proposal_id=$1',[p.proposal_id])).rows[0].n,0);}finally{await h.owner.query('DROP TRIGGER synthetic_audit_failure ON elm.audit_events; DROP FUNCTION public.fail_audit()');}
});
test('B05/B06/B07: same key retries are idempotent; changed payload conflicts',async()=>{
 const value={project_id:ids.alpha,body:body('idempotency'),idempotency_key:randomUUID()};const first=await h.knowledge.propose(h.users.alice,value);assert.deepEqual(await h.knowledge.propose(h.users.alice,value),first);
 await rejects(h.knowledge.propose(h.users.alice,{...value,body:body('changed-content')}),'VERSION_CONFLICT');
 const decision=await accept(first.proposal_id),published=await h.reviewer.decide(h.users.bob,decision);assert.deepEqual(await h.reviewer.decide(h.users.bob,decision),published);
 const f={learning_id:published.learning_id,revision:1,category:'helpful',idempotency_key:randomUUID()};const result=await h.knowledge.feedback(h.users.alice,f);assert.deepEqual(await h.knowledge.feedback(h.users.alice,f),result);
});
test('B08: competing reviewers cannot both publish the same revision',async()=>{
 const p=await propose('race'),decision=await accept(p.proposal_id);const results=await Promise.allSettled([h.reviewer.decide(h.users.bob,decision),h.reviewer.decide(h.users.dana,{...decision,idempotency_key:randomUUID()})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await h.owner.query('SELECT count(*)::int AS n FROM elm.review_decisions WHERE proposal_id=$1',[p.proposal_id])).rows[0].n,1);
});
test('B09: revoked and expired entries are not served through explicit revision',async()=>{
 const one=await published('revoked');await h.reviewer.retire(h.users.bob,{learning_id:one.id,revision:1,state:'revoked',reason:'Synthetic test retirement.',security_related:false,idempotency_key:randomUUID()});await rejects(h.knowledge.get(h.users.alice,{learning_id:one.id,revision:1}),'NOT_AVAILABLE');
 const two=await published('expired');await h.owner.query('UPDATE elm.learnings SET valid_until=now()-interval \'1 second\' WHERE id=$1',[two.id]);await rejects(h.knowledge.get(h.users.alice,{learning_id:two.id,revision:1}),'NOT_AVAILABLE');
});
test('Revision amendment replaces current pointer without resurrecting an old revision',async()=>{
 const one=await published('amended');const p=await h.knowledge.propose(h.users.alice,{project_id:ids.alpha,body:body('amended-new'),amends_learning_id:one.id,base_revision:1,idempotency_key:randomUUID()});const r=await h.reviewer.decide(h.users.bob,await accept(p.proposal_id));assert.equal(r.revision,2);await rejects(h.knowledge.get(h.users.alice,{learning_id:one.id,revision:1}),'VERSION_CONFLICT');assert.equal((await h.knowledge.get(h.users.alice,{learning_id:one.id})).revision,2);
});
test('B10: sanitized team derivation requires both scopes and hides source provenance',async()=>{
 const source=await published('restricted-source');const value={source_learning_id:source.id,source_revision:1,target_team_id:ids.team,body:body('sanitized-team'),sharing_confirmed:true,idempotency_key:randomUUID()};
 await rejects(h.reviewer.derive(h.users.alice,value),'NOT_AVAILABLE');const p=await h.reviewer.derive(h.users.bob,value);await rejects(h.reviewer.decide(h.users.bob,await accept(p.proposal_id)),'FORBIDDEN');
 const result=await h.reviewer.decide(h.users.dana,await accept(p.proposal_id,'dana'));const content=await h.knowledge.get(h.users.charlie,{learning_id:result.learning_id});assert.equal(content.audience.kind,'team');assert.equal(JSON.stringify(content).includes(source.id),false);
 await rejects(h.knowledge.get(h.users.charlie,{learning_id:source.id}),'NOT_AVAILABLE');await assert.rejects(h.mcp.pool.query('SELECT * FROM elm.lineage'));
 await h.reviewer.retire(h.users.bob,{learning_id:source.id,revision:1,state:'revoked',reason:'Synthetic security withdrawal.',security_related:true,idempotency_key:randomUUID()});await rejects(h.knowledge.get(h.users.charlie,{learning_id:result.learning_id}),'NOT_AVAILABLE');
});
test('A03/A10: local disable blocks valid identity and old idempotency retries',async()=>{
 const p={project_id:ids.alpha,body:body('disable-retry'),idempotency_key:randomUUID()};await h.knowledge.propose(h.users.alice,p);
 await h.owner.query('UPDATE elm.principals SET active=false WHERE id=$1',[ids.alice]);try{await rejects(h.mcp.identity({issuer,subject:ids.alice,scopes:['knowledge:read']}),'FORBIDDEN');await rejects(h.knowledge.propose(h.users.alice,p),'FORBIDDEN');}finally{await h.owner.query('UPDATE elm.principals SET active=true WHERE id=$1',[ids.alice]);}
});
test('Participation is a server-owned gate; turning it off prevents submission',async()=>{
 await h.reviewer.participation(h.users.alice,{project_id:ids.alpha,mode:'off',policy_version:POLICY_VERSION});try{await rejects(propose('no-consent'),'FORBIDDEN');}finally{await h.reviewer.participation(h.users.alice,{project_id:ids.alpha,mode:'manual',policy_version:POLICY_VERSION});}
});
test('C01/C02: real scanner rejects synthetic secret in body, query and feedback; failure is closed',async()=>{
 const canary='ghp_'+randomBytes(30).toString('base64url').replaceAll('_','A').replaceAll('-','B').slice(0,36);
 await rejects(h.scanner.scan({token:canary}),'CONTENT_REJECTED');await rejects(h.knowledge.propose(h.users.alice,{project_id:ids.alpha,body:{...body('secret'),observation:`Synthetic forbidden credential ${canary}`},idempotency_key:randomUUID()}),'CONTENT_REJECTED');await rejects(h.knowledge.search(h.users.alice,{project_id:ids.alpha,query:canary}),'CONTENT_REJECTED');
 const p=await published('feedback-secret');await rejects(h.knowledge.feedback(h.users.alice,{learning_id:p.id,revision:1,category:'security',note:canary,idempotency_key:randomUUID()}),'CONTENT_REJECTED');
 const k=new KnowledgeService(h.mcp,new SecretScanner('/nonexistent/gitleaks','/nonexistent/config'),{reviewBase:'http://localhost:4101',publicDocsHosts:[]});await rejects(k.propose(h.users.alice,{project_id:ids.alpha,body:body('outage'),idempotency_key:randomUUID()}),'DEPENDENCY_UNAVAILABLE');
 assert.equal((await h.owner.query('SELECT count(*)::int AS n FROM elm.proposal_revisions WHERE body::text LIKE $1',[`%${canary}%`])).rows[0].n,0);
});
test('C03/C04/C05/C06: untrusted content never widens schema, executes active content or fetches sources',async()=>{
 await rejects(h.knowledge.propose(h.users.alice,{project_id:ids.alpha,body:body('bad'),approved:true,idempotency_key:randomUUID()}),'INVALID_INPUT');
 for(const content of ['<script>alert(1)</script>','![tracking](https://example.com/pixel)','javascript:alert(1)'])await rejects(h.knowledge.propose(h.users.alice,{project_id:ids.alpha,body:{...body('active'),observation:content.padEnd(25,'.')},idempotency_key:randomUUID()}),'CONTENT_REJECTED');
 for(const url of ['http://169.254.169.254/latest/meta-data/','https://localhost/admin','https://user:password@nodejs.org/docs'])await rejects(h.knowledge.propose(h.users.alice,{project_id:ids.alpha,body:{...body('url'),evidence:[{kind:'public_documentation',url,summary:'Synthetic rejected URL'}]},idempotency_key:randomUUID()}),'CONTENT_REJECTED');
 await rejects(h.knowledge.search(h.users.alice,{project_id:ids.alpha,query:'a\0b'}),'INVALID_INPUT');const result=await h.knowledge.search(h.users.alice,{project_id:ids.alpha,query:"x'); DROP TABLE elm.learnings; --"});assert.ok(Array.isArray(result.matches));
});
test('D02/D03: DE/EN terms and explicit compatible/incompatible versions',async()=>{
 await published('language-match');const a=await h.knowledge.search(h.users.alice,{project_id:ids.alpha,query:'Zeitüberschreitung',technologies:[{name:'node',version:'24.1.0'}]});assert.ok(a.matches.length);assert.ok(a.matches.every(x=>x.compatibility==='matched'));
 const b=await h.knowledge.search(h.users.alice,{project_id:ids.alpha,query:'language-match',technologies:[{name:'node',version:'22.0.0'}]});assert.equal(b.matches.length,0);
});
test('D04: explicitly recorded conflicts are visible only when both entries are readable',async()=>{
 const a=await published('conflict-a'),b=await published('conflict-b');await h.reviewer.conflicts(h.users.bob,{left_id:a.id,right_id:b.id,idempotency_key:randomUUID()});assert.deepEqual((await h.knowledge.get(h.users.alice,{learning_id:a.id})).conflicts_with,[b.id]);
});
test('Access audit failure prevents content delivery',async()=>{
 const a=await published('receipt-failure');await h.owner.query(`CREATE FUNCTION public.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt outage'; END $$; CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON elm.delivery_receipts FOR EACH ROW EXECUTE FUNCTION public.fail_receipt()`);
 try{await assert.rejects(h.knowledge.get(h.users.alice,{learning_id:a.id}));}finally{await h.owner.query('DROP TRIGGER synthetic_receipt_failure ON elm.delivery_receipts; DROP FUNCTION public.fail_receipt()');}
});
test('D06: shared database quota blocks admission, without resetting caller identity',async()=>{
 await h.owner.query(`INSERT INTO elm.rate_buckets(organization_id,principal_id,operation,bucket,count) VALUES($1,$2,'read',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI'),120) ON CONFLICT(organization_id,principal_id,operation,bucket) DO UPDATE SET count=120`,[ids.org,ids.mallory]);await rejects(h.knowledge.context(h.users.mallory,{}),'RATE_LIMITED');
});
test('Registry administrator does not automatically gain content access',async()=>{
 assert.ok(await h.reviewer.registry(h.users.admin));assert.deepEqual((await h.knowledge.context(h.users.admin,{})).projects,[]);await rejects(h.reviewer.registry(h.users.alice),'NOT_AVAILABLE');
 const result=await h.reviewer.registry(h.users.admin,{action:'create_project',name:'Synthetic created project',team_id:null});assert.ok(result?.id);
});
