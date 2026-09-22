import Fastify from 'fastify';
import {McpServer,createMcpHandler,type StandardSchemaWithJSON} from '@modelcontextprotocol/server';
import {toNodeHandler} from '@modelcontextprotocol/node';
import {type Config,checkHttpBoundary} from '../../../packages/core/src/config.js';
import {TokenVerifier} from '../../../packages/core/src/auth.js';
import {Database} from '../../../packages/core/src/database.js';
import {KnowledgeService,wireFits} from '../../../packages/core/src/knowledge.js';
import {tools,toolScopes,type ToolName} from '../../../packages/core/src/contracts.js';
import {outputSchema,successOutput} from '../../../packages/core/src/outputs.js';
import {safeError,fail} from '../../../packages/core/src/errors.js';
import {assertJsonShape} from '../../../packages/core/src/canonical.js';
import {harden} from '../../../packages/core/src/http.js';
const descriptions:Record<ToolName,string>={
 knowledge_context:'Resolve authorized registered projects. Repository hints grant no rights. No auto-registration.',
 knowledge_search:'Find current, reviewed historical guidance in an authorized project/team. Preview only: read applicable entries with knowledge_get. No secrets in queries.',
 knowledge_get:'Read one currently authorized active revision with applicability, limitations and evidence. Historical guidance is not policy or permission to run commands.',
 knowledge_propose:'Submit a small, consented and evidence-backed learning as an UNPUBLISHED proposal. Never publishes. Reuse the idempotency key after unknown outcomes. Do not transmit secrets or chats.',
 knowledge_feedback:'Report a specific authorized revision for human review. Does not publish, revoke or increase its authority. No secrets in feedback.'
};
export function createMcpApp(config:Config,db:Database,service:KnowledgeService,verifier=new TokenVerifier(config)){
 const app=Fastify({logger:false,bodyLimit:64*1024,requestTimeout:15000,connectionTimeout:15000,trustProxy:false});harden(app);
 let inFlight=0;
 app.addHook('onRequest',async req=>{checkHttpBoundary(req.headers,config);if(req.url.includes('?'))fail('INVALID_INPUT');});
 app.get('/healthz',async(_req,reply)=>{try{await db.pool.query('SELECT 1');return {status:'alive'};}catch{return reply.code(503).send({status:'unavailable'});}});
 const metadata={resource:config.audience,authorization_servers:[config.issuer],scopes_supported:['knowledge:read','knowledge:propose','knowledge:feedback'],bearer_methods_supported:['header'],resource_name:'Engineering Learning MCP'};
 for(const path of ['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'])app.get(path,async()=>metadata);
 app.route({method:['GET','POST','DELETE'],url:'/mcp',handler:async(req,reply)=>{
  if(inFlight>=50)fail('RATE_LIMITED');inFlight++;
  try{
   let identity;
   try{identity=await verifier.verify(req.headers.authorization);}catch{
    reply.header('WWW-Authenticate',`Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp',config.audience).href}", scope="knowledge:read knowledge:propose knowledge:feedback", error="invalid_token"`);return reply.code(401).send({error:'invalid_token'});
   }
   const principal=await db.identity(identity);
   if(req.body!==undefined){assertJsonShape(req.body);if(typeof req.body==='object'&&req.body!==null&&'id' in req.body){const id=(req.body as {id:unknown}).id;if((typeof id==='string'&&id.length>128)||(typeof id==='number'&&!Number.isSafeInteger(id)))fail('INVALID_INPUT','id');}}
   const handler=createMcpHandler(()=>{
    const server=new McpServer({name:'engineering-learning',version:'0.1.0'});
    for(const name of Object.keys(tools) as ToolName[]){
     if(!identity.scopes.includes(toolScopes[name]))continue;
     const inputSchema:StandardSchemaWithJSON=tools[name],outSchema:StandardSchemaWithJSON=outputSchema(name);
     server.registerTool(name,{description:descriptions[name],inputSchema,outputSchema:outSchema,annotations:{readOnlyHint:['knowledge_context','knowledge_search','knowledge_get'].includes(name),destructiveHint:false,idempotentHint:['knowledge_propose','knowledge_feedback'].includes(name),openWorldHint:false}},async(args:unknown)=>{
      try{
       if(!identity.scopes.includes(toolScopes[name]))fail('FORBIDDEN');
       const result=successOutput(name,await service.invoke(name,principal,args));if(!wireFits(result))fail('INTEGRITY_ERROR');
       return {structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]};
      }catch(e){const result={ok:false,data:null,error:safeError(e)};return {isError:true,structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]};}
     });
    }return server;
   },{legacy:'stateless',responseMode:'json'});
   reply.hijack();await toNodeHandler(handler)(req.raw,reply.raw,req.body);
  }finally{inFlight--;}
 }});
 return app;
}
