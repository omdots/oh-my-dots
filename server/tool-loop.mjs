function envelope(text){try{return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{return null;}}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
const sameArgs=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
/** Independent local inference adapter. Every action still passes Runtime.tool. */
export async function runInference(runtime,task,options){
 let first;
 try {let answer=await runtime.provider.run(options);first=envelope(answer);if(!first||(!Array.isArray(first.tool_calls)&&!first.dots_tools_unavailable))return answer;}
 catch(error){if(!['UNEXECUTED_TOOL_CALL','OPENCODE_RUN_FAILED'].includes(error.code))throw error;}
 runtime.addItem(task,{type:'text',status:'completed',text:'도구 작업을 계속합니다.'});
 const alreadyExecuted=runtime.store.get('task',task.id).items.filter(item=>item.type==='tool_call'&&item.status==='completed');
 let history=[...options.history,...alreadyExecuted.map(item=>({role:'tool',name:item.name,content:JSON.stringify({already_executed:true,result:item.result?.type==='image'?{type:'image',attached_image:true,width:item.result.width,height:item.result.height}:item.result})}))],images=alreadyExecuted.filter(item=>item.result?.type==='image').slice(-1).map(item=>item.result),calls=0,invalid=0;
 const system=options.system+'\nYou are now an inference-only planner. Never emit XML, native function syntax, Markdown fences, or undeclared tools. Return ONLY JSON exactly matching {"text":string,"tool_calls":[{"name":string,"args":object}]}. Available tools: '+JSON.stringify(runtime.tools)+'. If tools are needed, request them in tool_calls; this app runs them after validation and approval. Already-executed tool results are authoritative; do not repeat successful mutating actions. Never claim completion before successful tool results. Continue after results. When finished, tool_calls must be empty and text must contain the final answer. File paths must be relative to the Dot workspace. Screenshots are attached as actual image files; inspect them rather than guessing.';
 for(let round=0;round<8;round++){
  if(options.signal.aborted)throw Object.assign(new Error('작업을 취소했습니다.'),{code:'CANCELLED'});
  let output=first;first=null;
  if(!output){try{let text=await runtime.provider.run({...options,system,history,bridge:undefined,onEvent:undefined,images});output=envelope(text);}catch(error){if(error.code!=='UNEXECUTED_TOOL_CALL')throw error;output=null;}}
  if(!output||typeof output.text!=='string'||!Array.isArray(output.tool_calls)||output.tool_calls.some(call=>!call||typeof call!=='object'||typeof call.name!=='string'||!call.args||typeof call.args!=='object'||Array.isArray(call.args))){
   if(++invalid>=2)throw Object.assign(new Error('모델이 도구 요청 형식을 반복해서 잘못 반환했습니다. 다른 모델을 선택해 주세요.'),{code:'INVALID_TOOL_ENVELOPE'});
   history.push({role:'user',content:'Invalid format. Return only JSON {"text":string,"tool_calls":[{"name":string,"args":object}]}. No XML or prose outside JSON.'});continue;
  }
  if(!output.tool_calls.length){if(!output.text.trim())throw new Error('모델이 최종 답변을 반환하지 않았습니다.');return output.text;}
  history.push({role:'assistant',content:JSON.stringify(output)});
  for(let call of output.tool_calls){
   if(++calls>12)throw Object.assign(new Error('한 작업의 도구 실행 횟수(12회)를 초과했습니다. 작업을 나눠 다시 요청해 주세요.'),{code:'TOOL_LIMIT'});
   let name=typeof call.name==='string'?call.name.replace(/^dots_/,''):'';let result;
   try{
    const previous=['write_file','shell','send_message','computer_action'].includes(name)&&alreadyExecuted.find(item=>item.name===name&&sameArgs(item.args,call.args||{}));
    if(previous)result=previous.result;
    else {result=await runtime.tool(task.id,name,call.args||{});if(['write_file','shell','send_message','computer_action'].includes(name))alreadyExecuted.push({name,args:call.args||{},result});}
   }catch(error){result={error:error.message};}
   if(result?.type==='image'){
    if(typeof result.data==='string'&&result.data.length<=14000000)images=[result];
    result={type:'image',attached_image:true,width:result.width,height:result.height};
   }
   history.push({role:'tool',name,content:JSON.stringify(result)});
  }
 }
 throw Object.assign(new Error('모델의 도구 작업이 반복되어 중단했습니다. 완료되지 않은 작업은 다시 요청할 수 있습니다.'),{code:'TOOL_ROUND_LIMIT'});
}
