import { randomUUID } from 'node:crypto';
import * as semver from 'semver';
import { Database,assertProject,audit,idempotent,quota,type Tx } from './database.js';
import { parse,contextInput,searchInput,getInput,proposeInput,feedbackInput,POLICY_VERSION,type Principal,type LearningBody,type ToolName } from './contracts.js';
import { hash,assertHash,assertSize } from './canonical.js';
import { fail } from './errors.js';
import { SecretScanner,normalizeRepository,validateBody,enforceReadText } from './security.js';
export interface KnowledgeOptions {reviewBase:string;publicDocsHosts:string[]}
export interface LearningRow {id:string;current_revision:number;audience_kind:'project'|'team';audience_id:string;valid_until:Date;review_due_at:Date;state:string;body:LearningBody;content_hash:string;evidence_quality:'reviewer_checked'}
export class KnowledgeService {
 constructor(public readonly db:Database,public readonly scanner:SecretScanner,public readonly options:KnowledgeOptions){}
 async invoke(name:ToolName,principal:Principal,value:unknown):Promise<unknown>{
  switch(name){case 'knowledge_context':return this.context(principal,value);case 'knowledge_search':return this.search(principal,value);case 'knowledge_get':return this.get(principal,value);case 'knowledge_propose':return this.propose(principal,value);case 'knowledge_feedback':return this.feedback(principal,value);}
 }
 async context(principal:Principal,value:unknown){
  const input=parse(contextInput,value);if(input.repository_hint)await this.scanner.scan(input.repository_hint);
  return this.db.transaction(principal,async tx=>{
   await quota(tx,principal,'read');
   let selected=input.project_id;
   if(input.repository_hint){const h=normalizeRepository(input.repository_hint);const matches=await tx.query<{project_id:string}>('SELECT * FROM elm.lookup_repository($1,$2)',[h.host,h.path]);if(matches.rows.length!==1)fail('PROJECT_NOT_RESOLVED');selected=matches.rows[0]!.project_id;}
   if(selected)await assertProject(tx,selected);
   const projects=await tx.query<{id:string;name:string;team_id:string|null;role:string;participation_mode:string}>('SELECT * FROM elm.project_context($1)',[selected??null]);
   await audit(tx,principal,'knowledge.context',selected??null);
   return {policy_version:POLICY_VERSION,projects:projects.rows.slice(0,20).map(p=>({project_id:p.id,name:p.name,team_id:p.team_id,role:p.role,participation_mode:p.participation_mode,actions:['read',...(p.role!=='reader'&&p.participation_mode!=='off'?['propose']:[])]})),limit:20,truncated:projects.rows.length>20};
  });
 }
 async search(principal:Principal,value:unknown){
  const input=parse(searchInput,value);enforceReadText(input.query);await this.scanner.scan(input);
  return this.db.transaction(principal,async tx=>{
   await assertProject(tx,input.project_id);await quota(tx,principal,'read');
   const context=await tx.query<{team_id:string|null}>('SELECT * FROM elm.project_context($1)',[input.project_id]);
   const rows=await tx.query<LearningRow>(`SELECT l.id,l.current_revision,l.audience_kind,l.audience_id,l.valid_until,l.review_due_at,l.state,r.body,r.content_hash,r.evidence_quality
     FROM elm.learnings l JOIN elm.learning_revisions r ON r.learning_id=l.id AND r.revision=l.current_revision
     WHERE l.state='active' AND l.valid_until>now() AND ((l.audience_kind='project' AND l.audience_id=$1) OR (l.audience_kind='team' AND l.audience_id=$2))
     AND (r.search_vector @@ websearch_to_tsquery('simple',$3) OR ($4::text IS NOT NULL AND lower(r.body->'applicability'->>'component')=lower($4)))
     ORDER BY (CASE WHEN lower(r.body->'applicability'->>'component')=lower($4) THEN 10 ELSE 0 END + ts_rank_cd(r.search_vector,websearch_to_tsquery('simple',$3))) DESC,l.updated_at DESC,l.id LIMIT 100`,[input.project_id,context.rows[0]?.team_id??null,input.query,input.component??null]);
   const matches:Record<string,unknown>[]=[];const requestId=randomUUID();
   for(const row of rows.rows){
    assertHash(row.body,row.content_hash);const compat=compatibility(row.body,input.technologies??[]);if(compat==='incompatible')continue;
    const conflicts=await tx.query<{left_id:string;right_id:string}>('SELECT left_id,right_id FROM elm.learning_conflicts WHERE left_id=$1 OR right_id=$1',[row.id]);
    const deliveryId=randomUUID();
    const preview={learning_id:row.id,revision:row.current_revision,title:row.body.title,kind:row.body.kind,applicability:row.body.applicability,audience:{kind:row.audience_kind,id:row.audience_id},compatibility:compat,reason:input.component===row.body.applicability.component?'component_match':'text_match',valid_until:row.valid_until.toISOString(),conflicts_with:conflicts.rows.map(c=>c.left_id===row.id?c.right_id:c.left_id),delivery_id:deliveryId,authority:'historical_guidance_not_policy'};
    if(!wireFits({matches:[...matches,preview]}))break;
    await receipt(tx,principal,requestId,row,'preview',deliveryId,preview);matches.push(preview);if(matches.length===input.limit)break;
   }
   await audit(tx,principal,'knowledge.search',input.project_id,null,{count:matches.length,request_id:requestId});
   return {matches,policy_version:POLICY_VERSION};
  });
 }
 async get(principal:Principal,value:unknown){
  const input=parse(getInput,value);
  return this.db.transaction(principal,async tx=>{
   await quota(tx,principal,'read');const row=await activeLearning(tx,input.learning_id);
   if(input.revision!==undefined&&input.revision!==row.current_revision)fail('VERSION_CONFLICT');
   assertHash(row.body,row.content_hash);const deliveryId=randomUUID();
   const conflicts=await tx.query<{left_id:string;right_id:string}>('SELECT left_id,right_id FROM elm.learning_conflicts WHERE left_id=$1 OR right_id=$1',[row.id]);
   const data={learning_id:row.id,revision:row.current_revision,body:row.body,content_hash:row.content_hash,evidence_quality:row.evidence_quality,valid_until:row.valid_until.toISOString(),audience:{kind:row.audience_kind,id:row.audience_id},conflicts_with:conflicts.rows.map(c=>c.left_id===row.id?c.right_id:c.left_id),delivery_id:deliveryId,authority:'historical_guidance_not_policy',policy_version:POLICY_VERSION};
   if(!wireFits(data))fail('INTEGRITY_ERROR');
   await receipt(tx,principal,randomUUID(),row,'full',deliveryId,data);await audit(tx,principal,'knowledge.get',row.id,row.current_revision,{delivery_id:deliveryId});
   return data;
  });
 }
 async propose(principal:Principal,value:unknown){
  const input=parse(proposeInput,value);validateBody(input.body,this.options.publicDocsHosts);await this.scanner.scan(input);
  return this.db.transaction(principal,async tx=>{
   await assertProject(tx,input.project_id,'contributor');
   const allowed=await tx.query('SELECT elm.proposal_allowed($1,$2) AS ok',[input.project_id,POLICY_VERSION]);if(!allowed.rows[0]?.ok)fail('FORBIDDEN');
   return idempotent(tx,principal,'propose',input.idempotency_key,input,async()=>{
    if(input.amends_learning_id){const base=await activeLearning(tx,input.amends_learning_id);if(base.audience_kind!=='project'||base.audience_id!==input.project_id)fail('NOT_AVAILABLE');if(base.current_revision!==input.base_revision)fail('VERSION_CONFLICT');}
    await validateEvidence(tx,input.body,input.project_id);
    const contentHash=hash(input.body);
    const duplicate=await tx.query<{id:string;current_revision:number}>(`SELECT p.id,p.current_revision FROM elm.proposals p JOIN elm.proposal_revisions r ON p.id=r.proposal_id AND p.current_revision=r.revision WHERE p.author_id=$1 AND p.source_project_id=$2 AND p.status='pending_review' AND p.expires_at>now() AND r.content_hash=$3 AND p.amends_learning_id IS NOT DISTINCT FROM $4::uuid AND p.target_team_id IS NULL LIMIT 1`,[principal.id,input.project_id,contentHash,input.amends_learning_id??null]);
    if(duplicate.rows[0])return proposalResult(duplicate.rows[0].id,duplicate.rows[0].current_revision,this.options.reviewBase,true);
    await quota(tx,principal,'propose');const id=randomUUID();
    await tx.query('INSERT INTO elm.proposals(id,organization_id,author_id,source_project_id,amends_learning_id,base_revision) VALUES($1,$2,$3,$4,$5,$6)',[id,principal.organization_id,principal.id,input.project_id,input.amends_learning_id??null,input.base_revision??null]);
    await tx.query('INSERT INTO elm.proposal_revisions(proposal_id,revision,organization_id,body,content_hash) VALUES($1,1,$2,$3,$4)',[id,principal.organization_id,input.body,contentHash]);
    await audit(tx,principal,'proposal.created',id,1,{content_hash:contentHash});
    return proposalResult(id,1,this.options.reviewBase,false);
   });
  });
 }
 async feedback(principal:Principal,value:unknown){
  const input=parse(feedbackInput,value);await this.scanner.scan(input);
  return this.db.transaction(principal,async tx=>{
   const learning=await activeLearning(tx,input.learning_id);if(learning.current_revision!==input.revision)fail('VERSION_CONFLICT');
   if(input.delivery_id){const r=await tx.query('SELECT id FROM elm.delivery_receipts WHERE id=$1 AND principal_id=$2 AND learning_id=$3 AND revision=$4',[input.delivery_id,principal.id,input.learning_id,input.revision]);if(!r.rowCount)fail('NOT_AVAILABLE');}
   return idempotent(tx,principal,'feedback',input.idempotency_key,input,async()=>{await quota(tx,principal,'feedback');const id=randomUUID();
    await tx.query('INSERT INTO elm.feedback(id,organization_id,principal_id,learning_id,revision,category,note,delivery_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,principal.organization_id,principal.id,input.learning_id,input.revision,input.category,input.note??null,input.delivery_id??null]);
    await audit(tx,principal,'feedback.created',input.learning_id,input.revision,{category:input.category});return {feedback_id:id,status:'recorded_for_review',learning_state_unchanged:true};});
  });
 }
}
export function proposalResult(id:string,revision:number,base:string,duplicate=false){return {proposal_id:id,revision,status:'pending_review',duplicate,review_url:`${base}/proposals/${id}`,message:'Saved as a proposal; not published to other agents.'};}
export async function activeLearning(tx:Tx,id:string):Promise<LearningRow>{
 const q=await tx.query<LearningRow>(`SELECT l.id,l.current_revision,l.audience_kind,l.audience_id,l.valid_until,l.review_due_at,l.state,r.body,r.content_hash,r.evidence_quality FROM elm.learnings l JOIN elm.learning_revisions r ON r.learning_id=l.id AND r.revision=l.current_revision WHERE l.id=$1 AND l.state='active' AND l.valid_until>now()`,[id]);return q.rows[0]??fail('NOT_AVAILABLE');
}
export async function validateEvidence(tx:Tx,body:LearningBody,projectId:string):Promise<void>{for(const e of body.evidence){if(e.kind==='repository'){const q=await tx.query('SELECT elm.alias_in_project($1,$2) AS ok',[e.repository_alias_id,projectId]);if(!q.rows[0]?.ok)fail('CONTENT_REJECTED','evidence.repository');}}}
export function compatibility(body:LearningBody,requested:Array<{name:string;version:string}>):'requires_check'|'matched'|'incompatible'{
 let known=0;for(const expected of requested){const t=body.applicability.technologies.find(x=>x.name.toLowerCase()===expected.name.toLowerCase());if(!t?.version_or_range||!semver.valid(expected.version)||!semver.validRange(t.version_or_range))continue;if(!semver.satisfies(expected.version,t.version_or_range,{includePrerelease:true}))return 'incompatible';known++;}
 return requested.length>0&&known===requested.length?'matched':'requires_check';
}
export function wireFits(data:unknown):boolean{return Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:'x'.repeat(128),result:{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}),'utf8')<=31*1024;}
async function receipt(tx:Tx,p:Principal,requestId:string,row:LearningRow,kind:'preview'|'full',id:string,data:unknown){await tx.query('INSERT INTO elm.delivery_receipts(id,organization_id,principal_id,request_id,learning_id,revision,representation,representation_hash,policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,p.organization_id,p.id,requestId,row.id,row.current_revision,kind,hash(data),POLICY_VERSION]);}
