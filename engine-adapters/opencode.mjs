import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { providerSettings, inferenceEnvironment } from './opencode-config.mjs';
const exec=promisify(execFile);
export function productConfig(system,bridge){
 const names=['dots_read_file','dots_list_files','dots_write_file','dots_shell','dots_ask_user','dots_send_message','dots_computer_status','dots_computer_screenshot','dots_computer_action'];
 const permissions=[{action:'*',resource:'*',effect:'deny'},...(bridge?names:[]).map(action=>({action,resource:'*',effect:'allow'}))];
 return {agents:{dots:{mode:'primary',system,permissions}},permissions,policies:[{action:'tool.use',resource:'*',effect:'deny'},{action:'integration.use',resource:'*',effect:'deny'},...(bridge?names:[]).map(name=>({action:'tool.use',resource:name+':*',effect:'allow'})),...(bridge?[{action:'integration.use',resource:'mcp:dots',effect:'allow'}]:[])],mcp:{servers:bridge?{dots:bridge}:{}},share:'disabled',snapshots:false,lsp:false,formatter:false,update:'disable'};
}
export class OpenCodeProvider {
 constructor({binary=process.env.OPENCODE_BIN||join(homedir(),'.opencode/bin/opencode'),isolationDir}={}){this.binary=binary;this.isolationDir=isolationDir;}
 async status(){if(!existsSync(this.binary))return {provider:'opencode',installed:false,models:[],error:'OpenCode 2 CLI가 설치되어 있지 않습니다.'};try{let {stdout}=await exec(this.binary,['models'],{timeout:15000,maxBuffer:2e6,env:{...process.env,...inferenceEnvironment(this.isolationDir),OPENCODE_CONFIG_CONTENT:JSON.stringify(providerSettings())}});return {provider:'opencode',installed:true,models:stdout.split('\n').map(s=>s.trim()).filter(s=>/^[^\s/]+\/[^\s]+$/.test(s))};}catch{return {provider:'opencode',installed:true,models:[],error:'OpenCode 모델 목록을 읽지 못했습니다. OpenCode 계정 연결을 확인하세요.'};}}
 async run({model,history,system,bridge,signal,onEvent,images=[]}){
  const dir=mkdtempSync(join(tmpdir(),'dots-inference-'));writeFileSync(join(dir,'opencode.json'),JSON.stringify({...productConfig(system,bridge),...providerSettings()}),{mode:0o600});
  let imagePaths=[];for(let [index,image]of images.entries()){let path=join(dir,`computer-${index}.png`);writeFileSync(path,Buffer.from(image.data,'base64'),{mode:0o600});imagePaths.push(path);}
  const env={...process.env,...inferenceEnvironment(this.isolationDir),PWD:dir,OPENCODE_CONFIG_DIR:dir,OPENCODE_CONFIG:join(dir,'opencode.json'),OPENCODE_DISABLE_CLAUDE_CODE:'1'};delete env.OPENCODE_CONFIG_CONTENT;delete env.OPENCODE_PERMISSION;
  let child;let timer;let killTimer;let aborted=false,timedOut=false,outputLimit=false;
  const stop=()=>{aborted=true;try{process.kill(-child.pid,'SIGTERM');}catch{}killTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},1500);killTimer.unref();};
  try{return await new Promise((resolve,reject)=>{
   child=spawn(this.binary,['run','--standalone','--agent','dots','--format','json','--model',model,...imagePaths.flatMap(path=>['--file',path])],{cwd:dir,env,detached:true,stdio:['pipe','pipe','pipe']});
   let buffer='',answer='',failure=null,stderr='',outputBytes=0;
   child.on('error',reject);child.stderr.on('data',b=>{stderr=(stderr+b).slice(-2000);});
   child.stdout.on('data',b=>{outputBytes+=b.length;if(outputBytes>4e6){outputLimit=true;stop();return;}buffer+=b;let lines=buffer.split('\n');buffer=lines.pop();for(let line of lines){try{let e=JSON.parse(line);if(e.type==='text')answer=e.part?.text||answer;if(e.type==='error')failure=e.error?.type||'unknown';onEvent?.(e);}catch{}}});
   child.on('close',code=>{if(aborted||signal?.aborted)return reject(Object.assign(new Error(outputLimit?'모델 출력이 허용된 크기를 초과했습니다.':timedOut?'모델 응답 제한 시간(3분)을 초과했습니다.':'작업을 취소했습니다.'),{code:outputLimit?'OUTPUT_LIMIT':timedOut?'TIMED_OUT':'CANCELLED'}));if(/<longcat_tool_call>|<tool_call>|<function_call>/i.test(answer))return reject(Object.assign(new Error('모델이 도구 호출을 일반 텍스트로 반환하여 실행하지 못했습니다. 다른 모델을 선택하거나 다시 시도해 주세요.'),{code:'UNEXECUTED_TOOL_CALL'}));if(failure||code!==0||!answer.trim())return reject(Object.assign(new Error(failure==='provider.auth'?'OpenCode 모델 인증 또는 계정 이용 권한을 확인하세요.':failure==='provider.invalid-request'?'이 계정에서 선택한 모델을 사용할 수 없습니다. 설정에서 모델을 바꿔 주세요.':'OpenCode가 응답을 완료하지 못했습니다. 모델과 계정 연결 상태를 확인하세요.'),{code:failure||'OPENCODE_RUN_FAILED'}));resolve(answer);});
   timer=setTimeout(()=>{timedOut=true;stop();},180000);timer.unref();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
   const instruction=bridge?'Respond to the latest request. Use the provided Dots tools for actions. Never claim an action without a successful tool result.':'Follow the system response format. No execution tools are available in this call. If the system requests a JSON tool plan, return the requested plan as text data for the local runtime to execute; do not attempt a native tool call. Never claim an action without a successful tool result in the history.';
   child.stdin.on('error',()=>{});child.stdin.end('Conversation history (JSON data with role labels):\n'+JSON.stringify(history)+'\n'+instruction);
  });}finally{clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',stop);try{if(child?.pid)process.kill(-child.pid,'SIGKILL');}catch{}rmSync(dir,{recursive:true,force:true});}
 }
}
