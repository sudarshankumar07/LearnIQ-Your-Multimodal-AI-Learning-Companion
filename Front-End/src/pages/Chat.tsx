import {useEffect,useRef,useState} from 'react';
import {Icon} from '../icons';
import logo from '../assets/logo.png';
import {api} from '../api';
import type {Ctx,Msg} from '../types';

const SUG=['Explain 2NF','What is a transaction?','Explain quantum computing'];

export function ChatPage({ctx}:{ctx:Ctx}){
  const {db,chats,setChats,cur,setCur,lang,setView,toast}=ctx;
  const [text,setText]=useState('');const ref=useRef<HTMLDivElement>(null);
  const msgs:Msg[]=cur==null?[]:chats[cur].msgs;
  useEffect(()=>{ref.current?.scrollTo({top:ref.current.scrollHeight})},[chats,cur]);
  const patch=(ci:number,mi:number,p:Partial<Msg>)=>setChats(cs=>cs.map((c,i)=>i!==ci?c:{...c,msgs:c.msgs.map((m,j)=>j===mi?{...m,...p}:m)}));
  const stream=(ci:number,mi:number,k:string)=>{
    const n=db.ans[k][lang].split(' ').length;let w=0;
    const t=setInterval(()=>{w++;patch(ci,mi,{w,done:w>=n});if(w>=n)clearInterval(t)},45)};
  const send=async(t0?:string)=>{
    const t=(t0??text).trim();if(!t){toast('Enter a question first.');return}setText('');
    let ci=cur;const len=cur==null?0:chats[cur].msgs.length;
    if(ci==null){setChats(cs=>[{t:t.slice(0,32),g:'Today',msgs:[]},...cs]);ci=0;setCur(0)}
    const id=ci,mi=len+1;
    setChats(cs=>cs.map((c,i)=>i===id?{...c,msgs:[...c.msgs,{u:t},{load:true}]}:c));
    try{
      const answer=await api.ask(t);
      patch(id,mi,{load:false,answer});
    }catch(err){
      patch(id,mi,{load:false,answer:err instanceof Error?err.message:'Unable to reach the server. Please try again.'});
    }
  };
  const composer=(
    <div className="comp">
      <textarea rows={1} value={text} onChange={e=>setText(e.target.value)} placeholder="Ask anything about your course material"
        onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}}/>
      <div className="crow">
        <button className="ib" onClick={()=>{location.hash='/app/library'}} aria-label="Add files"><Icon n="plus" s={20}/></button><span className="sp"/>
        <button className="ib" aria-label="Voice input"><Icon n="mic" s={20}/></button>
        <button className="snd" onClick={()=>send()} aria-label="Send"><Icon n="up"/></button>
      </div>
    </div>);
  const view=(m:Msg,i:number)=>{
    if(m.u)return <div key={i} className="um"><div className="ub">{m.u}</div></div>;
    if(m.load)return <div key={i} className="am mu">Searching your course material <span className="dot">● ● ●</span></div>;
    if(m.answer!==undefined)return <div key={i} className="am"><p>{m.answer}</p></div>;
    if(m.k==null)return (
      <div key={i} className="am"><p>I couldn't find this in your uploaded course material.</p>
        <div className="nc"><div className="row"><Icon n="alert"/><b>Not covered</b></div>
          <p className="mu sm" style={{margin:'6px 0 12px'}}>Upload relevant material or ask another course-related question.</p>
          <a className="btn o" href="#/app/library"><Icon n="upl" s={16}/> Upload material</a></div></div>);
    const k=m.k,a=db.ans[k],w=a[lang].split(' '),n=m.done?w.length:m.w??0;
    return (
      <div key={i} className="am"><p>{w.slice(0,n).join(' ')}</p>
        {m.done&&<>
          <button className="pill" onClick={()=>setView(k)}><Icon n={a.v?'play':'file'} s={14}/> {a.f} · {a.p}</button>
          <div className="acts">
            <button className="ib" aria-label="Copy" onClick={()=>{navigator.clipboard?.writeText(a[lang]).catch(()=>{});toast('Copied')}}><Icon n="copy" s={16}/></button>
            <button className="ib" aria-label="Good answer" onClick={()=>toast('Thanks for the feedback')}><Icon n="like" s={16}/></button>
            <button className="ib" aria-label="Bad answer" style={{transform:'scaleY(-1)'}} onClick={()=>toast('Thanks for the feedback')}><Icon n="like" s={16}/></button>
            <button className="ib" aria-label="Regenerate" onClick={()=>{patch(cur!,i,{done:false,w:0});stream(cur!,i,k)}}><Icon n="redo" s={16}/></button>
          </div>
          <div><a className="pill" href="#/app/assessments"><Icon n="file" s={14}/> Generate quiz</a></div></>}
      </div>);
  };
  return msgs.length
    ?<div className="chat"><div className="scr" ref={ref}><div className="thread">{msgs.map(view)}</div></div>
        <div className="cbar">{composer}<p className="foot">Sigma answers from your uploaded material. Check important info.</p></div></div>
    :<div className="chat"><div className="hero2"><img src={logo} width={84} height={84} alt="" style={{margin:'auto'}}/><h2>What are you studying today?</h2>{composer}
        <div className="chips">{SUG.map(s=><button key={s} className="pill" onClick={()=>send(s)}>{s}</button>)}</div></div></div>;
}
