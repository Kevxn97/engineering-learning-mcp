import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,type CryptoKey} from 'jose';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createMcpApp} from '../apps/mcp/src/app.js';
import {TokenVerifier} from '../packages/core/src/auth.js';
import {setup,type Harness} from './helpers.js';
import {outputSchema} from '../packages/core/src/outputs.js';
import {ids} from '../fixtures/synthetic/ids.js';
import type {FastifyInstance} from 'fastify';
let h:Harness,app:FastifyInstance,privateKey:CryptoKey,base:string,token:string;
async function sign(changes:Record<string,unknown>={}){return new SignJWT({typ:'Bearer',azp:'elm-test',scope:'knowledge:read knowledge:propose knowledge:feedback',iss:h.config.issuer,sub:ids.alice,aud:h.config.audience,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...changes}).setProtectedHeader({alg:'RS256',typ:'JWT'}).sign(privateKey);}
before(async()=>{h=await setup();const pair=await generateKeyPair('RS256');privateKey=pair.privateKey;app=createMcpApp(h.config,h.mcp,h.knowledge,new TokenVerifier(h.config,async()=>pair.publicKey));await app.listen({port:0,host:'127.0.0.1'});const address=app.server.address();assert.ok(address&&typeof address!=='string');base=`http://127.0.0.1:${address.port}`;h.config.allowedHosts=[`127.0.0.1:${address.port}`];h.config.audience=`${base}/mcp`;token=await sign();});
after(async()=>{await app?.close();await h?.close();});
const request=(path:string,headers:Record<string,string>={},body?:unknown)=>fetch(`${base}${path}`,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
test('A01: missing, malformed, expired, wrong audience/issuer, ID and unapproved-client tokens are rejected',async()=>{
 for(const bearer of ['', 'not-a-jwt', await sign({exp:Math.floor(Date.now()/1000)-60}),await sign({aud:'https://wrong.invalid/mcp'}),await sign({iss:'https://wrong.invalid'}),await sign({typ:'ID'}),await sign({azp:'other-client'})]){
  const r=await request('/mcp',bearer?{authorization:`Bearer ${bearer}`}:{},{jsonrpc:'2.0',id:1,method:'tools/list'});assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate')??'',/resource_metadata=/);
 }
 const meta=await request('/.well-known/oauth-protected-resource/mcp');assert.equal(meta.status,200);assert.equal((await meta.json() as {resource:string}).resource,h.config.audience.replace(base,'http://localhost:4100')); // metadata captured at construction
});
test('C07/C08: Host, Origin, token-in-URL and oversized requests are rejected',async()=>{
 const r=await app.inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,host:'evil.invalid'},payload:{jsonrpc:'2.0',id:1,method:'tools/list'}});assert.equal(r.statusCode,403);
 assert.equal((await request('/mcp',{authorization:`Bearer ${token}`,origin:'https://evil.invalid'},{jsonrpc:'2.0',id:1,method:'tools/list'})).status,403);
 assert.equal((await request('/mcp?access_token=synthetic')).status,400);
 const large=await request('/mcp',{authorization:`Bearer ${token}`},{x:'a'.repeat(70*1024)});assert.equal(large.status,413);
});
test('SDK contract (not native IDE acceptance): official SDK v2 negotiates transport and exposes exactly five scope-bound tools',async()=>{
 const client=new Client({name:'synthetic-sdk-client',version:'1.0.0'});const transport=new StreamableHTTPClientTransport(new URL(`${base}/mcp`),{requestInit:{headers:{authorization:`Bearer ${token}`}}});
 await client.connect(transport);try{const listed=await client.listTools();assert.deepEqual(listed.tools.map(t=>t.name).sort(),['knowledge_context','knowledge_feedback','knowledge_get','knowledge_propose','knowledge_search']);
 const response=await client.callTool({name:'knowledge_context',arguments:{project_id:ids.alpha}});assert.ok(response.structuredContent);assert.equal(outputSchema('knowledge_context').parse(response.structuredContent).ok,true);assert.ok(Buffer.byteLength(JSON.stringify(response))<32*1024);
 const denied=await client.callTool({name:'knowledge_context',arguments:{project_id:ids.beta}});assert.equal(denied.isError,true);assert.equal(outputSchema('knowledge_context').parse(denied.structuredContent).error?.code,'NOT_AVAILABLE');
 }finally{await client.close();}
});
test('A02: read-only OAuth scope cannot list or invoke proposal tool',async()=>{
 const read=await sign({scope:'knowledge:read'});const client=new Client({name:'synthetic-read-only',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`),{requestInit:{headers:{authorization:`Bearer ${read}`}}}));try{assert.equal((await client.listTools()).tools.length,3);await assert.rejects(client.callTool({name:'knowledge_propose',arguments:{}}));}finally{await client.close();}
});
test('Legacy 2025-03-26 initialize and tools/list are handled by the official SDK',async()=>{
 const headers={authorization:`Bearer ${token}`,accept:'application/json, text/event-stream'};
 const init=await request('/mcp',headers,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'legacy-synthetic',version:'1'}}});assert.equal(init.status,200);const raw=await init.text();assert.match(raw,/protocolVersion/);
 const list=await request('/mcp',{...headers,'mcp-protocol-version':'2025-03-26'},{jsonrpc:'2.0',id:2,method:'tools/list',params:{}});assert.equal(list.status,200);assert.match(await list.text(),/knowledge_context/);
});
