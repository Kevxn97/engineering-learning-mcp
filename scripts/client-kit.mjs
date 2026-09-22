import {readFile,writeFile,mkdir,lstat,realpath,readdir} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const canonical=await readFile(join(root,'packages/client-kit/ENGINEERING_LEARNING_RULES.md'),'utf8');
const start='<!-- engineering-learning:begin -->',end='<!-- engineering-learning:end -->';
const block=`${start}\n${canonical.trim()}\n${end}\n`;
const args=process.argv.slice(2);
if(args.includes('--check')){
 for(const name of await readdir(join(root,'packages/client-kit/templates'))){const p=join(root,'packages/client-kit/templates',name);const text=await readFile(p,'utf8');if(name.endsWith('.json'))JSON.parse(text);if(/Bearer\s+[A-Za-z0-9._-]{20,}/.test(text))throw new Error('Credential-shaped client template');}
 for(const tool of ['knowledge_context','knowledge_search','knowledge_get','knowledge_propose','knowledge_feedback'])if(!canonical.includes(tool))throw new Error(`Missing ${tool} rule`);
 console.log('Client kit contract checked; no real IDE integration implied.');process.exit(0);
}
const projectArg=args[args.indexOf('--project')+1];if(!args.includes('--project')||!projectArg||projectArg.startsWith('--'))throw new Error('Use --project EXISTING_DIRECTORY [--apply]');
const target=resolve(projectArg);if((await lstat(target)).isSymbolicLink()||target!==await realpath(target))throw new Error('Project path must not traverse symlinks');
const apply=args.includes('--apply');
async function candidate(name,desired){
 const path=join(target,name);let old='';try{const st=await lstat(path);if(st.isSymbolicLink()||!st.isFile())throw new Error('Refusing non-regular instruction file');old=await readFile(path,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 const next=desired(old);if(old===next){console.log(`${name}: unchanged`);return;}
 console.log(`--- ${name}\n+++ ${name} (proposed)\n${next}`);
 if(!apply)return;
 if(old){const backup=path+`.elm-backup-${createHash('sha256').update(old).digest('hex').slice(0,12)}`;try{await writeFile(backup,old,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST'||await readFile(backup,'utf8')!==old)throw e;}}
 // Re-check the exact original file before applying; do not silently clobber edits.
 let current='';try{current=await readFile(path,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}if(current!==old)throw new Error('Instruction changed during installation');
 if((await lstat(path).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)))?.isSymbolicLink())throw new Error('Instruction became a symlink');
 await writeFile(path,next,{mode:0o600,flag:old?'w':'wx'});
}
await candidate('AGENTS.md',old=>{if(old.includes(start)||old.includes(end)){if(!old.includes(block))throw new Error('Existing managed block differs; merge explicitly rather than overwriting');return old;}return old+(old.endsWith('\n')||!old?'':'\n')+'\n'+block;});
await candidate('CLAUDE.md',old=>/^@AGENTS\.md\s*$/m.test(old)?old:old+(old.endsWith('\n')||!old?'':'\n')+'\n# Shared engineering knowledge rules\n@AGENTS.md\n');
console.log(apply?'Instruction files applied with backups. MCP configurations were not modified.':'Dry run only. Use --apply to write instructions. MCP config fragments require a reviewed manual merge.');
