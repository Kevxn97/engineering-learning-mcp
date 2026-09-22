import {randomUUID} from 'node:crypto';
import * as z from 'zod/v4';
import {Database,assertProject,audit,idempotent,quota,type Tx} from './database.js';
import {type LearningBody,type Principal,learningBody,parse,reviewInput,uuid,key,POLICY_VERSION} from './contracts.js';
import {assertHash,hash} from './canonical.js';
import {fail} from './errors.js';
import {SecretScanner,validateBody,normalizeRepository} from './security.js';
import {activeLearning,validateEvidence,proposalResult} from './knowledge.js';
export interface ProposalRow {id:string;author_id:string;source_project_id:string;target_team_id:string|null;derived_from:string|null;amends_learning_id:string|null;base_revision:number|null;current_revision:number;status:string;expires_at:Date;body:LearningBody;content_hash:string;}
const revisionInput=z.strictObject({proposal_id:uuid,revision:z.number().int().positive(),content_hash:z.string().length(64),body:learningBody,idempotency_key:key});
const retirementInput=z.strictObject({learning_id:uuid,revision:z.number().int().positive(),state:z.enum(['suspended','revoked','archived']),reason:z.string().trim().min(8).max(500),security_related:z.boolean(),idempotency_key:key});
const deriveInput=z.strictObject({source_learning_id:uuid,source_revision:z.number().int().positive(),target_team_id:uuid,body:learningBody,sharing_confirmed:z.literal(true),idempotency_key:key});
export const registryInput=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('create_principal'),name:z.string().min(1).max(120),subject:z.string().min(1).max(256)}),
 z.strictObject({action:z.literal('create_team'),name:z.string().min(1).max(120)}),
 z.strictObject({action:z.literal('create_project'),name:z.string().min(1).max(120),team_id:uuid.nullable()}),
 z.strictObject({action:z.literal('set_active'),id:uuid,active:z.boolean()}),
 z.strictObject({action:z.enum(['project_membership','team_membership']),id:uuid,principal_id:uuid,role:z.enum(['reader','contributor','curator','remove'])}),
 z.strictObject({action:z.literal('repository_alias'),project_id:uuid,host:z.string().max(253),path:z.string().max(512)})
]);
export class ReviewService{
 constructor(public readonly db:Database,private readonly scanner:SecretScanner,private readonly options:{reviewBase:string;publicDocsHosts:string[];issuer:string}){if(db.kind!=='review')throw new Error('Review requires the review database role');}
 async feedbackInbox(principal:Principal){return this.db.transaction(principal,async tx=>{const rows=await tx.query<{learning_id:string;revision:number;category:string;note:string|null;created_at:Date}>(`SELECT learning_id,revision,category,note,created_at FROM elm.feedback WHERE elm.curate_learning(learning_id) ORDER BY (category='security') DESC,created_at DESC LIMIT 100`);await audit(tx,principal,'review.feedback_inbox',null,null,{count:rows.rows.length});return rows.rows;});}
 async withdraw(principal:Principal,value:unknown){const input=parse(z.strictObject({proposal_id:uuid,revision:z.number().int().positive(),idempotency_key:key}),value);return this.db.transaction(principal,async tx=>idempotent(tx,principal,'withdraw',input.idempotency_key,input,async()=>{const r=await tx.query<{author_id:string;current_revision:number;status:string}>('SELECT author_id,current_revision,status FROM elm.proposals WHERE id=$1 FOR UPDATE',[input.proposal_id]);const p=r.rows[0];if(!p||p.author_id!==principal.id)fail('NOT_AVAILABLE');if(p.current_revision!==input.revision||!['pending_review','changes_requested'].includes(p.status))fail('VERSION_CONFLICT');await tx.query("UPDATE elm.proposals SET status='withdrawn',updated_at=now() WHERE id=$1",[input.proposal_id]);await audit(tx,principal,'proposal.withdrawn',input.proposal_id,input.revision);return {status:'withdrawn'};}));}

 async inbox(p:Principal){return this.db.transaction(p,async tx=>{const q=await tx.query<{id:string;status:string;current_revision:number;title:string;own:boolean;target_team_id:string|null}>(`SELECT p.id,p.status,p.current_revision,r.body->>'title' AS title,p.author_id=$1 AS own,p.target_team_id FROM elm.proposals p JOIN elm.proposal_revisions r ON r.proposal_id=p.id AND r.revision=p.current_revision WHERE p.expires_at>now() ORDER BY p.updated_at DESC,p.id LIMIT 100`,[p.id]);await audit(tx,p,'review.inbox',null,null,{count:q.rowCount});return q.rows;});}
 async proposal(p:Principal,id:unknown){const input=parse(uuid,id);return this.db.transaction(p,async tx=>{const row=await proposal(tx,input);assertHash(row.body,row.content_hash);const permission=await tx.query('SELECT elm.can_project($1,\'curator\') AND ($2::uuid IS NULL OR elm.can_team($2,\'curator\')) AS can_review',[row.source_project_id,row.target_team_id]);let base:LearningBody|null=null;if(row.amends_learning_id){const r=await tx.query<{body:LearningBody}>('SELECT body FROM elm.learning_revisions WHERE learning_id=$1 AND revision=$2',[row.amends_learning_id,row.base_revision]);base=r.rows[0]?.body??null;}
 await audit(tx,p,'review.proposal_read',row.id,row.current_revision);return {...row,can_review:permission.rows[0]?.can_review===true&&row.author_id!==p.id,own:row.author_id===p.id,base};});}
 async revise(p:Principal,value:unknown){const input=parse(revisionInput,value);validateBody(input.body,this.options.publicDocsHosts);await this.scanner.scan(input);return this.db.transaction(p,async tx=>{
  const row=await proposal(tx,input.proposal_id,true);await assertProject(tx,row.source_project_id,'contributor');if(row.author_id!==p.id)fail('NOT_AVAILABLE');
  return idempotent(tx,p,'revise',input.idempotency_key,input,async()=>{
   checkProposal(row,input.revision,input.content_hash);if(!['pending_review','changes_requested'].includes(row.status))fail('VERSION_CONFLICT');
   validateBody(input.body,this.options.publicDocsHosts,row.target_team_id!==null);await validateEvidence(tx,input.body,row.source_project_id);
   const next=row.current_revision+1,contentHash=hash(input.body);
   await tx.query(`UPDATE elm.proposals SET current_revision=$2,status='pending_review',updated_at=now() WHERE id=$1`,[row.id,next]);
   await tx.query('INSERT INTO elm.proposal_revisions(proposal_id,revision,organization_id,body,content_hash) VALUES($1,$2,$3,$4,$5)',[row.id,next,p.organization_id,input.body,contentHash]);
   await audit(tx,p,'proposal.revised',row.id,next,{content_hash:contentHash});return proposalResult(row.id,next,this.options.reviewBase);
  });});}
 async decide(p:Principal,value:unknown){const input=parse(reviewInput,value);await this.scanner.scan(input);return this.db.transaction(p,async tx=>{
  const row=await proposal(tx,input.proposal_id,true);await assertProject(tx,row.source_project_id,'curator');if(row.author_id===p.id)fail('FORBIDDEN');
  if(row.target_team_id){const allowed=await tx.query('SELECT elm.can_team($1,\'curator\') AS ok',[row.target_team_id]);if(!allowed.rows[0]?.ok)fail('NOT_AVAILABLE');}
  return idempotent(tx,p,'review',input.idempotency_key,input,async()=>{
   checkProposal(row,input.revision,input.content_hash);if(row.status!=='pending_review'||row.target_team_id!==input.target_team_id||row.base_revision!==input.base_revision)fail('VERSION_CONFLICT');
   assertHash(row.body,row.content_hash);validateBody(row.body,this.options.publicDocsHosts,row.target_team_id!==null);await this.scanner.scan(row.body);await validateEvidence(tx,row.body,row.source_project_id);
   let learningId:string|null=null,learningRevision:number|null=null;
   if(input.decision==='accept'){
    if(Object.values(input.checks).some(x=>x!==true))fail('INVALID_INPUT','checks');
    if(row.derived_from){const source=await activeLearning(tx,row.derived_from);if(source.audience_kind!=='project'||source.audience_id!==row.source_project_id)fail('NOT_AVAILABLE');}
    if(row.amends_learning_id){
     const base=await tx.query<{current_revision:number;audience_kind:string;audience_id:string;state:string}>('SELECT current_revision,audience_kind,audience_id,state FROM elm.learnings WHERE id=$1 FOR UPDATE',[row.amends_learning_id]);const b=base.rows[0]??fail('NOT_AVAILABLE');
     if(b.current_revision!==row.base_revision||b.state!=='active'||b.audience_kind!=='project'||b.audience_id!==row.source_project_id||row.target_team_id!==null)fail('VERSION_CONFLICT');
     learningId=row.amends_learning_id;learningRevision=b.current_revision+1;
     await tx.query(`UPDATE elm.learnings SET current_revision=$2,valid_until=now()+make_interval(days=>$3),review_due_at=now()+make_interval(days=>$3),updated_at=now() WHERE id=$1`,[learningId,learningRevision,input.valid_days]);
    }else{
     learningId=randomUUID();learningRevision=1;
     await tx.query(`INSERT INTO elm.learnings(id,organization_id,audience_kind,audience_id,current_revision,state,valid_until,review_due_at) VALUES($1,$2,$3,$4,1,'active',now()+make_interval(days=>$5),now()+make_interval(days=>$5))`,[learningId,p.organization_id,row.target_team_id?'team':'project',row.target_team_id??row.source_project_id,input.valid_days]);
    }
    await tx.query(`INSERT INTO elm.learning_revisions(learning_id,revision,organization_id,body,content_hash,evidence_quality) VALUES($1,$2,$3,$4,$5,'reviewer_checked')`,[learningId,learningRevision,p.organization_id,row.body,row.content_hash]);
    if(row.derived_from)await tx.query('INSERT INTO elm.lineage(learning_id,source_learning_id,source_project_id,organization_id) VALUES($1,$2,$3,$4)',[learningId,row.derived_from,row.source_project_id,p.organization_id]);
   }
   const status=input.decision==='accept'?'accepted':input.decision==='reject'?'rejected':'changes_requested';
   await tx.query('INSERT INTO elm.review_decisions(id,organization_id,proposal_id,proposal_revision,content_hash,reviewer_id,decision,reason,learning_id,learning_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),p.organization_id,row.id,row.current_revision,row.content_hash,p.id,input.decision,input.reason,learningId,learningRevision]);
   await tx.query('UPDATE elm.proposals SET status=$2,updated_at=now() WHERE id=$1',[row.id,status]);
   await audit(tx,p,`proposal.${status}`,row.id,row.current_revision,{content_hash:row.content_hash,learning_id:learningId,learning_revision:learningRevision,target_team_id:row.target_team_id});
   return {proposal_id:row.id,status,learning_id:learningId,revision:learningRevision};
  });});}
 async retire(p:Principal,value:unknown){const input=parse(retirementInput,value);await this.scanner.scan(input);return this.db.transaction(p,async tx=>{
  const allowed=await tx.query('SELECT elm.curate_learning($1) AS ok',[input.learning_id]);if(!allowed.rows[0]?.ok)fail('NOT_AVAILABLE');
  return idempotent(tx,p,'retire',input.idempotency_key,input,async()=>{
   const q=await tx.query<{current_revision:number}>('SELECT current_revision FROM elm.learnings WHERE id=$1 FOR UPDATE',[input.learning_id]);if(q.rows[0]?.current_revision!==input.revision)fail('VERSION_CONFLICT');
   await tx.query('UPDATE elm.learnings SET state=$2,updated_at=now() WHERE id=$1',[input.learning_id,input.state]);
   await tx.query('INSERT INTO elm.retirement_events(id,organization_id,learning_id,action) VALUES($1,$2,$3,$4)',[randomUUID(),p.organization_id,input.learning_id,input.state]);
   // Reasons can contain sensitive context: restricted review record, never model output.
   await audit(tx,p,`learning.${input.state}`,input.learning_id,input.revision,{reason:input.reason,security_related:input.security_related});
   if(input.security_related)await tx.query('SELECT elm.suspend_dependents($1)',[input.learning_id]);
   return {learning_id:input.learning_id,state:input.state};
  });});}
 async derive(p:Principal,value:unknown){const input=parse(deriveInput,value);validateBody(input.body,this.options.publicDocsHosts,true);await this.scanner.scan(input);return this.db.transaction(p,async tx=>{
  const source=await activeLearning(tx,input.source_learning_id);if(source.audience_kind!=='project')fail('NOT_AVAILABLE');await assertProject(tx,source.audience_id,'curator');
  const permit=await tx.query('SELECT elm.can_team($1,\'curator\') AND elm.proposal_allowed($2,$3) AS ok',[input.target_team_id,source.audience_id,POLICY_VERSION]);if(!permit.rows[0]?.ok)fail('NOT_AVAILABLE');
  return idempotent(tx,p,'derive',input.idempotency_key,input,async()=>{if(source.current_revision!==input.source_revision)fail('VERSION_CONFLICT');await quota(tx,p,'propose');const id=randomUUID(),contentHash=hash(input.body);
   await tx.query('INSERT INTO elm.proposals(id,organization_id,author_id,source_project_id,target_team_id,derived_from) VALUES($1,$2,$3,$4,$5,$6)',[id,p.organization_id,p.id,source.audience_id,input.target_team_id,source.id]);
   await tx.query('INSERT INTO elm.proposal_revisions(proposal_id,revision,organization_id,body,content_hash) VALUES($1,1,$2,$3,$4)',[id,p.organization_id,input.body,contentHash]);
   await audit(tx,p,'proposal.derived',id,1,{content_hash:contentHash});return proposalResult(id,1,this.options.reviewBase);
  });});}
 async participation(p:Principal,value:unknown){const input=parse(z.strictObject({project_id:uuid,mode:z.enum(['manual','auto','off']),policy_version:z.literal(POLICY_VERSION)}),value);return this.db.transaction(p,async tx=>{
  await assertProject(tx,input.project_id,'contributor');await tx.query(`INSERT INTO elm.participation(principal_id,project_id,organization_id,mode,policy_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(principal_id,project_id) DO UPDATE SET mode=EXCLUDED.mode,policy_version=EXCLUDED.policy_version,updated_at=now()`,[p.id,input.project_id,p.organization_id,input.mode,POLICY_VERSION]);await audit(tx,p,'participation.changed',input.project_id,null,{mode:input.mode});return {mode:input.mode};});}
 async registry(p:Principal,value?:unknown){if(!p.membership_admin)fail('NOT_AVAILABLE');if(value===undefined)return this.db.transaction(p,async tx=>(await tx.query('SELECT elm.registry_snapshot() AS data')).rows[0]?.data as Record<string,unknown>);
  const input=parse(registryInput,value);await this.scanner.scan(input);const data:Record<string,unknown>={...input};delete data.action;
  if(input.action==='repository_alias')Object.assign(data,normalizeRepository(input));if(input.action==='create_principal')data.issuer=this.options.issuer;
  return this.db.transaction(p,async tx=>{const q=await tx.query('SELECT elm.registry_change($1,$2) AS id',[input.action,data]);return {id:q.rows[0]?.id as string};});}
 async conflicts(p:Principal,value:unknown){const input=parse(z.strictObject({left_id:uuid,right_id:uuid,idempotency_key:key}),value);const ids=[input.left_id,input.right_id].sort();if(ids[0]===ids[1])fail('INVALID_INPUT');return this.db.transaction(p,async tx=>{
  for(const id of ids){const a=await tx.query('SELECT elm.curate_learning($1) AS ok',[id]);if(!a.rows[0]?.ok)fail('NOT_AVAILABLE');}
  return idempotent(tx,p,'conflict',input.idempotency_key,input,async()=>{await tx.query('INSERT INTO elm.learning_conflicts(left_id,right_id,organization_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[ids[0],ids[1],p.organization_id]);await audit(tx,p,'learning.conflict_recorded',ids[0]??null,null,{other_id:ids[1]});return {recorded:true};});});}
}
async function proposal(tx:Tx,id:string,lock=false):Promise<ProposalRow>{const q=await tx.query<ProposalRow>(`SELECT p.*,r.body,r.content_hash FROM elm.proposals p JOIN elm.proposal_revisions r ON r.proposal_id=p.id AND r.revision=p.current_revision WHERE p.id=$1 ${lock?'FOR UPDATE OF p':''}`,[id]);return q.rows[0]??fail('NOT_AVAILABLE');}
function checkProposal(row:ProposalRow,revision:number,contentHash:string):void{if(row.current_revision!==revision||row.content_hash!==contentHash||row.expires_at<=new Date())fail('VERSION_CONFLICT');}
