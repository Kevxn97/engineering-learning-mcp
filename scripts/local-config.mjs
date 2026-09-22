import {mkdir,writeFile,access,chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {ids} from '../fixtures/synthetic/ids.ts';
await mkdir('.local',{recursive:true,mode:0o700});
await chmod('.local',0o700);
await mkdir('.local/keycloak',{recursive:true,mode:0o755});
await chmod('.local/keycloak',0o755); // Bind-mounted realm only; private credentials stay in .local/config.json (0600).
try{await access('.local/config.json');console.log('Local configuration already exists; not overwriting secrets.');process.exit(0);}catch{}
const secret=()=>randomBytes(24).toString('hex');
const passwords=Object.fromEntries(['alice','bob','charlie','dana','mallory','admin'].map(u=>[u,secret()]));
const config={issuer:'http://localhost:8180/realms/engineering-learning',resource:'http://localhost:4100/mcp',review:'http://localhost:4101',org:ids.org,postgres:secret(),mcpDb:secret(),reviewDb:secret(),maintenanceDb:secret(),reviewClient:secret(),keycloakAdmin:secret(),users:passwords};
await writeFile('.local/config.json',JSON.stringify(config,null,2),{mode:0o600});
const realm={realm:'engineering-learning',enabled:true,sslRequired:'none',registrationAllowed:false,resetPasswordAllowed:false,accessTokenLifespan:300,loginWithEmailAllowed:false,
 clientScopes:['knowledge:read','knowledge:propose','knowledge:feedback'].map(name=>({name,protocol:'openid-connect',attributes:{'include.in.token.scope':'true','display.on.consent.screen':'true'}})),
 clients:[{clientId:'elm-review',name:'Engineering Learning Review',enabled:true,publicClient:false,secret:config.reviewClient,standardFlowEnabled:true,directAccessGrantsEnabled:false,redirectUris:[`${config.review}/auth/callback`],webOrigins:[config.review],attributes:{'pkce.code.challenge.method':'S256'},defaultClientScopes:[]},
 ...['elm-test','elm-codex','elm-claude','elm-cursor'].map(clientId=>({clientId,enabled:true,publicClient:true,standardFlowEnabled:true,directAccessGrantsEnabled:false,redirectUris:clientId==='elm-test'?['http://127.0.0.1:8799/callback']:[],webOrigins:[],attributes:{'pkce.code.challenge.method':'S256'},defaultClientScopes:['knowledge:read'],optionalClientScopes:['knowledge:propose','knowledge:feedback'],protocolMappers:[{name:'subject',protocol:'openid-connect',protocolMapper:'oidc-sub-mapper',config:{'access.token.claim':'true','introspection.token.claim':'true'}},{name:'mcp-resource-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',config:{'included.custom.audience':config.resource,'access.token.claim':'true','id.token.claim':'false'}}]}))],
 users:Object.entries(passwords).map(([username,password])=>({id:ids[username],username,enabled:true,email:`${username}@example.invalid`,emailVerified:true,firstName:'Synthetic',lastName:username,credentials:[{type:'password',value:password,temporary:false}]}))};
await writeFile('.local/keycloak/realm.json',JSON.stringify(realm,null,2),{mode:0o644});
const base={ELM_PROFILE:'local',ELM_ORGANIZATION_ID:ids.org,ELM_ISSUER:config.issuer,ELM_MCP_RESOURCE:config.resource,ELM_REVIEW_URL:config.review,ELM_ALLOWED_CLIENT_IDS:'elm-test,elm-codex,elm-claude,elm-cursor',ELM_GITLEAKS_BIN:process.env.ELM_GITLEAKS_BIN??resolve('.local/bin/gitleaks'),ELM_PUBLIC_DOC_HOSTS:'nodejs.org,www.postgresql.org,postgresql.org,modelcontextprotocol.io'};
const pgHost=process.env.ELM_LOCAL_PG_HOST??'127.0.0.1:5432';
const writeEnv=async(name,vars)=>writeFile(`.local/${name}.env`,Object.entries(vars).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
await writeEnv('mcp',{...base,ELM_PORT:4100,ELM_MCP_DATABASE_URL:`postgresql://elm_mcp:${config.mcpDb}@${pgHost}/elm_local`,ELM_ALLOWED_HOSTS:'localhost:4100,127.0.0.1:4100'});
await writeEnv('review',{...base,ELM_PORT:4101,ELM_REVIEW_DATABASE_URL:`postgresql://elm_review:${config.reviewDb}@${pgHost}/elm_local`,ELM_REVIEW_CLIENT_ID:'elm-review',ELM_REVIEW_CLIENT_SECRET:config.reviewClient,ELM_ALLOWED_HOSTS:'localhost:4101,127.0.0.1:4101'});
await writeEnv('compose',{POSTGRES_PASSWORD:config.postgres,MCP_DB_PASSWORD:config.mcpDb,REVIEW_DB_PASSWORD:config.reviewDb,MAINTENANCE_DB_PASSWORD:config.maintenanceDb,KEYCLOAK_ADMIN_PASSWORD:config.keycloakAdmin,REVIEW_CLIENT_SECRET:config.reviewClient});
console.log('Generated local-only configuration in .local/. Synthetic login credentials: .local/config.json. Native-client callback registrations remain intentionally empty until verified.');
