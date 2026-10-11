import { useRef, useState } from 'react';
import { Icon } from '../icons';
import { api } from '../api';
import type { Ctx, Msg } from '../types';

export function ChatPage({ ctx }: { ctx: Ctx }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const msgs: Msg[] = ctx.cur == null ? [] : ctx.chats[ctx.cur]?.msgs ?? [];
  const send = async (value = text) => {
    const query = value.trim();
    if (!query || busy) return;
    setText(''); setBusy(true);
    let index = ctx.cur;
    if (index == null) {
      index = ctx.chats.length;
      ctx.setChats(chats => [...chats, { t: query.slice(0, 48), g: 'Recent', msgs: [] }]);
      ctx.setCur(index);
    }
    const chatIndex = index;
    ctx.setChats(chats => chats.map((chat, i) => i === chatIndex ? { ...chat, msgs: [...chat.msgs, { u: query }, { load: true }] } : chat));
    try {
      const result = await api.ask(query, ctx.lang);
      ctx.setChats(chats => chats.map((chat, i) => i === chatIndex ? { ...chat, msgs: chat.msgs.map((msg, j) => j === chat.msgs.length - 1 ? { answer: result.answer, sources: result.sources } : msg) } : chat));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not get an answer.';
      ctx.setChats(chats => chats.map((chat, i) => i === chatIndex ? { ...chat, msgs: chat.msgs.map((msg, j) => j === chat.msgs.length - 1 ? { answer: message } : msg) } : chat));
    } finally { setBusy(false); requestAnimationFrame(() => ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })); }
  };
  const composer = <div className="comp"><textarea rows={1} value={text} onChange={e => setText(e.target.value)} placeholder="Ask about your uploaded course material" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} /><div className="crow"><a className="ib" href="#/app/library" aria-label="Add files"><Icon n="plus" s={20} /></a><span className="sp" /><button className="snd" disabled={busy || !text.trim()} onClick={() => void send()} aria-label="Send"><Icon n="up" /></button></div></div>;
  return <div className="chat"><div className="scr" ref={ref}><div className="thread">
    {!msgs.length && <div className="hero2"><h2>What are you studying today?</h2><p className="mu">Answers use your PDFs, slide decks, and lecture transcripts with source locations.</p>{composer}</div>}
    {msgs.map((msg, i) => msg.u ? <div key={i} className="um"><div className="ub">{msg.u}</div></div> : msg.load ? <div key={i} className="am mu">Searching uploaded material…</div> : <div key={i} className="am"><p>{msg.answer}</p>{!!msg.sources?.length && <div className="nc"><b>Sources</b>{msg.sources.map(source => <p className="sm" key={`${source.documentId}-${source.locationType}-${source.locationNumber}`}>[{source.id}] <a href={api.sourceUrl(source.documentId, source.locationNumber, source.sourceType)} target="_blank" rel="noreferrer">{source.name} · {source.locationType === 'slide' ? 'Slide' : source.locationType === 'time' ? 'Video time (seconds)' : 'Page'} {source.locationNumber}</a></p>)}</div>}</div>)}
    {msgs.length > 0 && <div className="cbar">{composer}<p className="foot">Check important information against the cited source.</p></div>}
  </div></div></div>;
}
