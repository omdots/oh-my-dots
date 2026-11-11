// Opt-in real CLI check against a local HTTP fixture. No cloud credentials or
// external inference service are used. Requires the installed OpenCode 2 CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OpenCodeProvider } from '../engine-adapters/opencode.mjs';
test('real OpenCode 2 sends configured inference to the local compatible provider',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'dots-provider-check-'));const requests=[];
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    requests.push({url:req.url,authorization:req.headers.authorization,body:JSON.parse(body||'{}')});
    if(req.method==='GET'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:[{id:'fixture-model',object:'model'}]}));}
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    for(const chunk of [{id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta:{role:'assistant',content:'Provider integration OK'},finish_reason:null}]},{id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14}}])res.write('data: '+JSON.stringify(chunk)+'\n\n');res.end('data: [DONE]\n\n');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const old=process.env.DOTS_PROVIDER_CONFIG;process.env.DOTS_PROVIDER_CONFIG=join(directory,'providers.json');
  t.after(async()=>{if(old===undefined)delete process.env.DOTS_PROVIDER_CONFIG;else process.env.DOTS_PROVIDER_CONFIG=old;await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
  await writeFile(process.env.DOTS_PROVIDER_CONFIG,JSON.stringify({env:{FIXTURE_API_KEY:'fixture-key'},providers:{fixture:{env:['FIXTURE_API_KEY'],package:'@opencode/ai/providers/openai-compatible',settings:{baseURL:'http://127.0.0.1:'+server.address().port+'/v1'},models:{'fixture-model':{name:'Fixture',limit:{context:32000,output:1024}}}}}}),{mode:0o600});
  const provider=new OpenCodeProvider({isolationDir:join(directory,'isolated')});
  const result=await provider.run({model:'fixture/fixture-model',system:'Reply briefly.',history:[{role:'user',content:'Hello'}]});
  assert.equal(result,'Provider integration OK');assert.equal(requests.at(-1).authorization,'Bearer fixture-key');assert.equal(requests.at(-1).body.model,'fixture-model');assert.match(requests.at(-1).url,/chat\/completions/);
});
