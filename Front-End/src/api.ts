import raw from './data/mock.json';
import type {Mock,Topic} from './types';
const db=structuredClone(raw) as unknown as Mock;
const wait=<T,>(v:T,ms=0)=>new Promise<T>(r=>setTimeout(()=>r(v),ms));
const errorMessage=async(res:Response)=>{
  const body=await res.text();
  try{return (JSON.parse(body) as {message?:string}).message??body}
  catch{return body}
};
export const api={
  getMock:()=>wait(db),
  upload:async(file:File)=>{
    const body=new FormData();
    body.append('pdf',file);
    const res=await fetch('/upload',{method:'POST',body});
    if(!res.ok)throw new Error(await errorMessage(res)||'PDF upload failed.');
    return res.json() as Promise<{success:boolean;totalChunks:number}>;
  },
  ask:async(query:string)=>{
    const res=await fetch('/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
    if(!res.ok)throw new Error(await errorMessage(res)||'Could not get an answer.');
    return res.text();
  },
  generateQuiz:async(input:{topic:string;count:number;difficulty:string;type:string})=>{
    const res=await fetch('/quiz/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    if(!res.ok)throw new Error(await errorMessage(res)||'Could not generate a quiz.');
    return res.json() as Promise<{quizId:string;questions:{id:string;question:string;type:'mcq'|'short'|'numerical';options:string[];topic:string;difficulty:string;source:string;page:number}[]}>;
  },
  submitGeneratedQuiz:async(quizId:string,answers:string[])=>{
    const res=await fetch('/quiz/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quizId,answers})});
    if(!res.ok)throw new Error(await errorMessage(res)||'Could not grade the quiz.');
    return res.json() as Promise<{score:number;total:number;accuracy:number;topics:{topic:string;correct:number;total:number;accuracy:number}[];weakTopics:string[];results:{id:string;correct:boolean;topic:string;correctAnswer:string;explanation:string;source:string;page:number}[]}>;
  },
  /** Grade a quiz and return updated topic mastery */
  submitQuiz:(answers:number[])=>{
    db.topics.forEach(t=>{const qs=db.quiz.filter(q=>q.t===t.n);if(!qs.length)return;
      const c=qs.filter(q=>answers[db.quiz.indexOf(q)]===q.a).length/qs.length;t.m=Math.round(t.m*.5+c*50)});
    return wait<Topic[]>(db.topics.map(t=>({...t})));
  },
};
