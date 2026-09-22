import { createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey } from 'jose';
import type { Config } from './config.js';
import type { Identity } from './contracts.js';
import { fail } from './errors.js';
export class TokenVerifier {
 private readonly key:JWTVerifyGetKey;
 constructor(private readonly config:Config,key?:JWTVerifyGetKey){
  let u=new URL(config.jwksUrl);if(config.profile==='local'&&config.backchannelOrigin)u=new URL(u.pathname,config.backchannelOrigin);
  this.key=key??createRemoteJWKSet(u,{timeoutDuration:2500,cooldownDuration:10000,cacheMaxAge:300000});
 }
 async verify(header:unknown):Promise<Identity>{
  if(typeof header!=='string'||!/^Bearer [A-Za-z0-9._~-]+$/.test(header)||header.length>16384)fail('UNAUTHENTICATED');
  try{
   const {payload,protectedHeader}=await jwtVerify(header.slice(7),this.key,{issuer:this.config.issuer,audience:this.config.audience,algorithms:['RS256'],requiredClaims:['iss','sub','aud','exp','iat'],clockTolerance:5});
   if(typeof payload.sub!=='string'||typeof payload.exp!=='number'||typeof payload.iat!=='number'||payload.exp-payload.iat>3600||payload.iat>Date.now()/1000+5)fail('UNAUTHENTICATED');
   // Access-token distinction is explicit; a correctly signed ID token is insufficient.
   if(payload.typ!=='Bearer'&&payload.token_use!=='access'&&protectedHeader.typ!=='at+jwt')fail('UNAUTHENTICATED');
   const client=typeof payload.azp==='string'?payload.azp:typeof payload.client_id==='string'?payload.client_id:'';
   if(!this.config.allowedClientIds.includes(client)||typeof payload.scope!=='string')fail('UNAUTHENTICATED');
   const scopes=payload.scope.split(' ').filter(x=>['knowledge:read','knowledge:propose','knowledge:feedback'].includes(x));
   if(scopes.length===0)fail('FORBIDDEN');return {issuer:this.config.issuer,subject:payload.sub,scopes};
  }catch{return fail('UNAUTHENTICATED');}
 }
}
