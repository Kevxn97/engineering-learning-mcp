import * as oidc from 'openid-client';
import {randomBytes} from 'node:crypto';
import type {FastifyReply,FastifyRequest} from 'fastify';
import type {Config} from '../../../packages/core/src/config.js';
import type {Principal} from '../../../packages/core/src/contracts.js';
import {Database} from '../../../packages/core/src/database.js';
import {constantEqual,hashText} from '../../../packages/core/src/canonical.js';
import {fail} from '../../../packages/core/src/errors.js';
interface Session{token_hash:string;principal_id:string|null;csrf:string;login_data:{state:string;nonce:string;verifier:string}|null;expires_at:Date}
export class ReviewAuth{
 private constructor(private readonly config:Config,private readonly db:Database,private readonly oidc:oidc.Configuration){}
 static async create(config:Config,db:Database):Promise<ReviewAuth>{
  const customFetch:oidc.CustomFetch=async(input,init)=>{
   const original=new URL(input);
   // Only configured issuer traffic may use the local Compose backchannel.
   if(original.origin!==new URL(config.issuer).origin)throw new Error('OIDC endpoint origin is not configured');
   const target=config.profile==='local'&&config.backchannelOrigin?new URL(original.pathname+original.search,config.backchannelOrigin):original;
   const {body,...options}=init;
   return fetch(target,{...options,body:body instanceof Uint8Array?new Blob([Uint8Array.from(body).buffer]):body,signal:AbortSignal.timeout(4000),redirect:'error'});
  };
  const client=await oidc.discovery(new URL(config.issuer),config.oidcClientId,config.oidcClientSecret,undefined,{[oidc.customFetch]:customFetch,...(config.profile==='local'?{execute:[oidc.allowInsecureRequests]}:{})});
  client.timeout=4;return new ReviewAuth(config,db,client);
 }
 get cookieName(){return this.config.profile==='shared'?'__Host-elm_session':'elm_session';}
 private cookie(reply:FastifyReply,token:string,seconds:number){reply.setCookie(this.cookieName,token,{path:'/',httpOnly:true,secure:this.config.profile==='shared',sameSite:'lax',maxAge:seconds});}
 private async find(request:FastifyRequest):Promise<Session>{
  if(request.headers.authorization!==undefined)fail('FORBIDDEN');
  const token=request.cookies[this.cookieName];if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))fail('UNAUTHENTICATED');
  const q=await this.db.pool.query<Session>('SELECT token_hash,principal_id,csrf,login_data,expires_at FROM elm.review_sessions WHERE token_hash=$1 AND organization_id=$2 AND expires_at>now()',[hashText(token),this.config.organizationId]);return q.rows[0]??fail('UNAUTHENTICATED');
 }
 async login(request:FastifyRequest,reply:FastifyReply):Promise<void>{
  if(request.headers.authorization!==undefined)fail('FORBIDDEN');
  const verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce(),token=randomBytes(32).toString('base64url');
  // Abandon any old browser session; every successful login rotates again.
  const previous=request.cookies[this.cookieName];if(previous)await this.db.pool.query('DELETE FROM elm.review_sessions WHERE token_hash=$1 AND organization_id=$2',[hashText(previous),this.config.organizationId]);
  await this.db.pool.query(`INSERT INTO elm.review_sessions(token_hash,organization_id,csrf,login_data,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')`,[hashText(token),this.config.organizationId,randomBytes(32).toString('base64url'),{state,nonce,verifier}]);
  this.cookie(reply,token,300);
  reply.redirect(oidc.buildAuthorizationUrl(this.oidc,{redirect_uri:`${this.config.reviewBase}/auth/callback`,scope:'openid',code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce}).href);
 }
 async callback(request:FastifyRequest,reply:FastifyReply):Promise<void>{
  const session=await this.find(request);if(!session.login_data||session.principal_id)fail('UNAUTHENTICATED');
  const consumed=await this.db.pool.query('DELETE FROM elm.review_sessions WHERE token_hash=$1 AND organization_id=$2 RETURNING token_hash',[session.token_hash,this.config.organizationId]);if(consumed.rowCount!==1)fail('UNAUTHENTICATED');
  const {verifier,state,nonce}=session.login_data;
  let subject:string;try{
   const token=await oidc.authorizationCodeGrant(this.oidc,new URL(request.url,this.config.reviewBase),{pkceCodeVerifier:verifier,expectedState:state,expectedNonce:nonce});const claims=token.claims();if(!claims?.sub)fail('UNAUTHENTICATED');subject=claims.sub;
  }catch{fail('UNAUTHENTICATED');}
  const principal=await this.db.identity({issuer:this.config.issuer,subject,scopes:[]});
  const token=randomBytes(32).toString('base64url');await this.db.pool.query(`INSERT INTO elm.review_sessions(token_hash,organization_id,principal_id,csrf,expires_at) VALUES($1,$2,$3,$4,now()+make_interval(hours=>$5))`,[hashText(token),this.config.organizationId,principal.id,randomBytes(32).toString('base64url'),this.config.sessionHours]);
  this.cookie(reply,token,this.config.sessionHours*3600);reply.redirect('/');
 }
 async authenticate(request:FastifyRequest):Promise<{principal:Principal;csrf:string;sessionHash:string}>{
  const session=await this.find(request);if(!session.principal_id||session.login_data)fail('UNAUTHENTICATED');
  const principal=await this.db.transaction({id:session.principal_id,organization_id:this.config.organizationId,display_name:'',membership_admin:false,operator:false},async tx=>(await tx.query<Principal>('SELECT * FROM elm.current_principal()')).rows[0]??fail('FORBIDDEN'));
  return {principal,csrf:session.csrf,sessionHash:session.token_hash};
 }
 csrf(expected:string,received:unknown):void{if(typeof received!=='string'||!constantEqual(expected,received))fail('FORBIDDEN');}
 async logout(sessionHash:string,reply:FastifyReply):Promise<void>{await this.db.pool.query('DELETE FROM elm.review_sessions WHERE token_hash=$1 AND organization_id=$2',[sessionHash,this.config.organizationId]);reply.clearCookie(this.cookieName,{path:'/'});reply.redirect('/');}
}
