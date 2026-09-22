import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {hash,canonical,assertJsonShape} from '../packages/core/src/canonical.js';
import {loadConfig} from '../packages/core/src/config.js';
import {wireFits,compatibility} from '../packages/core/src/knowledge.js';
import {SecretScanner,normalizeRepository,validateBody} from '../packages/core/src/security.js';
import {safeError} from '../packages/core/src/errors.js';
import {learningBody,parse} from '../packages/core/src/contracts.js';
import {esc,bodyView} from '../apps/review/src/views.js';
import {body} from './helpers.js';
const env:NodeJS.ProcessEnv={ELM_PROFILE:'local',ELM_ORGANIZATION_ID:'10000000-0000-4000-8000-000000000001',ELM_ISSUER:'http://localhost:8180/realms/engineering-learning',ELM_MCP_RESOURCE:'http://localhost:4100/mcp',ELM_REVIEW_URL:'http://localhost:4101',ELM_MCP_DATABASE_URL:'postgresql://elm_mcp:synthetic@localhost/elm_local',ELM_ALLOWED_CLIENT_IDS:'elm-test',ELM_GITLEAKS_BIN:'/nonexistent/gitleaks'};
test('Canonical hashing is locale independent and preserves conditions',()=>{assert.equal(hash({b:1,a:2}),hash({a:2,b:1}));assert.equal(canonical({'ä':1,z:2,a:3}),'{"a":3,"z":2,"ä":1}');assert.notEqual(hash(body('one')),hash(body('two')));});
test('D09: startup refuses shared configuration without explicit deployment gates',()=>{assert.throws(()=>loadConfig('mcp',{...env,ELM_PROFILE:'shared'}));assert.throws(()=>loadConfig('mcp',{...env,ELM_MCP_DATABASE_URL:'postgresql://postgres@localhost/elm_local'}));assert.throws(()=>loadConfig('mcp',{...env,ELM_ALLOWED_HOSTS:'*'}));assert.throws(()=>loadConfig('mcp',{...env,ELM_JWKS_URL:'https://attacker.invalid/keys'}));assert.equal(loadConfig('mcp',env).profile,'local');});
test('C06: controls, prototype keys and excessive nesting are rejected',()=>{for(const x of ['\u0000','\u202e',JSON.parse('{"__proto__":{}}')])assert.throws(()=>assertJsonShape(x));let value:unknown='deep';for(let n=0;n<20;n++)value=[value];assert.throws(()=>assertJsonShape(value));assert.throws(()=>parse(learningBody,{...body(),approved:true}));});
test('C04: review renders text as text, with no active script or remote images',()=>{assert.equal(esc('<script>&"'), '&lt;script&gt;&amp;&quot;');const html=bodyView({...body(),observation:'<img src="https://example.invalid/pixel">'});assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));});
test('D03: unknown version is not silently marked compatible',()=>{assert.equal(compatibility(body(),[]),'requires_check');assert.equal(compatibility(body(),[{name:'node',version:'unknown'}]),'requires_check');assert.equal(compatibility(body(),[{name:'node',version:'22.1.0'}]),'incompatible');});
test('D05: entire dual wire representation is bounded, including Unicode',()=>{assert.equal(wireFits({text:'a'.repeat(17000)}),false);assert.equal(wireFits({text:'😀'.repeat(5000)}),false);assert.equal(wireFits({text:'short'}),true);});
test('Repository hints never establish credentials or allow path traversal',()=>{assert.deepEqual(normalizeRepository({host:'GITHUB.COM',path:'Synthetic/Alpha.git'}),{host:'github.com',path:'synthetic/alpha'});for(const path of ['../repo','/absolute/path','x/../y','https://host/a'])assert.throws(()=>normalizeRepository({host:'github.com',path}));assert.throws(()=>normalizeRepository({host:'user:token@github.com',path:'a/b'}));});
test('A link or a client assertion is not server-verified evidence',()=>{assert.throws(()=>parse(learningBody,{...body(),evidence:[{...body().evidence[0],server_verified:true}]}));assert.throws(()=>validateBody({...body(),evidence:[{kind:'public_documentation',url:'https://nodejs.org/?token=value',summary:'Synthetic reference'}]},['nodejs.org']));});
test('No exception details, SQL or tokens are leaked in safe errors',()=>{assert.deepEqual(safeError(new Error('password=synthetic; SELECT * FROM users')),{code:'DEPENDENCY_UNAVAILABLE'});});
test('C02: scanner deadlines, bounded parallelism and missing executable fail closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'elm-scanner-test-'));try{
  const fake=join(dir,'slow-scanner');await writeFile(fake,'#!/bin/sh\nsleep 2\n',{mode:0o700});
  const scanner=new SecretScanner(fake,resolve('config/gitleaks.toml'),50);
  const values=await Promise.allSettled(Array.from({length:5},()=>scanner.scan({value:'safe synthetic text'})));assert.ok(values.every(v=>v.status==='rejected'));assert.ok(values.some(v=>v.status==='rejected'&&v.reason.code==='RATE_LIMITED'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
