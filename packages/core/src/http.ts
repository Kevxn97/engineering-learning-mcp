import type {FastifyInstance} from 'fastify';
import {safeError,httpStatus} from './errors.js';
export function harden(app:FastifyInstance,withErrorHandler=true):void{
 app.addHook('onRequest',async(_req,reply)=>{reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY').header('Content-Security-Policy',"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");});
 if(withErrorHandler)app.setErrorHandler((e,_req,reply)=>{const err=safeError(e);return reply.code(httpStatus(e)).send({error:err});});
}
export function shutdown(app:FastifyInstance,close:()=>Promise<void>):void{
 let closing=false;for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{if(closing)return;closing=true;void app.close().then(close).catch(()=>{process.exitCode=1;});});
}
