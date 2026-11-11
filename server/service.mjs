import http from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Accounts } from './accounts.mjs';
import { createApp, json, readJson } from './main.mjs';
import { createRenderer } from '../exact-host/server.mjs';
import { OpenCodeProvider } from '../engine-adapters/opencode.mjs';
import { GrokProvider } from './grok-runtime.mjs';
import {readProviders,saveProvider,publicProviders} from './provider-settings.mjs';
import {discoverModels} from './model-discovery.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const listen=server=>new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',()=>done(server.address().port));});
const error=(message,status=400)=>Object.assign(Error(message),{status});

export async function createService({directory=process.env.DOTS_SERVICE_DIR||join(root,'.data/service'),publicUrl=process.env.DOTS_PUBLIC_URL||'http://127.0.0.1:3420',engine=process.env.DOTS_RUNTIME||'opencode',appFactory=createApp,providerFactory,legacyDir,legacyInference=false,registration=false}={}){
  directory=resolve(directory);const origin=new URL(publicUrl).origin;
  const secure=new URL(origin).protocol==='https:';
  if(!secure&&!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw Error('공개 서비스에는 HTTPS 주소가 필요합니다.');
  const accounts=new Accounts(directory),apps=new Map(),streams=new Map(),rates=new Map();let bootstrapping=false;
  const providerPath=process.env.DOTS_PROVIDER_CONFIG||join(directory,'providers.json');
  try{await readFile(providerPath);}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(providerPath,JSON.stringify({providers:{},env:{}}),{mode:0o600,flag:'wx'});}
  process.env.DOTS_PROVIDER_CONFIG=providerPath;
  const renderer=createRenderer();const rendererPort=await listen(renderer);
  const bootstrapPath=join(directory,'bootstrap.token');
  let bootstrapToken;try{bootstrapToken=(await readFile(bootstrapPath,'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw e;bootstrapToken=randomBytes(32).toString('hex');await writeFile(bootstrapPath,bootstrapToken,{mode:0o600,flag:'wx'});}
  const cookieName=secure?'__Host-dots_session':'dots_session';
  const cookie=(token,age=604800)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`;
  function closeStreams(token){for(const res of streams.get(token)||[])res.destroy();streams.delete(token);}
  async function appFor(user){
    if(!apps.has(user.id))apps.set(user.id,(async()=>{
      const dataDir=accounts.dataPath(user.id)||join(directory,'accounts',user.id);await mkdir(dataDir,{recursive:true,mode:0o700});
      const isolationDir=legacyInference&&accounts.dataPath(user.id)?undefined:join(dataDir,'inference');
      const provider=providerFactory?.(user,dataDir)||new (engine==='grok'?GrokProvider:OpenCodeProvider)({isolationDir});
      const gatewayToken=randomBytes(32).toString('hex');
      const fresh=await stat(join(dataDir,'dots.sqlite')).then(()=>false,e=>{if(e.code==='ENOENT')return true;throw e;});
      const app=appFactory({dataDir,engine,provider,computerEnabled:Boolean(accounts.dataPath(user.id)),gatewayToken});app.gatewayToken=gatewayToken;
      const defaults=await readProviders(providerPath);if(fresh&&defaults.defaultModel)app.store.patch('settings','app',{model:defaults.defaultModel});
      app.runtime.inferenceDir=isolationDir;
      await listen(app.server);return app;
    })().catch(e=>{apps.delete(user.id);throw e;}));return apps.get(user.id);
  }
  function proxy(req,res,port,token,expires,gatewayToken){
    const headers={...req.headers,host:'127.0.0.1:'+port};delete headers.cookie;delete headers.origin;delete headers.authorization;
    for(const key of Object.keys(headers))if(key.startsWith('x-forwarded-')||key==='forwarded')delete headers[key];
    headers['sec-fetch-site']='same-origin';
    delete headers['x-dots-gateway'];if(gatewayToken)headers['x-dots-gateway']=gatewayToken;
    const upstream=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers},response=>{
      res.writeHead(response.statusCode,response.headers);response.pipe(res);
    });
    const timer=token?setTimeout(()=>res.destroy(),Math.max(1,expires-Date.now())):null;timer?.unref();
    if(token){if(!streams.has(token))streams.set(token,new Set());streams.get(token).add(res);}
    res.on('close',()=>{upstream.destroy();clearTimeout(timer);streams.get(token)?.delete(res);if(!streams.get(token)?.size)streams.delete(token);});
    upstream.on('error',()=>{if(!res.headersSent)json(res,502,{error:'계정 서비스에 연결하지 못했습니다.'});else res.end();});req.pipe(upstream);
  }
  const server=http.createServer(async(req,res)=>{try{
    if(req.headers.host!==new URL(origin).host)throw error('서비스 주소가 올바르지 않습니다.',403);
    const url=new URL(req.url,origin);const path=url.pathname;
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      if(req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')throw error('같은 사이트에서 요청해 주세요.',403);
      if(req.headers['content-type']?.split(';')[0]!=='application/json')throw error('JSON 요청이 필요합니다.',415);
    }
    const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    const session=accounts.resolve(token),user=session?.user;
    if(path==='/healthz')return json(res,200,{ok:true,service:'ohmydots'});
    if(path==='/api/session'&&req.method==='GET')return json(res,200,{mode:'service',authenticated:Boolean(user),user:user||null,legacy:Boolean(user&&accounts.dataPath(user.id)),needsSetup:accounts.count()===0,registration});
    if(['/api/auth/login','/api/auth/setup','/api/auth/register'].includes(path)&&req.method==='POST'){
      const address=req.socket.remoteAddress;const previous=rates.get(address);const rate=previous?.until>Date.now()?previous:{count:0,until:Date.now()+15*60000};if(++rate.count>20)throw error('시도가 너무 많습니다. 15분 후 다시 시도하세요.',429);rates.set(address,rate);
      if(rates.size>10000)for(const [key,v]of rates)if(v.until<Date.now())rates.delete(key);
      const b=await readJson(req);if(Buffer.byteLength(JSON.stringify(b))>10000)throw error('요청이 너무 큽니다.',413);
      let account;
      if(path.endsWith('/setup')){
        if(accounts.count()||bootstrapping)throw error('초기 설정이 이미 완료되었거나 진행 중입니다.',409);
        const code=Buffer.from(String(b.setupCode||''));if(code.length!==64||!timingSafeEqual(code,Buffer.from(bootstrapToken)))throw error('서버의 초기 설정 코드를 확인하세요.',403);
        bootstrapping=true;try{account=await accounts.create({username:b.username,password:b.password,displayName:b.displayName,admin:true,dataPath:legacyDir||null});}finally{bootstrapping=false;}
      }else if(path.endsWith('/register')){
        if(!registration||!accounts.count())throw error('관리자에게 계정 생성을 요청하세요.',403);
        account=await accounts.create({username:b.username,password:b.password,displayName:b.displayName});
      }else{account=await accounts.verify(b.username,b.password);if(!account)throw error('아이디 또는 비밀번호를 확인하세요.',401);}
      if(token){accounts.logout(token);closeStreams(token);}const auth=accounts.session(account.id);res.setHeader('Set-Cookie',cookie(auth.token));return json(res,200,{user:account});
    }
    if(['/login','/setup'].includes(path)||path.startsWith('/service-assets/')){
      if(path.startsWith('/service-assets/')){const name=path.slice(16);if(!['login.mjs','service.css'].includes(name))throw error('Not found',404);res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');return res.end(await readFile(join(root,'service-ui',name)));}
      if(user){res.writeHead(302,{Location:'/original/webview/'}).end();return;}
      res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(await readFile(join(root,'service-ui/login.html')));
    }
    if(!user){if(path.startsWith('/api/')||path.startsWith('/internal/'))throw error('로그인이 필요합니다.',401);res.writeHead(302,{Location:'/login'}).end();return;}
    if(path.startsWith('/internal/'))throw error('Not found',404);
    if(path==='/api/auth/logout'&&req.method==='POST'){accounts.logout(token);res.setHeader('Set-Cookie',cookie('',0));json(res,200,{ok:true});closeStreams(token);return;}
    if(path==='/api/account'){
      if(req.method==='GET')return json(res,200,user);
      if(req.method==='PATCH'){const b=await readJson(req);if(b.password!==undefined&&!await accounts.verify(user.username,b.currentPassword))throw error('현재 비밀번호가 올바르지 않습니다.',403);const updated=await accounts.update(user.id,b);json(res,200,{user:updated});if(b.password!==undefined){for(const key of streams.keys())if(!accounts.resolve(key))closeStreams(key);}return;}
    }
    if(path==='/api/accounts'){if(!user.admin)throw error('관리자 권한이 필요합니다.',403);if(req.method==='GET')return json(res,200,{users:accounts.list()});if(req.method==='POST'){const b=await readJson(req);return json(res,201,{user:await accounts.create({username:b.username,password:b.password,displayName:b.displayName})});}}
    if(path==='/api/service-settings'){if(!user.admin)throw error('관리자 권한이 필요합니다.',403);if(req.method==='PATCH'){const saved=await saveProvider(providerPath,await readJson(req));(await appFor(user)).store.patch('settings','app',{model:saved.defaultModel});}const config=await readProviders(providerPath);return json(res,200,{providers:publicProviders(config),defaultModel:config.defaultModel||null,engine,registration});}
    if(path==='/api/models'&&req.method==='GET'){const config=await readProviders(providerPath);return json(res,200,{models:Object.entries(config.providers||{}).flatMap(([provider,p])=>Object.entries(p.models||{}).map(([id,model])=>({id:provider+'/'+id,name:model.name||id,provider})))});}
    if(path==='/api/providers/discover'&&req.method==='POST'){if(!user.admin)throw error('관리자 권한이 필요합니다.',403);const b=await readJson(req);return json(res,200,await discoverModels({provider:b.provider,apiKey:b.apiKey,baseUrl:b.baseUrl,configPath:providerPath}));}
    if(path==='/account'){res.writeHead(302,{Location:'/original/webview/?settings=account'});return res.end();}
    if(path.startsWith('/api/')){const app=await appFor(user);return proxy(req,res,app.server.address().port,token,session.expires,app.gatewayToken);}
    if(path==='/'){res.writeHead(302,{Location:'/original/webview/'}).end();return;}
    return proxy(req,res,rendererPort,token,session.expires);
  }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'서버 요청을 처리하지 못했습니다.'});else res.end();}});
  const close=async()=>{for(const key of streams.keys())closeStreams(key);await Promise.allSettled([...apps.values()].map(async p=>(await p).close()));await new Promise(r=>renderer.close(r));if(server.listening)await new Promise(r=>server.close(r));accounts.close();};
  return {server,accounts,close,appFor,bootstrapPath};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const configPath=resolve(process.env.DOTS_SERVICE_CONFIG||join(root,'.data/service/config.json'));
  let config={};try{config=JSON.parse(await readFile(configPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const [key,value]of Object.entries(config.env||{}))process.env[key]=String(value);
  const service=await createService(config);const port=Number(process.env.PORT||config.port||3420);const host=process.env.HOST||config.host||'127.0.0.1';
  service.server.listen(port,host,()=>{console.log('OhMyDots service: '+(config.publicUrl||'http://127.0.0.1:'+port));if(!service.accounts.count())console.log('초기 설정 코드 파일: '+service.bootstrapPath);});
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await service.close();process.exit(0);});
}
