import {useRef,useState,type CSSProperties} from 'react';
import {Icon,type IconName} from '../icons';
import {api} from '../api';
import type {Ctx} from '../types';

const COL=['#a24bc0','#ee4a7a','#4db5f5','#2f74b8','#4eaeb9'],DK=['#7a2f94','#c93063','#2f94d6','#1f4f82','#37858f'];
const AR:CSSProperties={clipPath:'polygon(0 0,calc(100% - 12px) 0,100% 50%,calc(100% - 12px) 100%,0 100%)'};
const Bar=({v,w}:{v:number;w?:boolean})=><div className={`bar ${w?'w':''}`}><i style={{width:`${v}%`}}/></div>;
const Ttl=({a,b}:{a:string;b:string})=><div style={{textAlign:'center',marginBottom:16}}><b style={{color:'var(--mu)'}}>{a}</b><p className="mu sm">{b}</p></div>;
const Ring=({v,c}:{v:number;c:string})=>{const C=2*Math.PI*44;return (
  <svg width="110" height="110" viewBox="0 0 110 110"><circle cx="55" cy="55" r="44" fill="none" stroke="var(--hv)" strokeWidth="10"/>
    <circle cx="55" cy="55" r="44" fill="none" stroke={c} strokeWidth="10" strokeDasharray={`${C*v/100} ${C}`} transform="rotate(-90 55 55)"/>
    <text x="55" y="60" textAnchor="middle" fontSize="15" fontWeight="600" fill="var(--fg)">{v}%</text></svg>)};

const STEPS=['File uploaded','Text extracted','Images analyzed','Topics identified','Sources mapped','Knowledge base created'];
export function Library({ctx}:{ctx:Ctx}){
  const [p,setP]=useState(-1);
  const [fileName,setFileName]=useState('');
  const input=useRef<HTMLInputElement>(null);
  const run=async(file?:File)=>{
    if(!file)return;
    setFileName(file.name);setP(0);
    try{
      await api.upload(file);
      setP(5);
    }catch(err){
      setP(-1);
      ctx.toast(err instanceof Error?err.message:'PDF upload failed. Please try again.');
    }
  };
  return (<div className="page"><h2>Library</h2>
    {p<0
      ?<div className="card" style={{textAlign:'center',borderStyle:'dashed',padding:'44px 20px'}}><div className="mu"><Icon n="upl" s={28}/></div>
          <h3 style={{margin:'8px 0 2px'}}>Drag and drop your files</h3><p className="mu sm" style={{marginBottom:14}}>PDF, PPT, MP4, images</p>
          <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={e=>{void run(e.target.files?.[0]);e.currentTarget.value=''}}/>
          <button className="btn" onClick={()=>input.current?.click()}>Browse files</button></div>
      :<div className="card"><h3>{p<5?`Processing ${fileName}`:`Processed ${fileName}`}</h3>
          {STEPS.map((s,i)=><p key={s} className="row" style={{padding:'3px 0',color:i<=p?'var(--fg)':'var(--mu)'}}>{i<=p?<Icon n="check" s={16}/>:<span style={{width:16}}/>} {s}</p>)}
          <Bar v={Math.round((p+1)/6*100)}/></div>}
    <div className="g">{ctx.db.materials.map(m=>
      <div key={m[0]} className="card row" style={{padding:'12px 16px'}}><span className="mu"><Icon n={m[2] as IconName} s={20}/></span>
        <div className="sp"><b>{m[0]}</b><p className="mu sm">{m[1]}</p></div><span className="tag">Processed</span>
        <button className="btn o" onClick={()=>ctx.setView('2nf')}>View</button></div>)}</div></div>);
}

export function Assessments({ctx}:{ctx:Ctx}){
  const Q=ctx.db.quiz;
  const [qi,setQi]=useState(0),[pick,setPick]=useState<number|null>(null),[ans,setAns]=useState<number[]>([]);
  if(qi>=Q.length){
    const by:Record<string,[number,number]>={};
    Q.forEach((q,i)=>{by[q.t]??=[0,0];by[q.t][1]++;if(ans[i]===q.a)by[q.t][0]++});
    const sc=ans.filter((a,i)=>a===Q[i].a).length;
    const ent=Object.entries(by).map(([k,v])=>[k,Math.round(v[0]/v[1]*100)] as [string,number]).sort((a,b)=>a[1]-b[1]);
    const mis=Q.find((q,i)=>q.mis&&ans[i]!==q.a);
    return (<div className="page">
      <div className="card" style={{textAlign:'center'}}><p className="mu sm">Assessment complete</p><p className="big" style={{fontSize:52}}>{Math.round(sc/Q.length*100)}%</p><p className="mu">{sc} of {Q.length} correct</p></div>
      <div className="card"><h3>Topic performance</h3>{ent.map(e=><div key={e[0]}><div className="row" style={{marginTop:12}}><span className="sp">{e[0]}</span><b>{e[1]}%</b></div><Bar v={e[1]} w={e[1]<50}/></div>)}</div>
      {mis?.mis&&<div className="card" style={{borderColor:'var(--rd)'}}><div className="row" style={{color:'var(--rd)'}}><Icon n="alert"/> Potential misconception</div>
        <h3 style={{margin:'6px 0'}}>You may be confusing {mis.mis[0]} with {mis.mis[1]}.</h3>
        <p className="mu">Your answer suggests confusion between confirming a transaction and reversing it.</p></div>}
      <div className="row"><a className="btn" href="#/app/progress">View progress</a><button className="btn o" onClick={()=>{setQi(0);setAns([])}}>Retake</button></div></div>);
  }
  const q=Q[qi];
  const next=async()=>{const a=[...ans,pick!];setAns(a);setPick(null);setQi(qi+1);if(qi+1>=Q.length)ctx.setTopics(await api.submitQuiz(a))};
  return (<div className="page"><p className="mu sm">Question {qi+1} of {Q.length}</p><Bar v={(qi+1)/Q.length*100}/>
    <div className="row"><span className="tag">{q.t}</span><span className="tag">{q.d}</span></div><h2>{q.q}</h2>
    <div>{q.o.map((o,i)=><button key={o} className={`opt ${pick===i?'sel':''}`} onClick={()=>setPick(i)}>{o}</button>)}</div>
    <button className="btn" disabled={pick==null} onClick={next}>{qi===Q.length-1?'Submit':'Next'}</button></div>);
}

export function Progress({ctx}:{ctx:Ctx}){
  const T=ctx.topics,w=T.filter(t=>t.m<60).sort((a,b)=>a.m-b.m),att=[4,6,5,3],last=[90,70,50,35],R=[96,76,56,36];
  const ds:[string,number,string][]=[['Overall mastery',68,'Across all topics'],['Topics completed',78,'14 of 18 topics'],['Quiz accuracy',75,'Last 12 assessments'],['Weekly goal',50,'3 of 6 sessions']];
  return (<div className="page"><h2>Progress</h2>
    <div className="card"><Ttl a="Learning snapshot" b="Your key numbers at a glance"/>
      <div className="g g4" style={{textAlign:'center'}}>{ds.map((d,i)=><div key={d[0]}><div style={{display:'grid',placeItems:'center'}}><Ring v={d[1]} c={COL[i]}/></div>
        <p className="sm" style={{color:COL[i],fontWeight:600,marginTop:8}}>{d[0]}</p><p className="mu sm">{d[2]}</p></div>)}</div></div>
    <div className="card"><Ttl a="Topic mastery" b="How well you know each topic"/>
      {T.map((t,i)=><div key={t.n} className="row" style={{margin:'8px 0'}}>
        <div style={{width:110,lineHeight:1.2}}><b className="sm" style={{color:COL[i]}}>{t.n}</b><p className="mu" style={{fontSize:11}}>{t.src}</p></div>
        <div style={{flex:1,height:30,background:'var(--hv)',...AR}}><div style={{width:`${t.m}%`,minWidth:84,height:'100%',background:COL[i],position:'relative',...AR}}>
          <span style={{position:'absolute',right:0,top:0,bottom:0,padding:'0 20px 0 12px',background:DK[i],color:'#fff',fontWeight:600,display:'flex',alignItems:'center',...AR}}>{t.m}%</span></div></div></div>)}</div>
    <div className="card" style={{overflowX:'auto'}}><Ttl a="Assessment history" b="Attempts and latest score per topic"/>
      <div style={{minWidth:460,display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:4,textAlign:'center'}}>
        {['Topic','Mastery','Attempts','Last score'].map((x,i)=><div key={x} style={{background:COL[i],color:'#fff',fontWeight:600,padding:8,...AR}}>{x}</div>)}
        {T.flatMap((t,i)=>[<b key={t.n+'a'} style={{color:'#2f7f8c'}}>{t.n}</b>,`${t.m}%`,att[i],`${last[i]}%`].map((x,j)=><div key={t.n+j} style={{background:'var(--hv)',padding:'10px 4px',color:'var(--mu)'}}>{x}</div>))}</div></div>
    <div className="card"><Ttl a="Mastery by ring" b="Outer to inner: each ring is one topic"/>
      <div className="row" style={{justifyContent:'center',flexWrap:'wrap',gap:28}}>
        <svg width="240" height="240" viewBox="0 0 240 240">{T.map((t,i)=>{const r=R[i],C=2*Math.PI*r,a=t.m/100*2*Math.PI-Math.PI/2;return (
          <g key={t.n}><circle cx="120" cy="120" r={r} fill="none" stroke="var(--hv)" strokeWidth="17"/>
            <circle cx="120" cy="120" r={r} fill="none" stroke={COL[i]} strokeWidth="17" strokeDasharray={`${C*t.m/100} ${C}`} transform="rotate(-90 120 120)"/>
            <text x={120+r*Math.cos(a)} y={123+r*Math.sin(a)} textAnchor="middle" fontSize="9" fontWeight="600" fill="#fff">{t.m}</text></g>)})}</svg>
        <div>{T.map((t,i)=><p key={t.n} className="row sm" style={{padding:'4px 0'}}><i style={{width:12,height:12,borderRadius:3,background:COL[i]}}/><b>{t.n}</b><span className="mu">{t.m}%</span></p>)}</div></div></div>
    {w[0]&&<div className="card" style={{background:'var(--sb)'}}><p className="mu sm">Recommended for you</p><h3 style={{margin:'4px 0 8px'}}>You struggled with {w[0].n} in your last assessment.</h3>
      <p className="mu">Review {w[0].n}, then practice 5 questions.</p><a className="btn" style={{marginTop:12}} href="#/app/assessments">Start practice</a></div>}
    <div className="card"><h3>Weak topics</h3>{w.map(t=><div key={t.n} className="row" style={{padding:'8px 0',borderBottom:'1px solid var(--bd)'}}><span className="sp">{t.n}</span><span className="tag">{t.m}%</span></div>)}</div>
    <div className="card"><h3>Study plan · exam in 15 days</h3>{ctx.db.plan.map(p=><div key={p[0]} className="row" style={{padding:'8px 0'}}><span style={{width:44}} className="mu">{p[0]}</span><span className="sp">{p[1]}</span><span className="tag">{p[2]}</span></div>)}</div></div>);
}

export function CourseMap({ctx}:{ctx:Ctx}){
  const [node,setNode]=useState('Normalization'),t=ctx.topics.find(x=>x.n===node)!;
  return (<div className="page"><h2>Course map</h2>
    <div className="card row" style={{flexWrap:'wrap',justifyContent:'center'}}>{ctx.topics.map((x,i)=>
      <span key={x.n} className="row">{i>0&&<span className="mu"><Icon n="down" s={16}/></span>}<button className={`node ${node===x.n?'on':''}`} onClick={()=>setNode(x.n)}>{x.n}</button></span>)}</div>
    <div className="card"><h3>{t.n}</h3><p className="mu" style={{margin:'4px 0 10px'}}>Mastery {t.m}% · Prerequisites: {t.pre.join(', ')||'none'}</p>
      <p className="mu sm">Source: {t.src}</p>
      <div className="row" style={{marginTop:12}}><a className="btn" href="#/app/chat">Ask AI</a><a className="btn o" href="#/app/assessments">Practice</a></div></div></div>);
}

export function Settings({ctx}:{ctx:Ctx}){
  return (<div className="page"><h2>Settings</h2><div className="card g">
    <label>Name<input className="t" defaultValue={ctx.db.user}/></label>
    <label className="row"><input type="checkbox" checked={ctx.dark} onChange={e=>ctx.setDark(e.target.checked)}/> Dark appearance</label>
    <button className="btn" style={{width:'fit-content'}} onClick={()=>ctx.toast('Saved')}>Save changes</button></div></div>);
}
