// Live local Keycloak test: PKCE code exchange, review cookie rotation and MCP access.
// HTTP mode drives actual HTML forms without claiming a native IDE or browser test.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {request,chromium,type APIRequestContext,type Page} from '@playwright/test';
import * as oidc from 'openid-client';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {ids} from '../fixtures/synthetic/ids.js';
import {body} from './helpers.js';
import {outputSchema} from '../packages/core/src/outputs.js';
import {randomUUID} from 'node:crypto';
const cfg=JSON.parse(await readFile('.local/config.json','utf8')) as {issuer:string;review:string;resource:string;users:Record<string,string>};
const html=(s:string)=>s.replaceAll('&amp;','&').replaceAll('&#39;',"'").replaceAll('&quot;','"');
async function loginForm(ctx:APIRequestContext,url:string,user:string){
 const page=await ctx.get(url);assert.equal(page.status(),200);const content=await page.text();const action=/\baction="([^"]+)"/.exec(content)?.[1];assert.ok(action,'Actual Keycloak login form expected');
 const target=new URL(html(action));assert.equal(target.origin,new URL(cfg.issuer).origin);
 const res=await ctx.post(target.href,{form:{username:user,password:cfg.users[user]!,credentialId:''},maxRedirects:0});assert.ok([302,303].includes(res.status()),'Keycloak must return an authorization redirect');return res.headers().location!;
}
async function reviewLogin(user:string){const ctx=await request.newContext();const start=await ctx.get(`${cfg.review}/auth/login`,{maxRedirects:0});assert.equal(start.status(),302);const before=start.headers()['set-cookie'];assert.match(before??'',/HttpOnly/);assert.match(before??'',/SameSite=Lax/);
 const callback=await loginForm(ctx,start.headers().location!,user);assert.equal(new URL(callback).origin,cfg.review);const result=await ctx.get(callback,{maxRedirects:0});assert.equal(result.status(),302,await result.text());assert.notEqual(result.headers()['set-cookie'],before);return ctx;}
const publicClient=await oidc.discovery(new URL(cfg.issuer),'elm-test',undefined,oidc.None(),{execute:[oidc.allowInsecureRequests]});
const verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce();const authorize=oidc.buildAuthorizationUrl(publicClient,{redirect_uri:'http://127.0.0.1:8799/callback',scope:'openid knowledge:read knowledge:propose knowledge:feedback',resource:cfg.resource,state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256'});
const oauthContext=await request.newContext();const callback=await loginForm(oauthContext,authorize.href,'alice');
const tokens=await oidc.authorizationCodeGrant(publicClient,new URL(callback),{pkceCodeVerifier:verifier,expectedState:state,expectedNonce:nonce});assert.ok(tokens.access_token);await oauthContext.dispose();
const client=new Client({name:'synthetic-live-oidc-client',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(cfg.resource),{requestInit:{headers:{authorization:`Bearer ${tokens.access_token}`}}}));
let proposalId:string;
try{assert.equal((await client.listTools()).tools.length,5);const value=await client.callTool({name:'knowledge_propose',arguments:{project_id:ids.alpha,body:body(`oidc-${Date.now()}`),idempotency_key:randomUUID()}});const parsed=outputSchema('knowledge_propose').parse(value.structuredContent);assert.equal(parsed.ok,true,JSON.stringify(parsed.error));assert.ok(parsed.data&&'proposal_id' in parsed.data);proposalId=String(parsed.data.proposal_id);}finally{await client.close();}
const bob=await reviewLogin('bob');let detail=await bob.get(`${cfg.review}/proposals/${proposalId}`);assert.equal(detail.status(),200);let text=await detail.text();assert.match(text,/Review this exact revision/);
const input=(name:string)=>html(new RegExp(`name="${name}" value="([^"]*)"`).exec(text)?.[1]??'');
const form={csrf:input('csrf'),proposal_id:input('proposal_id'),revision:input('revision'),content_hash:input('content_hash'),target_team_id:input('target_team_id'),base_revision:input('base_revision'),idempotency_key:input('idempotency_key'),decision:'accept',accuracy:'yes',applicability:'yes',evidence:'yes',no_secrets:'yes',audience:'yes',reason:'Synthetic live OIDC reference checked.',valid_days:'30'};
assert.equal((await bob.post(`${cfg.review}/decide`,{form,headers:{origin:'https://wrong.invalid'}})).status(),403);
assert.equal((await bob.post(`${cfg.review}/decide`,{form:{...form,csrf:'incorrect'},headers:{origin:cfg.review}})).status(),403);
assert.equal((await bob.post(`${cfg.review}/decide`,{form,headers:{origin:cfg.review,authorization:`Bearer ${tokens.access_token}`}})).status(),403);
const accepted=await bob.post(`${cfg.review}/decide`,{form,headers:{origin:cfg.review}});assert.equal(accepted.status(),200,await accepted.text());assert.match(await accepted.text(),/accepted/);
const alice=await reviewLogin('alice');const page=await alice.get(`${cfg.review}/proposals/${proposalId}`);assert.match(await page.text(),/cannot review your own proposal/);await alice.dispose();await bob.dispose();
await mkdir('artifacts',{recursive:true});
let browserVerified=false;
if(process.env.ELM_BROWSER_E2E==='true'){
 const browser=await chromium.launch({headless:true,...(process.env.ELM_BROWSER_EXECUTABLE?{executablePath:process.env.ELM_BROWSER_EXECUTABLE}:{})});
 try{const p=await browser.newPage({viewport:{width:1440,height:1000}});await p.goto(cfg.review);await p.getByText('Sign in securely').click();await p.locator('#username').fill('bob');await p.locator('#password').fill(cfg.users.bob!);await p.locator('#kc-login').click();await p.waitForURL(cfg.review+'/');await p.goto(`${cfg.review}/proposals/${proposalId}`);await p.getByRole('heading',{name:'Proposal review'}).waitFor();await p.screenshot({path:'artifacts/review-desktop.png',fullPage:true});await p.setViewportSize({width:390,height:844});await p.screenshot({path:'artifacts/review-mobile.png',fullPage:true});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);browserVerified=true;}finally{await browser.close();}
}
console.log(JSON.stringify({test:'real-keycloak-pkce-and-review',result:'passed',checks:['PKCE','nonce','state','token_audience','five_tools','proposal','cookie_rotation','peer_review','CSRF','Origin','bearer_rejected_by_review'],browser:browserVerified?'passed':'not_executed',native_ides:'NOT_VERIFIED'}));
