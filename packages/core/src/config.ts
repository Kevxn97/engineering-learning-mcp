import { resolve } from 'node:path';
import { fail } from './errors.js';
export interface Config {
  profile:'local'|'shared'; organizationId:string; databaseUrl:string; port:number; host:string;
  issuer:string; jwksUrl:string; audience:string; allowedClientIds:string[]; allowedHosts:string[]; allowedOrigins:string[];
  reviewBase:string; publicDocsHosts:string[]; scannerBin:string; scannerConfig:string;
  oidcClientId:string; oidcClientSecret:string; backchannelOrigin?:string; sessionHours:number;
}
const required=(env:NodeJS.ProcessEnv,k:string)=>{const x=env[k]; if(!x)throw new Error(`Missing ${k}`);return x;};
function origin(value:string,local:boolean):URL {let url:URL;try{url=new URL(value);}catch{throw new Error('Invalid configured URL');} if(url.username||url.password||url.search||url.hash||(!local && (url.protocol!=='https:'||url.hostname.endsWith('.invalid'))))throw new Error('Unsafe configured URL');return url;}
export function loadConfig(kind:'mcp'|'review',env:NodeJS.ProcessEnv=process.env):Config {
  const profile=env.ELM_PROFILE; if(profile!=='local'&&profile!=='shared')throw new Error('ELM_PROFILE must explicitly be local or shared');
  const local=profile==='local';
  const issuer=required(env,'ELM_ISSUER'); const audience=required(env,'ELM_MCP_RESOURCE'); const reviewBase=required(env,'ELM_REVIEW_URL');
  const iu=origin(issuer,local),au=origin(audience,local),ru=origin(reviewBase,local);
  const jwksUrl=env.ELM_JWKS_URL??`${issuer}/protocol/openid-connect/certs`;
  if(origin(jwksUrl,local).origin!==iu.origin)throw new Error('JWKS must use the configured issuer origin');
  const org=required(env,'ELM_ORGANIZATION_ID');if(!/^[a-f0-9-]{36}$/i.test(org))throw new Error('Invalid organization ID');
  const databaseUrl=required(env,kind==='mcp'?'ELM_MCP_DATABASE_URL':'ELM_REVIEW_DATABASE_URL');
  const db=new URL(databaseUrl);if(!['postgres:','postgresql:'].includes(db.protocol)||db.username!==`elm_${kind}`)throw new Error('Restricted process-specific database role required');
  const host=env.ELM_BIND_HOST??'127.0.0.1';
  if(!local && (env.ELM_APPROVED_SHARED_CONFIG!=='true'||env.ELM_TLS_TERMINATED!=='true'||env.ELM_STORAGE_ENCRYPTION_CONFIRMED!=='true'||env.ELM_RETENTION_APPROVED!=='true'||env.ELM_TEST_MODE||env.ELM_LOCAL_BACKCHANNEL_ORIGIN))throw new Error('Shared configuration gates not satisfied');
  const allowedHosts=(env.ELM_ALLOWED_HOSTS??(kind==='mcp'?au.host:ru.host)).split(',');
  if(allowedHosts.some(x=>!x||x.includes('*')||/[\s/@\\]/.test(x)))throw new Error('Explicit Host allowlist required');
  const allowedOrigins=(env.ELM_ALLOWED_ORIGINS??ru.origin).split(',');for(const x of allowedOrigins){if(origin(x,local).origin!==x)throw new Error('Origins must be exact origins');}
  const backchannelOrigin=env.ELM_LOCAL_BACKCHANNEL_ORIGIN;
  if(backchannelOrigin){const u=origin(backchannelOrigin,true);if(!local||!['localhost','127.0.0.1','keycloak'].includes(u.hostname)||u.pathname!=='/')throw new Error('Backchannel override is local-only');}
  const port=Number(env.ELM_PORT??(kind==='mcp'?4100:4101));if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
  const clientIds=required(env,'ELM_ALLOWED_CLIENT_IDS').split(',');if(clientIds.some(x=>!x||x.includes('*')))throw new Error('Explicit OAuth client IDs required');
  return {profile,organizationId:org,databaseUrl,host,port,issuer:iu.href.replace(/\/$/,''),audience:au.href,reviewBase:ru.origin,
    jwksUrl,allowedClientIds:clientIds,allowedHosts,allowedOrigins,
    publicDocsHosts:(env.ELM_PUBLIC_DOC_HOSTS??'nodejs.org,postgresql.org,www.postgresql.org,modelcontextprotocol.io').split(','),
    scannerBin:resolve(required(env,'ELM_GITLEAKS_BIN')),scannerConfig:resolve(env.ELM_GITLEAKS_CONFIG??'config/gitleaks.toml'),
    oidcClientId:kind==='review'?required(env,'ELM_REVIEW_CLIENT_ID'):'',oidcClientSecret:kind==='review'?required(env,'ELM_REVIEW_CLIENT_SECRET'):'',backchannelOrigin,sessionHours:8};
}
export function checkHttpBoundary(headers:Record<string,unknown>,config:Config,mutation=false):void {
  if(typeof headers.host!=='string'||!config.allowedHosts.includes(headers.host))fail('FORBIDDEN');
  const o=headers.origin;if(o!==undefined&&(typeof o!=='string'||!config.allowedOrigins.includes(o)))fail('FORBIDDEN');
  if(mutation&&o===undefined)fail('FORBIDDEN');
  if(headers['sec-fetch-site']==='cross-site'&&mutation)fail('FORBIDDEN');
}
