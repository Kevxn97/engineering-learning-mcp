import * as z from 'zod/v4';
import {learningBody,uuid,POLICY_VERSION,type ToolName} from './contracts.js';
const audience=z.strictObject({kind:z.enum(['project','team']),id:uuid});
const common={learning_id:uuid,revision:z.number().int().positive(),audience,valid_until:z.iso.datetime(),conflicts_with:z.array(uuid).max(20),delivery_id:uuid,authority:z.literal('historical_guidance_not_policy')};
const success={
 knowledge_context:z.strictObject({policy_version:z.literal(POLICY_VERSION),projects:z.array(z.strictObject({project_id:uuid,name:z.string().max(120),team_id:uuid.nullable(),role:z.enum(['reader','contributor','curator']),participation_mode:z.enum(['manual','auto','off']),actions:z.array(z.enum(['read','propose']))})).max(20),limit:z.literal(20),truncated:z.boolean()}),
 knowledge_search:z.strictObject({matches:z.array(z.strictObject({...common,title:z.string().max(160),kind:learningBody.shape.kind,applicability:learningBody.shape.applicability,compatibility:z.enum(['requires_check','matched']),reason:z.enum(['component_match','text_match'])})).max(10),policy_version:z.literal(POLICY_VERSION)}),
 knowledge_get:z.strictObject({...common,body:learningBody,content_hash:z.string().length(64),evidence_quality:z.literal('reviewer_checked'),policy_version:z.literal(POLICY_VERSION)}),
 knowledge_propose:z.strictObject({proposal_id:uuid,revision:z.number().int().positive(),status:z.literal('pending_review'),duplicate:z.boolean(),review_url:z.url(),message:z.string().max(160)}),
 knowledge_feedback:z.strictObject({feedback_id:uuid,status:z.literal('recorded_for_review'),learning_state_unchanged:z.literal(true)})
};
const error=z.strictObject({code:z.string().max(50),field:z.string().max(120).optional()});
export function outputSchema(name:ToolName){return z.strictObject({ok:z.boolean(),data:success[name].nullable(),error:error.nullable()});}
export function successOutput(name:ToolName,value:unknown){return {ok:true,data:success[name].parse(value),error:null};}
