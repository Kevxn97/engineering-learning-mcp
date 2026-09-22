import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { Identity,Principal } from './contracts.js';
import { POLICY_VERSION } from './contracts.js';
import { hash } from './canonical.js';
import { fail } from './errors.js';
export type Tx=pg.PoolClient;
export class Database {
 readonly pool:pg.Pool;
 private failed=false; private closing=false;
 assertHealthy():void{if(this.failed)fail('DEPENDENCY_UNAVAILABLE');}
 constructor(public readonly organizationId:string,url:string,public readonly kind:'mcp'|'review',max=10){
   this.pool=new pg.Pool({connectionString:url,max,connectionTimeoutMillis:2500,idleTimeoutMillis:30000,query_timeout:4000,application_name:`engineering-learning-${kind}`});
   this.pool.on('error',()=>{if(!this.closing)this.failed=true;});
 }
 async checkRole():Promise<void>{
   const r=await this.pool.query<{current_user:string;rolsuper:boolean;rolbypassrls:boolean;member:boolean;owner:boolean}>(`SELECT current_user,r.rolsuper,r.rolbypassrls,pg_has_role(current_user,'elm_owner','MEMBER') AS member,EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='elm' AND c.relowner=r.oid) AS owner FROM pg_roles r WHERE r.rolname=current_user`);
   const x=r.rows[0];if(!x||x.current_user!==`elm_${this.kind}`||x.rolsuper||x.rolbypassrls||x.member||x.owner)throw new Error('Unsafe database runtime role');
   const tables=await this.pool.query(`SELECT count(*)::int AS bad FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='elm' AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)`);
   if(tables.rows[0]?.bad!==0)throw new Error('Missing forced row security');
   const grants=await this.pool.query(`SELECT has_function_privilege(current_user,'elm.set_serving(uuid,boolean)','EXECUTE') AS maintenance,has_function_privilege(current_user,'elm.registry_change(text,jsonb)','EXECUTE') AS registry`);
   if(grants.rows[0]?.maintenance||(this.kind==='mcp'&&grants.rows[0]?.registry))throw new Error('Runtime role has privileged function access');
 }
 async identity(identity:Identity):Promise<Principal>{
   this.assertHealthy();
   const r=await this.pool.query<Principal>('SELECT * FROM elm.resolve_identity($1,$2,$3)',[this.organizationId,identity.issuer,identity.subject]);
   return r.rows[0]??fail('FORBIDDEN');
 }
 async transaction<T>(principal:Principal,fn:(tx:Tx)=>Promise<T>):Promise<T>{
   this.assertHealthy();
   const tx=await this.pool.connect();try{
     await tx.query('BEGIN');
     await tx.query(`SELECT set_config('elm.principal_id',$1,true),set_config('elm.organization_id',$2,true),set_config('statement_timeout','3000',true),set_config('lock_timeout','1500',true)`,[principal.id,this.organizationId]);
     const active=await tx.query(`SELECT elm.active_actor() AS active,elm.serving($1) AS serving`,[this.organizationId]);
     if(!active.rows[0]?.active)fail('FORBIDDEN');if(!active.rows[0]?.serving)fail('DEPENDENCY_UNAVAILABLE');
     let acquired=false;
     for(let slot=0;slot<5;slot++){const lock=await tx.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,$2)) AS acquired',[`elm-concurrency:${this.organizationId}:${principal.id}`,slot]);if(lock.rows[0]?.acquired){acquired=true;break;}}
     if(!acquired)fail('RATE_LIMITED');
     const value=await fn(tx);await tx.query('COMMIT');return value;
   }catch(e){await tx.query('ROLLBACK').catch(()=>undefined);throw e;}finally{tx.release();}
 }
 async close():Promise<void>{this.closing=true;await this.pool.end();}
}
export async function assertProject(tx:Tx,id:string,role='reader'):Promise<void>{const r=await tx.query('SELECT elm.can_project($1,$2) AS ok',[id,role]);if(!r.rows[0]?.ok)fail('NOT_AVAILABLE');}
export async function audit(tx:Tx,principal:Principal,operation:string,objectId:string|null=null,revision:number|null=null,metadata:Record<string,unknown>={}):Promise<void>{
 await tx.query('INSERT INTO elm.audit_events(id,organization_id,actor_id,operation,object_id,revision,metadata,policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),principal.organization_id,principal.id,operation,objectId,revision,metadata,POLICY_VERSION]);
}
export async function quota(tx:Tx,principal:Principal,operation:'read'|'propose'|'feedback'):Promise<void>{
 const limit=operation==='propose'?20:operation==='feedback'?60:120;
 const q=await tx.query(`INSERT INTO elm.rate_buckets(organization_id,principal_id,operation,bucket,count) VALUES($1,$2,$3,to_char(now() AT TIME ZONE 'UTC',$4),1) ON CONFLICT(organization_id,principal_id,operation,bucket) DO UPDATE SET count=elm.rate_buckets.count+1 RETURNING count`,[principal.organization_id,principal.id,operation,operation==='propose'?'YYYY-MM-DD':'YYYY-MM-DD HH24:MI']);
 if(Number(q.rows[0]?.count)>limit)fail('RATE_LIMITED');
}
export async function idempotent<T>(tx:Tx,principal:Principal,operation:string,key:string,payload:unknown,fn:()=>Promise<T>):Promise<T>{
 const payloadHash=hash(payload);
 await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${principal.organization_id}:${principal.id}:${operation}:${key}`]);
 const old=await tx.query('SELECT payload_hash,result FROM elm.idempotency_records WHERE organization_id=$1 AND principal_id=$2 AND operation=$3 AND key=$4',[principal.organization_id,principal.id,operation,key]);
 if(old.rows[0]){if(old.rows[0].payload_hash!==payloadHash)fail('VERSION_CONFLICT');return old.rows[0].result as T;}
 const result=await fn();
 await tx.query('INSERT INTO elm.idempotency_records(organization_id,principal_id,operation,key,payload_hash,result) VALUES($1,$2,$3,$4,$5,$6)',[principal.organization_id,principal.id,operation,key,payloadHash,JSON.stringify(result)]);
 return result;
}
