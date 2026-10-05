import {useEffect,useState} from 'react';
import {api} from './api';
import {Icon,type IconName} from './icons';
import logo from './assets/logo.png';
import type {Mock,Chat,Lang,Topic,Ctx} from './types';
import {ChatPage} from './pages/Chat';
import {Library,Assessments,Progress,CourseMap,Settings} from './pages/Pages';

const NAV:[string,string,IconName][]=[['library','Library','book'],['assessments','Assessments','file'],['progress','Progress','chart'],['map','Course map','net']];
const go=(r:string)=>{location.hash=r};
const useHash=()=>{const [h,s]=useState(location.hash.slice(1)||'/');
  useEffect(()=>{const f=()=>s(location.hash.slice(1)||'/');addEventListener('hashchange',f);return()=>removeEventListener('hashchange',f)},[]);return h};
const Login=()=>(
  <div style={{height:'100%',display:'grid',placeItems:'center',padding:20}}>
    <div className="g" style={{width:'100%',maxWidth:360,textAlign:'center'}}>
      <img src={logo} width={56} height={56} alt="Sigma" style={{margin:'auto'}}/><h2>Welcome back</h2>
      <input className="t" defaultValue="student@example.com" aria-label="Email"/>
      <input className="t" type="password" defaultValue="password" aria-label="Password"/>
      <a className="btn" href="#/app/chat" style={{justifyContent:'center'}}>Continue</a>
      <p className="mu sm">Don't have an account? Sign up</p>
    </div>
  </div>);

export default function App(){
  const route=useHash();
  const [db,setDb]=useState<Mock|null>(null),[chats,setChats]=useState<Chat[]>([]),[topics,setTopics]=useState<Topic[]>([]);
  const [cur,setCur]=useState<number|null>(null),[lang,setLang]=useState<Lang>('hn');
  const [dark,setDark]=useState(matchMedia('(prefers-color-scheme:dark)').matches);
  const [c,setC]=useState(false),[o,setO]=useState(false),[menu,setMenu]=useState(false),[sq,setSq]=useState('');
  const [panel,setPanel]=useState(false),[view,setView]=useState<string|null>(null),[tg,setTg]=useState<string|null>(null);
  useEffect(()=>{api.getMock().then(d=>{setDb(d);setChats(d.chats);setTopics(d.topics)})},[]);
  useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light'},[dark]);
  useEffect(()=>{setO(false);setMenu(false)},[route]);
  if(route==='/'||route==='/login')return <Login/>;
  if(!db)return null;
  const toast=(t:string)=>{setTg(t);setTimeout(()=>setTg(null),1500)};
  const ctx:Ctx={db,topics,setTopics,chats,setChats,cur,setCur,lang,setView,toast,dark,setDark};
  const k=route.replace('/app/','')||'chat';
  const tog=()=>{setC(v=>!v);setO(v=>!v)};
  let g='';
  const hist=chats.map((ch,i)=>({ch,i})).filter(x=>x.ch.t.toLowerCase().includes(sq.toLowerCase())).map(({ch,i})=>{
    const hd=ch.g!==g;g=ch.g;
    return <div key={i}>{hd&&<div className="lbl">{g}</div>}<button className={`it ${cur===i?'on':''}`} onClick={()=>{setCur(i);go('/app/chat')}}>{ch.t}</button></div>});
  const keys=[...new Set((cur==null?[]:chats[cur].msgs).map(m=>m.k).filter((x):x is string=>!!x))];
  const a=view?db.ans[view]:null;
  const plain={color:'inherit',textDecoration:'none'} as const;
  return (<>
    <div id="app" className={`${c?'c':''} ${o?'o':''}`}>
      <div className="bdp" onClick={tog}/>
      <aside>
        <div className="row" style={{padding:'4px 4px 8px'}}><img src={logo} width={26} height={26} alt="Sigma"/><b className="sp">Sigma</b>
          <button className="ib" onClick={tog} aria-label="Close sidebar"><Icon n="panel"/></button></div>
        <button className="it" onClick={()=>{setCur(null);go('/app/chat')}}><Icon n="edit"/> New chat</button>
        <div className="it" style={{padding:'2px 10px'}}><Icon n="search"/>
          <input value={sq} onChange={e=>setSq(e.target.value)} placeholder="Search chats" style={{background:'none',border:0,outline:0,width:'100%',padding:'6px 0'}}/></div>
        {NAV.map(n=><a key={n[0]} className={`it ${k===n[0]?'on':''}`} href={`#/app/${n[0]}`} style={plain}><Icon n={n[2]}/> {n[1]}</a>)}
        <div className="lbl" style={{paddingTop:18}}>Chats</div>
        <div style={{flex:1,overflow:'auto'}}>{hist}</div>
        {menu&&<div className="pop">
          <a className="it" href="#/app/settings" style={plain}><Icon n="gear"/> Settings</a>
          <button className="it" onClick={()=>{setDark(!dark);setMenu(false)}}><Icon n="moon"/> {dark?'Light':'Dark'} mode</button>
          <a className="it" href="#/" style={plain}><Icon n="out"/> Log out</a></div>}
        <button className="it" onClick={()=>setMenu(!menu)} style={{padding:10}}>
          <span className="ib" style={{background:'var(--fg)',color:'var(--bg)',borderRadius:'50%',width:30,height:30}}>S</span>
          <span className="sp"><b>{db.user}</b><br/><span className="mu sm">Student</span></span></button>
      </aside>
      <section className="mn">
        <header>
          <button className="ib" onClick={tog} aria-label="Toggle sidebar"><Icon n="panel" s={20}/></button>
          {k==='chat'
            ?<select value={lang} onChange={e=>setLang(e.target.value as Lang)} aria-label="Response language">
                <option value="hn">Sigma · Hinglish</option><option value="en">Sigma · English</option><option value="hi">Sigma · Hindi</option></select>
            :<b style={{padding:'0 8px'}}>{NAV.find(n=>n[0]===k)?.[1]??'Settings'}</b>}
          <span className="sp"/>
          {k==='chat'&&<button className="ib" onClick={()=>setPanel(!panel)} aria-label="Sources"><Icon n="book" s={20}/></button>}
        </header>
        <div className="body">
          {k==='library'?<Library ctx={ctx}/>:k==='assessments'?<Assessments ctx={ctx}/>:k==='progress'?<Progress ctx={ctx}/>
            :k==='map'?<CourseMap ctx={ctx}/>:k==='settings'?<Settings ctx={ctx}/>:<ChatPage ctx={ctx}/>}
        </div>
        {panel&&k==='chat'&&<div className="panel">
          <div className="row"><h3 className="sp">Sources</h3><button className="ib" onClick={()=>setPanel(false)} aria-label="Close"><Icon n="x"/></button></div>
          {keys.length?keys.map(x=><button key={x} className="it" style={{height:'auto',padding:10,border:'1px solid var(--bd)',marginTop:8}} onClick={()=>setView(x)}>
              <Icon n={db.ans[x].v?'play':'file'}/> {db.ans[x].f} · {db.ans[x].p}</button>)
            :<p className="mu sm" style={{marginTop:12}}>Sources for this conversation appear here.</p>}
        </div>}
      </section>
      {a&&<div className="md" onClick={()=>setView(null)}><div onClick={e=>e.stopPropagation()}>
        <div className="row"><h3 className="sp">{a.f}</h3><span className="mu sm">{a.v?'Lecture video':'Page 38 of 124'}</span>
          <button className="ib" onClick={()=>setView(null)} aria-label="Close"><Icon n="x"/></button></div>
        <h3 style={{margin:'18px 0 8px'}}>{a.v?'Transactions':'Normalization'}</h3><div className="hl">{a.q}</div>
        <p className="mu sm" style={{marginTop:12}}>{a.v?`Playing from ${a.p}`:'Highlighted passage matches the cited answer.'}</p></div></div>}
    </div>
    {tg&&<div className="tg">{tg}</div>}
  </>);
}
