const form=document.querySelector('form'),error=document.querySelector('#error');
const session=await fetch('/api/session').then(r=>r.json());
if(session.authenticated)location.replace('/original/webview/');
document.querySelector('#shared-auth').hidden=!session.sharedAuth||session.needsSetup;
const sharedAuthResult=new URLSearchParams(location.search).get('omd');
if(sharedAuthResult==='unlinked')error.textContent='로컬 계정으로 로그인한 뒤 계정 설정에서 OhMyDots 계정을 연결하세요.';
if(sharedAuthResult==='error')error.textContent='OhMyDots 계정 인증을 완료하지 못했습니다. 다시 시도해 주세요.';
let mode=session.needsSetup?'setup':'login';
function render(){const setup=mode==='setup',creating=mode!=='login';document.querySelector('#setup-code').hidden=!setup;document.querySelector('#setup-code input').required=setup;document.querySelector('#display-name').hidden=!creating;document.querySelector('#confirm-password').hidden=!creating;document.querySelector('#confirm-password input').required=creating;form.elements.password.minLength=creating?12:1;form.elements.password.autocomplete=creating?'new-password':'current-password';document.querySelector('#title').textContent=setup?'나만의 Dots를 시작하세요':creating?'계정 만들기':'다시 만나서 반가워요';document.querySelector('#description').textContent=setup?'첫 관리자 계정을 만들고 이 서버를 설정하세요.':creating?'기록과 설정은 계정에 저장됩니다.':'내 계정으로 로그인하고 Dots와 대화를 이어가세요.';form.querySelector('button').textContent=creating?'계정 만들기':'로그인';document.querySelector('#setup-hint').hidden=!setup;}
render();
const register=document.querySelector('#register');register.hidden=!session.registration||session.needsSetup;register.onclick=()=>{mode=mode==='login'?'register':'login';register.textContent=mode==='login'?'계정 만들기':'로그인으로 돌아가기';error.textContent='';render();};
form.onsubmit=async event=>{event.preventDefault();error.textContent='';const body=Object.fromEntries(new FormData(form));if(mode!=='login'&&body.password!==body.confirmPassword){error.textContent='비밀번호가 일치하지 않습니다.';return;}const button=form.querySelector('button');button.disabled=true;try{const response=await fetch('/api/auth/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error);location.assign('/original/webview/');}catch(e){error.textContent=e.message;}finally{button.disabled=false;}};
