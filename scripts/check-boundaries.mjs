import {readFile,readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {API} from 'typescript/unstable/sync';
import * as ts from 'typescript/unstable/ast';
const api=new API({cwd:process.cwd()});
const snapshot=api.updateSnapshot({openProjects:[join(process.cwd(),'tsconfig.json')]});
const program=snapshot.getProjects()[0].program;
const violations=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else if(path.endsWith('.ts'))check(path,await readFile(path,'utf8'));}}
function check(path,text){
 const source=program.getSourceFile(join(process.cwd(),path));
 if(!source)throw new Error(`Missing parsed source: ${path}`);
 const visit=node=>{
  if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){
   const dep=node.moduleSpecifier.text;
   if(/openai$|anthropic|@atlassian|runtime-codex|uzin-mcp|UUSE/i.test(dep))violations.push(`${path}: forbidden runtime dependency`);
   if(path.startsWith('apps/mcp/')&&/review|maintenance/.test(dep))violations.push(`${path}: review boundary crossed`);
   if(dep==='node:child_process'&&path!=='packages/core/src/security.ts')violations.push(`${path}: process spawning only permitted in fixed scanner adapter`);
  }
  if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['eval','exec','execSync'].includes(node.expression.text))violations.push(`${path}: dynamic execution forbidden`);
  ts.visitEachChild(node,child=>{visit(child);return child;});
 };visit(source);
 if(path.startsWith('apps/mcp/')&&/ELM_REVIEW_CLIENT_SECRET|ELM_REVIEW_DATABASE_URL/.test(text))violations.push(`${path}: review credentials in MCP process`);
}
try{await walk('apps');await walk('packages/core');}finally{snapshot.dispose();api.close();}
const lock=JSON.parse(await readFile('package-lock.json','utf8'));for(const [name,p] of Object.entries(lock.packages)){if(name.startsWith('node_modules/')&&!p.link&&(!p.version||!p.integrity||!p.resolved?.startsWith('https://registry.npmjs.org/')))violations.push(`Unpinned or untrusted lock entry: ${name}`);}
if(violations.length){console.error(violations.join('\n'));process.exitCode=1;}else console.log('Source boundaries and dependency lock verified. This is not an execution sandbox or full security audit.');
