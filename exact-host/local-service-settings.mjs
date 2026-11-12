// Local service capabilities inside the shipped Settings page. Layout, rows,
// groups, inputs, buttons, search and dialogs come from the immutable renderer.
// The original gateway body was not present in the extracted artifact; this
// adapter supplies its service data rather than inventing a second settings UI.
export async function installOriginalServiceSettings({initial,shared,React,jsx,accountState,assetBase,onRefresh}) {
  for(const name of ['eI','RF','cA','$Ln','hut'])initial[name]();
  for(const name of ['Z3','uw','ew'])shared[name]();
  const dialog=await import(assetBase+'dialog-shell-17006c94ea03.js');dialog.n();
  const account=await import(assetBase+'account-settings-6840b590b4f0.js');
  const {useState,useEffect,useRef}=React;
  const Button=shared.Y3,Row=shared.sw,Rows=shared.$C,Group=initial.sA,Input=initial.ZLn,Search=initial.mut,Dialog=dialog.t;
  const providers=[['openai','OpenAI'],['anthropic','Anthropic'],['openrouter','OpenRouter'],['ollama','Ollama'],['compatible','OpenAI compatible']];
  const canChat=m=>!m.outputModalities?.length||m.outputModalities.includes('text');
  async function api(path,method='GET',body){
    const response=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    if(response.status===401){location.assign('/login');throw Error('로그인이 필요합니다.');}
    const result=await response.json();if(!response.ok)throw Error(result.error||'설정을 읽지 못했습니다.');return result;
  }
  const button=(label,onClick,props={})=>jsx(Button,{type:'button',color:'secondary',size:'toolbar',onClick,children:label,...props});
  const row=(label,control,description)=>jsx(Row,{label,description,control});
  const group=(title,children)=>jsx(Group,{children:[title&&jsx(Group.Header,{title}),jsx(Group.Content,{children:jsx(Rows,{children})})]});
  const section=(slug,children)=>jsx(initial.QF,{title:jsx(initial.LF,{slug}),children});
  const status=text=>text&&jsx('p',{role:'status',className:'text-sm text-secondary',children:text});
  function ModelList({models,selected,onSelect}){
    const searchId=React.useId();
    const [query,setQuery]=useState(''),[limit,setLimit]=useState(50),[textOnly,setTextOnly]=useState(true),[vision,setVision]=useState(false);
    const filtered=models.filter(m=>(m.name+' '+m.id).toLowerCase().includes(query.toLowerCase())&&(!textOnly||canChat(m))&&(!vision||m.inputModalities?.includes('image')));
    return jsx('div',{className:'flex min-w-0 flex-col gap-4',children:[
      jsx(Search,{id:searchId,label:'모델 검색',placeholder:'모델 이름 또는 ID 검색',variant:'settings',isClearable:true,searchQuery:query,onSearchQueryChange:value=>{setQuery(value);setLimit(50);}}),
      jsx('div',{className:'flex flex-wrap items-center gap-2',children:[button('텍스트 출력',()=>{setTextOnly(!textOnly);setLimit(50);},{'aria-pressed':textOnly}),button('이미지 입력',()=>{setVision(!vision);setLimit(50);},{'aria-pressed':vision}),jsx('span',{className:'text-sm text-secondary',children:filtered.length+' / '+models.length+'개 모델'})]}),
      jsx(Rows,{children:filtered.slice(0,limit).map(model=>jsx(Row,{label:model.name||model.id,description:[model.id,model.contextLength?Intl.NumberFormat('en',{notation:'compact'}).format(model.contextLength)+' context':null,model.inputModalities?.includes('image')?'이미지':null,model.tools?'도구':null,!canChat(model)?(model.outputModalities||[]).join(' · '):null].filter(Boolean).join(' · '),control:button(selected===model.id?'선택됨':'선택',()=>onSelect(model.id),{disabled:!canChat(model),'aria-label':model.name+' 선택','aria-pressed':selected===model.id})},model.id))}),
      !filtered.length&&status('검색 결과가 없습니다.'),
      filtered.length>limit&&button('모델 더 보기',()=>setLimit(limit+50))
    ]});
  }
  function ProviderDialog({provider,saved,currentModel,onClose,onSaved}){
    const [baseUrl,setBaseUrl]=useState(saved?.baseUrl||''),[apiKey,setKey]=useState(''),[models,setModels]=useState([]),[selected,setSelected]=useState(null),[manual,setManual]=useState(''),[advanced,setAdvanced]=useState(['ollama','compatible'].includes(provider)),[pending,setPending]=useState(false),[notice,setNotice]=useState('');
    const revision=useRef(0),alive=useRef(true);
    useEffect(()=>()=>{alive.current=false;revision.current++;},[]);
    const invalidate=()=>{revision.current++;setModels([]);setSelected(null);setNotice('');};
    const discover=async()=>{
      const version=++revision.current;setPending(true);setNotice('모델 목록을 불러오는 중…');
      try{const result=await api('/api/providers/discover','POST',{provider,baseUrl,apiKey});if(alive.current&&version===revision.current){setModels(result.models);setSelected(result.models.find(m=>m.id===currentModel&&canChat(m))?.id||result.models.find(canChat)?.id||null);setNotice(result.models.length+'개 모델을 찾았습니다. '+(result.notice||''));}}
      catch(error){if(alive.current&&version===revision.current)setNotice(error.message);}
      finally{if(alive.current)setPending(false);}
    };
    const save=async()=>{
      if(!selected||pending)return;setPending(true);setNotice('');
      try{const result=await api('/api/service-settings','PATCH',{provider,baseUrl,apiKey,model:selected,models:models.filter(canChat).map(m=>({id:m.id,name:m.name}))});setKey('');await onSaved(result);onClose();}
      catch(error){if(alive.current)setNotice(error.message);}
      finally{if(alive.current)setPending(false);}
    };
    return jsx(Dialog,{title:providers.find(([id])=>id===provider)?.[1]+' 연결',size:'large',onClose,isDismissalDisabled:pending,
      footer:jsx('div',{className:'flex justify-end gap-2',children:[button('취소',onClose,{disabled:pending}),button('연결 저장',save,{color:'primary',disabled:pending||!selected})]}),
      children:jsx('div',{className:'flex flex-col gap-5',children:[
        group(null,[row('API 키',jsx(Input,{type:'password',variant:'settings',autoComplete:'off','aria-label':'API 키',value:apiKey,disabled:pending,placeholder:saved?'비워두면 기존 키 유지':provider==='ollama'?'로컬 서버는 비워둘 수 있습니다':'API 키 입력',onChange:e=>{invalidate();setKey(e.target.value);}}))]),
        button('고급 설정',()=>setAdvanced(!advanced),{'aria-expanded':advanced,disabled:pending}),
        advanced&&group(null,[row('API 주소',jsx(Input,{variant:'settings','aria-label':'API 주소',value:baseUrl,disabled:pending,placeholder:'기본 주소 사용 시 비워두기',onChange:e=>{invalidate();setBaseUrl(e.target.value);}})),row('모델 ID 직접 추가',jsx('div',{className:'flex gap-2',children:[jsx(Input,{variant:'settings','aria-label':'모델 ID',value:manual,disabled:pending,onChange:e=>setManual(e.target.value)}),button('추가',()=>{const id=manual.trim();if(!id||/\s/.test(id)){setNotice('모델 ID를 확인해 주세요.');return;}setModels(current=>current.some(m=>m.id===id)?current:[...current,{id,name:id}]);setSelected(id);setNotice('직접 추가한 모델은 실제 호출 시 사용 가능 여부를 확인합니다.');},{disabled:pending})]}))]),
        button('모델 목록 불러오기',discover,{disabled:pending,loading:pending}),status(notice),
        models.length>0&&jsx(ModelList,{models,selected,onSelect:setSelected})
      ]})});
  }
  function Gateways(){
    const [data,setData]=useState(null),[models,setModels]=useState([]),[selected,setSelected]=useState(''),[connection,setConnection]=useState(null),[picker,setPicker]=useState(false),[notice,setNotice]=useState('');
    const admin=accountState.session.user.admin;
    const load=async()=>{const [catalog,settings,service]=await Promise.all([api('/api/models'),api('/api/settings'),admin?api('/api/service-settings'):null]);setModels(catalog.models);setSelected(settings.model);setData(service);};
    useEffect(()=>{load().catch(e=>setNotice(e.message));},[]);
    const choose=async model=>{try{await api('/api/settings','PATCH',{model});setSelected(model);setPicker(false);setNotice('사용할 모델을 저장했습니다.');await onRefresh?.();}catch(e){setNotice(e.message);}};
    return section('gateways',[
      group('모델',[row('기본 모델',button(models.find(m=>m.id===selected)?.name||selected||'모델 선택',()=>setPicker(true)),selected)]),
      admin?group('제공업체',providers.map(([id,name])=>{const saved=data?.providers.find(p=>p.id===id);return jsx(Row,{label:name,description:saved?saved.models.length+'개 모델 연결됨':'연결되지 않음',control:button(saved?'관리':'연결',()=>setConnection(id),{'aria-label':name+' 연결'})},id);})):
        status('모델 제공업체 연결은 서버 관리자가 설정합니다.'),status(notice),
      connection&&jsx(ProviderDialog,{provider:connection,saved:data?.providers.find(p=>p.id===connection),currentModel:selected.startsWith(connection+'/')?selected.slice(connection.length+1):null,onClose:()=>setConnection(null),onSaved:async()=>{await load();await onRefresh?.();setNotice('제공업체 연결을 저장했습니다.');}},connection),
      picker&&jsx(Dialog,{title:'모델 선택',size:'large',onClose:()=>setPicker(false),children:jsx(ModelList,{models,selected,onSelect:choose})})
    ]);
  }
  function LocalAccountControls(){
    const [passwordDialog,setPasswordDialog]=useState(false),[userDialog,setUserDialog]=useState(false),[notice,setNotice]=useState('');
    const importBrowser=async()=>{try{
      for(const [section,key]of [['metadata','dots-exact-local-metadata-v1'],['persisted','dots-exact-persisted-v1']]){
        const values=JSON.parse(localStorage.getItem(key)||'{}');
        if(!values||typeof values!=='object'||Array.isArray(values))continue;
        for(const [key,value]of Object.entries(values)){
          if(['__proto__','constructor','prototype'].includes(key))continue;
          await accountState.save(section,key,value);
          if(section==='metadata'&&key.startsWith('asset:')&&value?.dataUrl)await api('/api/local-avatars','POST',{file_id:key.slice(6),data_url:value.dataUrl});
        }
      }
      await onRefresh?.();setNotice('이전 화면 설정을 현재 계정에 저장했습니다.');
    }catch(e){setNotice(e.message);}};
    const session=accountState.session;
    const checkProvider=async()=>{try{await api('/api/omd-provider');setNotice('OhMyDots Provider 연결을 확인했습니다.');}catch(e){setNotice(e.message);}};
    return jsx(React.Fragment,{children:[group('로컬 계정',[
      row('로그인 아이디',accountState.session.user.username),
      row('비밀번호',button('변경',()=>setPasswordDialog(true))),
      session.sharedAuth&&row('OhMyDots 계정',session.sharedAuthLinked?'연결됨':button('연결',()=>location.assign('/api/auth/omd/link'))),
      session.omdProvider&&row('OhMyDots Provider',session.omdProviderConnected?button('연결 확인',checkProvider):button('연결',()=>location.assign('/api/auth/omd/link'))),
      accountState.session.user.admin&&row('사용자 계정',button('관리',()=>setUserDialog(true))),
      accountState.session.legacy&&row('이전 화면 설정',button('이 브라우저에서 가져오기',importBrowser)),
      row('로그아웃',button('로그아웃',accountState.logout))
    ]),status(notice),passwordDialog&&jsx(CredentialsDialog,{kind:'password',onClose:()=>setPasswordDialog(false),onSaved:()=>{setNotice('비밀번호를 변경했습니다. 다시 로그인해 주세요.');location.assign('/login');}}),userDialog&&jsx(CredentialsDialog,{kind:'user',onClose:()=>setUserDialog(false),onSaved:()=>setNotice('계정을 추가했습니다.')})]});
  }
  function CredentialsDialog({kind,onClose,onSaved}){
    const [values,setValues]=useState({}),[notice,setNotice]=useState(''),[pending,setPending]=useState(false),[users,setUsers]=useState([]);
    useEffect(()=>{if(kind==='user')api('/api/accounts').then(result=>setUsers(result.users)).catch(e=>setNotice(e.message));},[]);
    const fields=kind==='password'?[['currentPassword','현재 비밀번호','password'],['password','새 비밀번호','password']]:[['username','아이디','text'],['displayName','이름','text'],['password','초기 비밀번호','password']];
    const save=async()=>{setPending(true);try{await api(kind==='password'?'/api/account':'/api/accounts',kind==='password'?'PATCH':'POST',values);onSaved();onClose();}catch(e){setNotice(e.message);}finally{setPending(false);}};
    return jsx(Dialog,{title:kind==='password'?'비밀번호 변경':'사용자 관리',onClose,isDismissalDisabled:pending,onSubmit:save,footer:button(kind==='password'?'변경':'계정 추가',save,{disabled:pending,color:'primary'}),children:jsx('div',{className:'flex flex-col gap-5',children:[
      group(null,fields.map(([key,label,type])=>jsx(Row,{label,control:jsx(Input,{type,variant:'settings','aria-label':label,autoComplete:type==='password'?'new-password':'off',value:values[key]||'',disabled:pending,onChange:e=>setValues({...values,[key]:e.target.value})})},key))),
      users.length>0&&group('계정 목록',users.map(user=>jsx(Row,{label:user.displayName,description:user.username,control:user.admin?'관리자':'사용자'},user.id))),status(notice)
    ]})});
  }
  function Account(){
    // Preserve the actual shipped account body and its profile editors; append
    // only capabilities owned by the local authentication service.
    const original=account.ChatGptAccountSettings();
    return React.cloneElement(original,{},...React.Children.toArray(original.props.children),jsx(LocalAccountControls,{},'local-account'));
  }
  function Usage(){
    const [state,setState]=useState(null),[notice,setNotice]=useState('');
    useEffect(()=>{api('/api/state').then(setState).catch(e=>setNotice(e.message));},[]);
    return section('usage',[group('계정 활동',[
      row('Dots',state?String(state.profiles.length):'…'),row('메시지',state?String(state.messages.length):'…'),row('완료한 작업',state?String(state.tasks.filter(t=>t.status==='completed').length):'…')
    ]),status('모델 제공업체의 요금과 잔여 한도는 해당 제공업체에서 확인할 수 있습니다.'),status(notice)]);
  }
  initial.ExactSetSettingsBody('gateways',Gateways);
  initial.ExactSetSettingsBody('account',Account);
  initial.ExactSetSettingsBody('usage',Usage);
}
