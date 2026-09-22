import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fail, DomainError } from './errors.js';
import { assertJsonShape, assertSize } from './canonical.js';
import type { LearningBody } from './contracts.js';
export class SecretScanner {
  private active=0;
  constructor(private readonly binary:string,private readonly config:string,private readonly timeoutMs=2500) {
    if(!isAbsolute(binary)||!isAbsolute(config))throw new Error('Scanner paths must be absolute');
  }
  async scan(value:unknown):Promise<void> {
    assertJsonShape(value);assertSize(value,64*1024);
    if(this.active>=4)fail('RATE_LIMITED');
    this.active++;
    try { await new Promise<void>((resolve,reject)=>{
      const child=spawn(this.binary,['stdin','--config',this.config,'--no-banner','--no-color','--redact=100','--log-level','error','--exit-code','42','--ignore-gitleaks-allow','--gitleaks-ignore-path','/dev/null'],{shell:false,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',GOMAXPROCS:'1'}});
      let exceeded=false,bytes=0,settled=false;
      const stop=(err:DomainError)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill('SIGKILL');reject(err);};
      const timer=setTimeout(()=>stop(new DomainError('DEPENDENCY_UNAVAILABLE')),this.timeoutMs);
      const discard=(b:Buffer)=>{bytes+=b.length;if(bytes>16384){exceeded=true;stop(new DomainError('DEPENDENCY_UNAVAILABLE'));}};
      child.stdout.on('data',discard);child.stderr.on('data',discard);
      child.on('error',()=>stop(new DomainError('DEPENDENCY_UNAVAILABLE')));
      child.stdin.on('error',()=>stop(new DomainError('DEPENDENCY_UNAVAILABLE')));
      child.on('close',code=>{if(settled)return;settled=true;clearTimeout(timer);if(exceeded||code!==0&&code!==42)reject(new DomainError('DEPENDENCY_UNAVAILABLE'));else if(code===42)reject(new DomainError('CONTENT_REJECTED','secret_scan'));else resolve();});
      // A schema-validated UUID is an operation identifier, not free text. Keep all
      // content fields intact; do not disable Gitleaks' generic API-key rule.
      const payload=JSON.stringify(value,(name,v:unknown)=>name==='idempotency_key'&&typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)?'uuid':v);
      child.stdin.end(payload);
    }); } finally {this.active--;}
  }
}
export function normalizeRepository(hint:{host:string;path:string}):{host:string;path:string} {
  const host=hint.host.toLowerCase();let path=hint.path.replace(/\.git$/,'').replace(/\/$/,'');
  if(!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(host)||host.includes('..')||!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(path)||path.split('/').some(x=>x==='.'||x==='..'))fail('INVALID_INPUT','repository_hint');
  if(['github.com','bitbucket.org'].includes(host))path=path.toLowerCase();
  return {host,path};
}
export function validateBody(body:LearningBody,docsHosts:readonly string[],team=false):void {
  assertSize(body,12*1024);assertJsonShape(body);
  for(const e of body.evidence){
    if(e.kind==='repository'){
      if(team)fail('CONTENT_REJECTED','evidence.team_scope');
      if(e.path && (e.path.startsWith('/')||/^[a-z]:/i.test(e.path)||e.path.includes('\\')||e.path.split('/').some(x=>x==='..'||x==='.')||e.path.includes('://')))fail('INVALID_INPUT','evidence.path');
    }
    if(e.kind==='public_documentation'){
      const u=new URL(e.url);
      if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||!docsHosts.includes(u.hostname)||u.hostname==='localhost')fail('CONTENT_REJECTED','evidence.url');
    }
  }
  // Fixed shape restrictions, not a claim of complete DLP. Gitleaks scans all free text separately.
  const serialized=JSON.stringify(body);
  if(/https?:\/\/[^\s"/]+@/i.test(serialized)||/<\s*(script|iframe|img|object|embed)\b/i.test(serialized)||/javascript\s*:/i.test(serialized)||/!\[[^\]]*\]\(/.test(serialized))fail('CONTENT_REJECTED','active_content');
}
export function enforceReadText(value:string):void {if(Buffer.byteLength(value,'utf8')>1024)fail('INVALID_INPUT','query');}
