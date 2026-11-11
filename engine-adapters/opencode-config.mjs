import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
export function providerSettings(){
  if(!process.env.DOTS_PROVIDER_CONFIG)return {};
  const config=JSON.parse(readFileSync(process.env.DOTS_PROVIDER_CONFIG,'utf8'));
  return config.providers?{providers:config.providers}:{};
}
export function inferenceEnvironment(directory){
  const values={};
  if(process.env.DOTS_PROVIDER_CONFIG){const config=JSON.parse(readFileSync(process.env.DOTS_PROVIDER_CONFIG,'utf8'));const keys=new Set(Object.values(config.providers||{}).flatMap(p=>p.env||[]));for(const key of keys)if(/^[A-Z][A-Z0-9_]*_API_KEY$/.test(key)&&typeof config.env?.[key]==='string')values[key]=config.env[key];}
  if(directory)for(const [key,folder]of Object.entries({XDG_DATA_HOME:'data',XDG_CONFIG_HOME:'config',XDG_CACHE_HOME:'cache',XDG_STATE_HOME:'state'})){values[key]=join(directory,folder);mkdirSync(values[key],{recursive:true,mode:0o700});}
  return values;
}
