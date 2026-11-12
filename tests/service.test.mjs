import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createService } from '../server/service.mjs';
const provider={status:async()=>({installed:true,models:['fixture/model']}),run:async()=> '계정 저장 확인'};
async function setup(t,options={}){
  const directory=await mkdtemp(join(tmpdir(),'dots-accounts-'));const reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const base='http://127.0.0.1:'+port;const old=process.env.DOTS_PROVIDER_CONFIG;delete process.env.DOTS_PROVIDER_CONFIG;
  const service=await createService({directory,publicUrl:base,providerFactory:()=>provider,...options});await new Promise(r=>service.server.listen(port,'127.0.0.1',r));
  t.after(async()=>{await service.close();if(old===undefined)delete process.env.DOTS_PROVIDER_CONFIG;else process.env.DOTS_PROVIDER_CONFIG=old;await rm(directory,{recursive:true,force:true});});
  async function request(path,{cookie,body,method=body?'POST':'GET',origin=base}={}){const response=await fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});return {response,status:response.status,value:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const bootstrap=await readFile(service.bootstrapPath,'utf8');
  return {...service,directory,base,request,bootstrap};
}
const admin={username:'owner',password:'a-secure-admin-password',displayName:'관리자'};
test('service account isolation, two browser sessions, server state and guarded administration',async t=>{
  const app=await setup(t);const {request}=app;
  assert.equal((await request('/api/state')).status,401);assert.equal((await request('/original/webview/')).status,302);
  assert.equal((await request('/api/auth/setup',{body:{...admin,setupCode:'0'.repeat(64)}})).status,403);
  const owner=await request('/api/auth/setup',{body:{...admin,setupCode:app.bootstrap}});assert.equal(owner.status,200);assert.match(owner.response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
  assert.equal((await request('/api/auth/setup',{body:{...admin,setupCode:app.bootstrap}})).status,409);
  const cookie=owner.cookie;
  const accountPage=await request('/account',{cookie});
  assert.equal(accountPage.status,302);assert.equal(accountPage.response.headers.get('location'),'/original/webview/?settings=account');
  const p=(await request('/api/profiles',{cookie,body:{display_name:'첫 Dot'}})).value;
  assert.equal((await request('/api/profiles',{cookie,body:{display_name:'두 번째 Dot'}})).status,201);
  assert.equal((await request('/api/ui-state',{cookie,method:'PATCH',body:{section:'metadata',key:p.id,value:{avatar:'frog',accent_color:'blue'}}})).status,200);
  const sent=(await request('/api/messaging/rooms/'+p.room_id+'/messages',{cookie,body:{content:{text:'기록 보존'},request_id:'once',idempotency_token:'once'}})).value;
  for(let n=0;n<100;n++){const task=await request('/api/tasks/'+sent.task.id,{cookie});if(task.value.status==='completed')break;await new Promise(r=>setTimeout(r,20));}
  const browser2=await request('/api/auth/login',{body:admin});assert.equal(browser2.status,200);assert.notEqual(browser2.cookie,cookie);
  const state=(await request('/api/state',{cookie:browser2.cookie})).value;assert.equal(state.profiles.length,2);assert.equal(state.messages.length,2);assert.equal(state.messages.at(-1).content.text,'계정 저장 확인');
  assert.equal((await request('/api/ui-state',{cookie:browser2.cookie})).value.metadata[p.id].avatar,'frog');
  assert.equal((await request('/api/accounts',{cookie,body:{username:'second',password:'another-secure-password'}})).status,201);
  const other=(await request('/api/auth/login',{body:{username:'second',password:'another-secure-password'}})).cookie;
  assert.equal((await request('/api/state',{cookie:other})).value.profiles.length,0);
  assert.deepEqual((await request('/api/ui-state',{cookie:other})).value.metadata,{});
  assert.equal((await request('/api/rooms/'+p.room_id+'/messages',{cookie:other})).status,404);
  assert.equal((await request('/api/tasks/'+sent.task.id,{cookie:other})).status,404);
  assert.equal((await request('/api/accounts',{cookie:other})).status,403);
  assert.equal((await request('/api/computer/start',{cookie:other,body:{}})).status,409);
  const isolated=await app.appFor(app.accounts.list().find(u=>u.username==='second'));
  assert.equal((await fetch('http://127.0.0.1:'+isolated.server.address().port+'/api/state')).status,401);
  assert.equal(isolated.store.getSettings().computer_enabled,false);
  assert.equal((await request('/api/profiles',{cookie,origin:'https://evil.example',body:{display_name:'evil'}})).status,403);
  const settings=await request('/api/service-settings',{cookie,method:'PATCH',body:{provider:'compatible',model:'test-model',baseUrl:'http://127.0.0.1:8888/v1',apiKey:'fixture-secret'}});assert.equal(settings.status,200);assert.ok(!JSON.stringify(settings.value).includes('fixture-secret'));
  assert.equal((await request('/api/settings',{cookie})).value.model,'compatible/test-model');
  assert.deepEqual((await request('/api/models',{cookie:other})).value.models.map(m=>m.id),['compatible/test-model']);
  await request('/api/accounts',{cookie,body:{username:'thirdmember',password:'third-member-password'}});
  const third=(await request('/api/auth/login',{body:{username:'thirdmember',password:'third-member-password'}})).cookie;
  assert.equal((await request('/api/settings',{cookie:third})).value.model,'compatible/test-model');
  assert.equal((await request('/api/providers/discover',{cookie:other,body:{provider:'openai',apiKey:'fixture'}})).status,403);
  assert.equal((await request('/api/auth/logout',{cookie,body:{}})).status,200);assert.equal((await request('/api/state',{cookie})).status,401);assert.equal((await request('/api/state',{cookie:browser2.cookie})).status,200);
  assert.ok(!(await readFile(join(app.directory,'accounts.sqlite'))).includes(Buffer.from(admin.password)));
});
test('registration cannot grant admin or data paths, password rotation revokes sessions',async t=>{
  const app=await setup(t,{registration:true});const {request}=app;
  await request('/api/auth/setup',{body:{...admin,setupCode:app.bootstrap}});
  const user=await request('/api/auth/register',{body:{username:'member',password:'member-long-password',admin:true,dataPath:'/etc'}});assert.equal(user.status,200);assert.equal(user.value.user.admin,false);assert.equal(app.accounts.dataPath(user.value.user.id),null);
  const second=await request('/api/auth/login',{body:{username:'member',password:'member-long-password'}});
  assert.equal((await request('/api/account',{cookie:user.cookie,method:'PATCH',body:{password:'new-long-password',currentPassword:'incorrect'}})).status,403);
  assert.equal((await request('/api/account',{cookie:user.cookie,method:'PATCH',body:{password:'new-long-password',currentPassword:'member-long-password'}})).status,200);
  assert.equal((await request('/api/state',{cookie:second.cookie})).status,401);
  assert.equal((await request('/api/auth/login',{body:{username:'member',password:'member-long-password'}})).status,401);
  assert.equal((await request('/api/auth/login',{body:{username:'member',password:'new-long-password'}})).status,200);
});
test('logout terminates an existing authenticated event stream',async t=>{
  const app=await setup(t);const owner=await app.request('/api/auth/setup',{body:{...admin,setupCode:app.bootstrap}});
  await app.request('/api/profiles',{cookie:owner.cookie,body:{display_name:'Dot'}});
  const response=await fetch(app.base+'/api/events',{headers:{Cookie:owner.cookie}});const reader=response.body.getReader();assert.ok((await reader.read()).value.length);
  await app.request('/api/auth/logout',{cookie:owner.cookie,body:{}});
  await Promise.race([reader.read().catch(()=>null),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('logged-out stream remained open')),2000);timer.unref();})]);
});

test('shared identities link explicitly and cannot be claimed by another local account',async t=>{
  const app=await setup(t,{sharedAuth:{issuer:'http://127.0.0.1:4380',secret:'fixture-secret'}});
  const owner=await app.request('/api/auth/setup',{body:{...admin,setupCode:app.bootstrap}});
  const member=await app.request('/api/accounts',{cookie:owner.cookie,body:{username:'member',password:'a-long-member-password'}});
  assert.equal((await app.request('/api/session',{cookie:owner.cookie})).value.sharedAuthLinked,false);
  app.accounts.linkIdentity('http://127.0.0.1:4380','subject',owner.value.user.id);
  assert.equal((await app.request('/api/session',{cookie:owner.cookie})).value.sharedAuthLinked,true);
  assert.throws(()=>app.accounts.linkIdentity('http://127.0.0.1:4380','subject',member.value.user.id),{status:409});
  const callback=await app.request('/api/auth/omd/callback?code=unsolicited&state=unknown');
  assert.equal(callback.response.headers.get('location'),'/login?omd=error');
  assert.equal((await app.request('/api/session')).value.authenticated,false);
});
