import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { api } from '../api';
import type { Ctx } from '../types';
const Bar = ({ v, w }: { v: number; w?: boolean }) => <div className={`bar ${w ? 'w' : ''}`}><i style={{ width: `${v}%` }} /></div>;
export function Library({ ctx }: { ctx: Ctx }) {
  const [documents, setDocuments] = useState<Awaited<ReturnType<typeof api.documents>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const refresh = async () => { setLoading(true); setError(''); try { setDocuments(await api.documents()); } catch (err) { setError(err instanceof Error ? err.message : 'Could not load documents.'); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, []);
  const run = async (file?: File) => {
    if (!file) return;
    if (!['.pdf', '.pptx', '.mp4', '.mov', '.webm'].some(extension => file.name.toLowerCase().endsWith(extension))) { setError('Choose a PDF, PPTX, MP4, MOV, or WebM file.'); return; }
    setFileName(file.name); setUploading(true); setError('');
    try {
      await api.upload(file);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF upload failed. Please try again.');
    } finally { setUploading(false); }
  };
  return (<div className="page"><h2>Library</h2>
    <div className="card" style={{ textAlign: 'center', borderStyle: 'dashed', padding: '36px 20px' }}><div className="mu"><Icon n="upl" s={28} /></div>
      <h3 style={{ margin: '8px 0 2px' }}>{uploading ? `Processing ${fileName}…` : 'Add course material'}</h3><p className="mu sm" style={{ marginBottom: 14 }}>PDF pages and PPTX slide text and images, plus MP4/MOV/WebM lecture transcripts, are indexed with page, slide, or timestamp citations. Visual extraction uses Gemini and has not been live-verified here.</p>
      <input ref={input} type="file" accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx,video/mp4,.mp4,video/quicktime,.mov,video/webm,.webm" hidden onChange={e => { void run(e.target.files?.[0]); e.currentTarget.value = ''; }} />
      <button className="btn" disabled={uploading} onClick={() => input.current?.click()}>{uploading ? 'Processing…' : 'Choose material'}</button></div>
    {error && <p role="alert" style={{ color: 'var(--rd)' }}>{error}</p>}
    <h3>Indexed documents</h3>{loading ? <p className="mu">Loading documents…</p> : documents.length ? <div className="g">{documents.map(doc => <div key={doc.id} className="card row" style={{ padding: '12px 16px' }}><span className="mu"><Icon n="file" s={20} /></span><div className="sp"><b>{doc.name}</b><p className="mu sm">{doc.sourceType === 'video' ? `${doc.pages} seconds of transcript` : `${doc.pages} ${doc.sourceType === 'pptx' ? 'slides' : 'pages'} indexed`}</p></div><a className="btn o" href={api.sourceUrl(doc.id, doc.sourceType === 'video' ? 0 : 1, doc.sourceType)} target="_blank" rel="noreferrer">{doc.sourceType === 'video' ? 'Play' : 'Open'}</a>{doc.sourceType === 'pptx' && <a className="btn o" href={api.sourceFileUrl(doc.id)}>Download</a>}<button className="btn o" disabled={deleting === doc.id} onClick={async () => { setDeleting(doc.id); setError(''); try { await api.deleteDocument(doc.id); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete document.'); } finally { setDeleting(null); } }}>{deleting === doc.id ? 'Deleting…' : 'Delete'}</button></div>)}</div> : <div className="card"><p className="mu">No indexed documents yet. Add course material to start tutoring.</p></div>}
    </div>);
}

export function Assessments({ ctx }: { ctx: Ctx }) {
  type Quiz = Awaited<ReturnType<typeof api.generateQuiz>>;
  type Report = Awaited<ReturnType<typeof api.submitGeneratedQuiz>>;
  const [documents, setDocuments] = useState<Awaited<ReturnType<typeof api.documents>>>([]), [documentsError, setDocumentsError] = useState('');
  useEffect(() => { api.documents().then(setDocuments).catch(err => setDocumentsError(err instanceof Error ? err.message : 'Could not load documents.')); }, []);
  const [documentId, setDocumentId] = useState('');
  const [topic, setTopic] = useState(''), [count, setCount] = useState(5), [difficulty, setDifficulty] = useState('mixed'), [type, setType] = useState('mixed');
  const [mode, setMode] = useState<'practice' | 'mock_exam' | 'diagnostic'>('practice');
  const [quiz, setQuiz] = useState<Quiz | null>(null), [qi, setQi] = useState(0), [answers, setAnswers] = useState<string[]>([]), [value, setValue] = useState('');
  const [report, setReport] = useState<Report | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const start = async () => { setBusy(true); setError(''); try { const next = await api.generateQuiz({ topic, count, difficulty, type, mode, documentId: documentId || undefined }); setQuiz(next); setQi(0); setAnswers([]); setReport(null); setValue('') } catch (e) { setError(e instanceof Error ? e.message : 'Quiz generation failed.') } finally { setBusy(false) } };
  const advance = async () => { if (!quiz) return; const next = [...answers, value]; setAnswers(next); setValue(''); if (qi + 1 < quiz.questions.length) { setQi(qi + 1); return } setBusy(true); try { setReport(await api.submitGeneratedQuiz(quiz.quizId, next)) } catch (e) { setError(e instanceof Error ? e.message : 'Could not submit quiz.') } finally { setBusy(false) } };
  if (report && quiz) return <div className="page"><div className="card" style={{ textAlign: 'center' }}><p className="mu sm">{report.mode === 'mock_exam' ? 'Mock exam complete' : report.mode === 'diagnostic' ? 'Baseline diagnostic complete' : 'Assessment complete'}</p><p className="big" style={{ fontSize: 52 }}>{report.accuracy}%</p><p className="mu">{report.score} of {report.total} correct</p></div>
    <div className="card"><h3>Topic performance</h3>{report.topics.map(t => <div key={t.topic}><div className="row" style={{ marginTop: 12 }}><span className="sp">{t.topic}</span><b>{t.accuracy}%</b></div><Bar v={t.accuracy} w={t.accuracy < 60} /></div>)}</div>
    {!!report.weakTopics.length && <div className="card"><h3>Topics to revise</h3><p className="mu">Based on this assessment: {report.weakTopics.join(', ')}</p></div>}
    {!!report.possibleMisconceptions.length && <div className="card"><h3>Possible misconception patterns</h3><p className="mu sm">Tentative model analysis based on repeated incorrect answers; this is not a diagnosis.</p>{report.possibleMisconceptions.map((item, i) => <div key={item.topic + i}><b>{item.topic}</b><p>{item.statement}</p><p className="mu sm">Evidence: “{item.evidence}” · model confidence {Math.round(item.confidence * 100)}%</p>{item.sources.map((source, j) => <a className="mu sm" key={source.documentId + j} style={{ marginRight: 10 }} href={api.sourceUrl(source.documentId, source.locationNumber, source.sourceType)} target="_blank" rel="noreferrer">{source.source} · {source.locationType} {source.locationNumber}</a>)}</div>)}</div>}
    <div className="card"><h3>Answer review</h3>{report.results.map((r, i) => <div key={r.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--bd)' }}><b>{i + 1}. {quiz.questions[i].question}</b><p style={{ color: r.correct ? 'var(--gr)' : 'var(--rd)' }}>{r.correct ? 'Correct' : 'Incorrect'} · Answer: {r.correctAnswer}</p><p className="mu">{r.explanation}</p><p className="mu sm">Source: <a href={api.sourceUrl(r.documentId, r.locationNumber, r.sourceType)} target="_blank" rel="noreferrer">{r.source} — {r.locationType === 'slide' ? 'Slide' : r.locationType === 'time' ? `Video ${Math.floor(r.locationNumber / 60)}:${String(r.locationNumber % 60).padStart(2, '0')}` : `Page ${r.locationNumber}`}</a></p></div>)}</div>
    <div className="row"><button className="btn" onClick={() => { setQuiz(null); setReport(null) }}>New assessment</button></div></div>;
  if (!quiz) return <div className="page"><h2>Assessments</h2><p className="mu">Create practice, baseline diagnostic, or mock exam questions from your uploaded course material.</p><div className="card g">
    <label>Assessment mode<select className="t" value={mode} onChange={e => setMode(e.target.value as typeof mode)}>{[['practice', 'Practice'], ['diagnostic', 'Baseline diagnostic (new learners)'], ['mock_exam', 'Mock exam']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    <label>Course material<select className="t" value={documentId} onChange={e => setDocumentId(e.target.value)}><option value="">All my documents</option>{documents.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}</select></label>
    {documentsError && <p role="alert" style={{ color: 'var(--rd)' }}>{documentsError}</p>}
    <label>Topic or scope<input className="t" value={topic} onChange={e => setTopic(e.target.value)} placeholder="Leave blank to search all material" maxLength={120} /></label>
    <label>Number of questions<select className="t" value={count} onChange={e => setCount(Number(e.target.value))}>{[3, 5, 8, 10].map(n => <option key={n}>{n}</option>)}</select></label>
    <label>Difficulty<select className="t" value={difficulty} onChange={e => setDifficulty(e.target.value)}>{['mixed', 'adaptive', 'easy', 'medium', 'hard'].map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</select></label>
    <label>Question type<select className="t" value={type} onChange={e => setType(e.target.value)}>{[['mixed', 'Mixed'], ['mcq', 'Multiple choice'], ['short', 'Short answer'], ['numerical', 'Numerical']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    {error && <p style={{ color: 'var(--rd)' }}>{error}</p>}<button className="btn" disabled={busy} onClick={() => void start()}>{busy ? 'Generating…' : 'Generate assessment'}</button></div></div>;
  const q = quiz.questions[qi];
  return <div className="page"><p className="mu sm">{quiz.mode === 'mock_exam' ? 'Mock exam' : quiz.mode === 'diagnostic' ? 'Baseline diagnostic' : 'Practice'} · Question {qi + 1} of {quiz.questions.length}</p>{quiz.personalizationReason && <p className="mu sm">{quiz.personalizationReason}</p>}<Bar v={(qi + 1) / quiz.questions.length * 100} />
    <div className="row"><span className="tag">{q.topic}</span><span className="tag">{q.difficulty}</span><span className="tag">{q.type}</span></div><h2>{q.question}</h2>
    {q.type === 'mcq' ? q.options.map(o => <button key={o} className={`opt ${value === o ? 'sel' : ''}`} onClick={() => setValue(o)}>{o}</button>) : <textarea className="t" value={value} onChange={e => setValue(e.target.value)} rows={3} placeholder={q.type === 'numerical' ? 'Enter a number' : 'Write your answer'} />}
    <p className="mu sm">Source: <a href={api.sourceUrl(q.documentId, q.locationNumber, q.sourceType)} target="_blank" rel="noreferrer">{q.source} — {q.locationType === 'slide' ? `Slide ${q.locationNumber}` : q.locationType === 'time' ? `Video ${Math.floor(q.locationNumber / 60)}:${String(q.locationNumber % 60).padStart(2, '0')}` : `Page ${q.locationNumber}`}</a></p>{error && <p style={{ color: 'var(--rd)' }}>{error}</p>}
    <button className="btn" disabled={!value.trim() || busy} onClick={() => void advance()}>{busy ? 'Grading…' : qi === quiz.questions.length - 1 ? 'Submit' : 'Next'}</button></div>;
}

export function Progress(_props: { ctx: Ctx }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.progress>> | null>(null), [error, setError] = useState('');
  useEffect(() => { api.progress().then(setData).catch(err => setError(err instanceof Error ? err.message : 'Could not load progress.')); }, []);
  return <div className="page"><h2>Progress</h2>{error && <p role="alert" style={{ color: 'var(--rd)' }}>{error}</p>}{!data ? !error && <p className="mu">Loading progress…</p> : <>
    <div className="card"><h3>Topic mastery</h3>{data.mastery.length ? data.mastery.map(item => <div key={item.topic} style={{ margin: '14px 0' }}><div className="row"><b className="sp">{item.topic}</b><span>{item.mastery}%</span><span className="mu sm">{item.attempts} answers</span></div><Bar v={item.mastery} w={item.mastery < 60} /></div>) : <p className="mu">Complete an assessment to begin a topic mastery estimate.</p>}</div>
    <div className="card"><h3>Assessment history</h3>{data.assessments.length ? data.assessments.map(assessment => <div key={assessment.id} className="row" style={{ padding: '10px 0', borderBottom: '1px solid var(--bd)' }}><span className="sp">{new Date(assessment.createdAt).toLocaleString()} · {assessment.mode.replace('_', ' ')}</span><b>{assessment.score}/{assessment.total} · {assessment.accuracy}%</b></div>) : <div><p className="mu">No completed assessments yet. A short baseline diagnostic gives you an initial observed-performance estimate.</p><a className="btn" href="#/app/assessments">Start a baseline diagnostic</a></div>}</div>
    {!!data.mastery.filter(item => item.mastery < 60).length && <div className="card"><h3>Topics to revisit</h3><p className="mu">Based on verified assessment answers: {data.mastery.filter(item => item.mastery < 60).map(item => item.topic).join(', ')}</p><a className="btn" href="#/app/assessments">Practice weak topics</a></div>}
  </>}</div>;
}

export function CourseMap(_props: { ctx: Ctx }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.topicMap>> | null>(null), [error, setError] = useState('');
  useEffect(() => { api.topicMap().then(setData).catch(err => setError(err instanceof Error ? err.message : 'Could not load course topics.')); }, []);
  const nameById = new Map((data?.topics || []).map(topic => [topic.id, topic.name]));
  return <div className="page"><h2>Course map</h2>{error && <p role="alert" style={{ color: 'var(--rd)' }}>{error}</p>}{!data ? !error && <p className="mu">Loading source-backed topics…</p> : data.topics.length ? <>
    <p className="mu">Topics and relationships are extracted from your indexed sources. Each item links to evidence used to identify it.</p>
    <div className="g">{data.topics.map(topic => <div className="card" key={topic.id}><div className="row"><h3 className="sp">{topic.name}</h3><span className="tag">{topic.kind}</span></div>{topic.description && <p className="mu">{topic.description}</p>}
      {data.relations.filter(relation => relation.fromId === topic.id).map(relation => <p className="mu sm" key={`${relation.documentId}-${relation.toId}`}>{relation.type === 'prerequisite' ? 'Prerequisite' : 'Subtopic'}: <b>{nameById.get(relation.toId) || 'Unknown topic'}</b> — {relation.evidence} · <a href={api.sourceUrl(relation.documentId, relation.locationNumber, relation.locationType === 'slide' ? 'pptx' : relation.locationType === 'time' ? 'video' : 'pdf')} target="_blank" rel="noreferrer">{relation.source} {relation.locationType} {relation.locationNumber}</a></p>)}
      <p className="mu sm">Associated source chunks: {topic.chunks.length}</p>
      {topic.sources.map((source, i) => <p className="mu sm" key={`${source.documentId}-${source.locationType}-${source.locationNumber}-${i}`}><a href={api.sourceUrl(source.documentId, source.locationNumber, source.locationType === 'slide' ? 'pptx' : source.locationType === 'time' ? 'video' : 'pdf')} target="_blank" rel="noreferrer">{source.source} · {source.locationType} {source.locationNumber}</a><br />Evidence: “{source.evidence}”</p>)}
    </div>)}</div>
  </> : <div className="card"><h3>No indexed topics yet</h3><p className="mu">Upload supported course material to extract a source-backed topic map.</p><a className="btn" href="#/app/library">View library</a></div>}</div>;
}

export function Settings({ ctx }: { ctx: Ctx }) {
  return <div className="page"><h2>Settings</h2><div className="card g"><label className="row"><input type="checkbox" checked={ctx.dark} onChange={e => ctx.setDark(e.target.checked)} /> Dark appearance</label><p className="mu sm">Theme preference applies to this session. Accounts and saved preferences are not configured.</p></div></div>;
}
