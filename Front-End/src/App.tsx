import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from './api';
import { Icon, type IconName } from './icons';
import logo from './assets/logo.png';
import type { Chat, Lang, Ctx } from './types';
import { ChatPage } from './pages/Chat';
import { Library, Assessments, Progress, CourseMap, Settings } from './pages/Pages';

const NAV: [string, string, IconName][] = [['library', 'Library', 'book'], ['assessments', 'Assessments', 'file'], ['progress', 'Progress', 'chart'], ['map', 'Course map', 'net']];
const go = (r: string) => { location.hash = r };
const useHash = () => {
  const [hash, setHash] = useState(location.hash.slice(1) || '/');
  useEffect(() => { const update = () => setHash(location.hash.slice(1) || '/'); addEventListener('hashchange', update); return () => removeEventListener('hashchange', update); }, []);
  return hash;
};

export default function App() {
  const route = useHash();
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [authReady, setAuthReady] = useState(false), [authError, setAuthError] = useState(''), [authBusy, setAuthBusy] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login'), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [chats, setChats] = useState<Chat[]>([]);
  const [cur, setCur] = useState<number | null>(null), [lang, setLang] = useState<Lang>('en');
  const [dark, setDark] = useState(matchMedia('(prefers-color-scheme:dark)').matches);
  const [collapsed, setCollapsed] = useState(false), [mobileOpen, setMobileOpen] = useState(false), [search, setSearch] = useState('');
  const [toastText, setToastText] = useState<string | null>(null);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => { if (route === '/' || route === '/login') go('/app/chat'); setMobileOpen(false); }, [route]);
  useEffect(() => {
    api.me().then(({ user: activeUser }) => { setUser(activeUser); setAuthReady(true); })
      .catch(error => {
        if (error instanceof ApiError && error.status === 401) setAuthReady(true);
        else setAuthError(error instanceof Error ? error.message : 'Could not check your session.');
      });
  }, []);
  const authenticate = async (event: FormEvent) => {
    event.preventDefault(); setAuthBusy(true); setAuthError('');
    try {
      const result = authMode === 'register' ? await api.register(email, password) : await api.login(email, password);
      setChats([]); setCur(null); setUser(result.user); setAuthReady(true); setPassword('');
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Authentication failed.'); }
    finally { setAuthBusy(false); }
  };
  const signOut = async () => {
    try { await api.logout(); setUser(null); setChats([]); setCur(null); setPassword(''); setAuthError(''); }
    catch (error) { toast(error instanceof Error ? error.message : 'Could not sign out.'); }
  };
  const toast = (value: string) => { setToastText(value); setTimeout(() => setToastText(null), 1800); };
  const ctx: Ctx = { chats, setChats, cur, setCur, lang, toast, dark, setDark };
  const page = route.replace('/app/', '') || 'chat';
  const visibleChats = chats.map((chat, index) => ({ chat, index })).filter(item => item.chat.t.toLowerCase().includes(search.toLowerCase()));
  const linkStyle = { color: 'inherit', textDecoration: 'none' } as const;
  if (!authReady) return <div className="page"><p className="mu">{authError || 'Checking your session…'}</p>{authError && <button className="btn" onClick={() => location.reload()}>Retry</button>}</div>;
  if (!user) return <div className="auth-shell"><form className="card g auth-card" onSubmit={authenticate}>
    <img src={logo} width={56} height={56} alt="LearnIQ" style={{ margin: 'auto' }} /><h2>{authMode === 'register' ? 'Create your LearnIQ account' : 'Sign in to LearnIQ'}</h2>
    <label>Email<input className="t" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
    <label>Password<input className="t" type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} required minLength={authMode === 'register' ? 12 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label>
    {authMode === 'register' && <p className="mu sm">Use at least 12 characters.</p>}{authError && <p role="alert" style={{ color: 'var(--rd)' }}>{authError}</p>}
    <button className="btn" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Sign in'}</button>
    <button type="button" className="btn o" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setAuthError(''); }}>{authMode === 'register' ? 'I already have an account' : 'Create an account'}</button>
  </form></div>;
  return <>
    <div id="app" className={`${collapsed ? 'c' : ''} ${mobileOpen ? 'o' : ''}`}>
      <div className="bdp" onClick={() => setMobileOpen(false)} />
      <aside>
        <div className="row" style={{ padding: '4px 4px 8px' }}><img src={logo} width={26} height={26} alt="LearnIQ" /><b className="sp">LearnIQ</b><button className="ib" onClick={() => setCollapsed(v => !v)} aria-label="Collapse sidebar"><Icon n="panel" /></button></div>
        <button className="it" onClick={() => { setCur(null); go('/app/chat'); }}><Icon n="edit" /> New chat</button>
        <div className="it" style={{ padding: '2px 10px' }}><Icon n="search" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chats" style={{ background: 'none', border: 0, outline: 0, width: '100%', padding: '6px 0' }} /></div>
        {NAV.map(item => <a key={item[0]} className={`it ${page === item[0] ? 'on' : ''}`} href={`#/app/${item[0]}`} style={linkStyle}><Icon n={item[2]} /> {item[1]}</a>)}
        <div className="lbl" style={{ paddingTop: 18 }}>Recent chats</div><div style={{ flex: 1, overflow: 'auto' }}>{visibleChats.map(({ chat, index }) => <button key={index} className={`it ${cur === index ? 'on' : ''}`} onClick={() => { setCur(index); go('/app/chat'); }}>{chat.t}</button>)}</div>
        <a className="it" href="#/app/settings" style={linkStyle}><Icon n="gear" /> Settings</a>
        <div className="it" title={user.email}><span className="sp">{user.email}</span><button className="ib" onClick={() => void signOut()} aria-label="Sign out"><Icon n="out" /></button></div>
      </aside>
      <section className="mn"><header><button className="ib" onClick={() => { setCollapsed(v => !v); setMobileOpen(v => !v); }} aria-label="Toggle sidebar"><Icon n="panel" s={20} /></button>
        {page === 'chat' ? <select value={lang} onChange={e => setLang(e.target.value as Lang)} aria-label="Response language"><option value="en">English</option><option value="hi">Hindi</option><option value="hn">Hinglish</option></select> : <b style={{ padding: '0 8px' }}>{NAV.find(item => item[0] === page)?.[1] ?? 'Settings'}</b>}
      </header><div className="body">{page === 'library' ? <Library ctx={ctx} /> : page === 'assessments' ? <Assessments ctx={ctx} /> : page === 'progress' ? <Progress ctx={ctx} /> : page === 'map' ? <CourseMap ctx={ctx} /> : page === 'settings' ? <Settings ctx={ctx} /> : <ChatPage ctx={ctx} />}</div></section>
    </div>
    {toastText && <div className="tg">{toastText}</div>}
  </>;
}
