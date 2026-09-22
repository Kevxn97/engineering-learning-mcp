import * as z from 'zod/v4';
import { assertJsonShape, assertSize } from './canonical.js';
import { fail } from './errors.js';
export const POLICY_VERSION = '2026-09-22.1';
export const uuid = z.uuid();
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
export const key = z.uuid();
export const evidence = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('repository'), repository_alias_id: uuid, commit: z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/), path: text(256).optional(), summary: text(700) }),
  z.strictObject({ kind: z.literal('public_documentation'), url: z.url().max(1024), summary: text(700) }),
  z.strictObject({ kind: z.literal('experiment'), summary: text(1000), reference: text(200) })
]);
export const learningBody = z.strictObject({
  title: text(160, 8),
  kind: z.enum(['pitfall','workaround','testing_practice','integration_behavior','decision_context']),
  observation: text(2500, 20),
  applicability: z.strictObject({ component: text(160), conditions: z.array(text(500)).min(1).max(6), technologies: z.array(z.strictObject({name: text(80), version_or_range: text(100).nullable()})).max(8) }),
  recommended_check_or_action: text(2000, 10), limitations: z.array(text(500)).min(1).max(6),
  outcome: z.enum(['confirmed_in_case','inconclusive','failed_approach']),
  evidence: z.array(evidence).min(1).max(5), tags: z.array(text(40)).max(10)
});
export type LearningBody = z.infer<typeof learningBody>;
export const contextInput = z.strictObject({project_id: uuid.optional(), repository_hint: z.strictObject({host:text(253),path:text(512)}).optional()}).refine(x => !(x.project_id && x.repository_hint));
export const searchInput = z.strictObject({project_id:uuid,query:text(1024),component:text(160).optional(),technologies:z.array(z.strictObject({name:text(80),version:text(100)})).max(8).optional(),limit:z.number().int().min(1).max(10).default(5)});
export const getInput = z.strictObject({learning_id:uuid,revision:z.number().int().min(1).optional()});
export const proposeInput = z.strictObject({project_id:uuid,body:learningBody,idempotency_key:key,amends_learning_id:uuid.optional(),base_revision:z.number().int().positive().optional()}).refine(x=> Boolean(x.amends_learning_id)===Boolean(x.base_revision));
export const feedbackInput = z.strictObject({learning_id:uuid,revision:z.number().int().positive(),category:z.enum(['helpful','not_applicable','outdated','incorrect','security']),note:text(700).optional(),delivery_id:uuid.optional(),idempotency_key:key});
export const reviewInput = z.strictObject({proposal_id:uuid,revision:z.number().int().positive(),content_hash:z.string().regex(/^[a-f0-9]{64}$/),target_team_id:uuid.nullable(),base_revision:z.number().int().positive().nullable(),decision:z.enum(['accept','request_changes','reject']),checks:z.strictObject({accuracy:z.boolean(),applicability:z.boolean(),evidence:z.boolean(),no_secrets:z.boolean(),audience:z.boolean()}),reason:text(500),valid_days:z.number().int().min(1).max(90).default(90),idempotency_key:key});
export type ReviewInput = z.infer<typeof reviewInput>;
export function parse<T>(schema:z.ZodType<T>,value:unknown):T { assertJsonShape(value); assertSize(value,64*1024); const r=schema.safeParse(value); if(!r.success) fail('INVALID_INPUT',r.error.issues[0]?.path.join('.') || 'input'); return r.data; }
export const tools = {knowledge_context:contextInput,knowledge_search:searchInput,knowledge_get:getInput,knowledge_propose:proposeInput,knowledge_feedback:feedbackInput} as const;
export type ToolName = keyof typeof tools;
export const toolScopes:Record<ToolName,string> = {knowledge_context:'knowledge:read',knowledge_search:'knowledge:read',knowledge_get:'knowledge:read',knowledge_propose:'knowledge:propose',knowledge_feedback:'knowledge:feedback'};
export interface Identity { issuer:string; subject:string; scopes:string[] }
export interface Principal { id:string; organization_id:string; display_name:string; membership_admin:boolean; operator:boolean }
