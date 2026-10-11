export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch { throw new Error('Unable to reach the learning server. Check that it is running and try again.'); }
  if (!response.ok) {
    const body = await response.text();
    let message = `Request failed (${response.status}).`;
    try { message = (JSON.parse(body) as { message?: string }).message || message; } catch { /* Keep server error bodies private. */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export interface Source { id: number; documentId: string; name: string; sourceType: string; locationType: 'page' | 'slide' | 'time'; locationNumber: number }
export interface Document { id: string; name: string; pages: number; sourceType: string; createdAt: string }
export interface ProgressData { mastery: { topic: string; mastery: number; attempts: number; updatedAt: string }[]; assessments: { id: string; score: number; total: number; accuracy: number; mode: string; createdAt: string; topics: { topic: string; correct: number; total: number; accuracy: number }[]; results: { id: string; correct: boolean; topic: string; correctAnswer: string; explanation: string; source: string; documentId: string; sourceType: string; locationType: 'page' | 'slide' | 'time'; locationNumber: number }[]; possibleMisconceptions: { topic: string; statement: string; confidence: number; questionIds: string[]; evidence: string; sources: { source: string; documentId: string; sourceType: string; locationType: 'page' | 'slide' | 'time'; locationNumber: number }[] }[] }[] }
export interface TopicMapData { topics: { id: string; name: string; description: string; kind: 'topic' | 'subtopic' | 'concept'; sources: { documentId: string; source: string; evidence: string; locationType: 'page' | 'slide' | 'time'; locationNumber: number }[]; chunks: { documentId: string; chunkIndex: number }[] }[]; relations: { fromId: string; toId: string; type: 'prerequisite' | 'subtopic'; documentId: string; source: string; evidence: string; confidence: number; locationType: 'page' | 'slide' | 'time'; locationNumber: number }[] }
export const api = {
  me: () => request<{ user: { id: string; email: string } }>('/auth/me'),
  login: (email: string, password: string) => request<{ user: { id: string; email: string } }>('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string) => request<{ user: { id: string; email: string } }>('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }),
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  upload: async (file: File) => {
    const body = new FormData(); body.append('material', file);
    return request<{ success: boolean; totalChunks: number; documentId: string }>('/upload', { method: 'POST', body });
  },
  documents: async () => (await request<{ documents: Document[] }>('/upload')).documents,
  deleteDocument: (id: string) => request<{ success: boolean }>(`/upload/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  sourceUrl: (id: string, location: number, sourceType = 'pdf') => {
    const key = sourceType === 'video' ? 'time' : sourceType === 'pptx' ? 'slide' : 'page';
    return sourceType === 'video' ? `/upload/${encodeURIComponent(id)}/source?${key}=${location}#t=${location}` : `/upload/${encodeURIComponent(id)}/source?${key}=${location}#${key}=${location}`;
  },
  sourceFileUrl: (id: string) => `/upload/${encodeURIComponent(id)}/file`,
  progress: () => request<ProgressData>('/progress'),
  topicMap: () => request<TopicMapData>('/progress/topics'),
  ask: (query: string, language: 'en' | 'hi' | 'hn') => request<{ answer: string; sources: Source[] }>('/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, language }) }),
  generateQuiz: (input: { topic: string; count: number; difficulty: string; type: string; mode?: 'practice' | 'mock_exam' | 'diagnostic'; documentId?: string }) => request<{ quizId: string; mode: string; personalizationReason: string | null; questions: { id: string; question: string; type: 'mcq' | 'short' | 'numerical'; options: string[]; topic: string; difficulty: string; source: string; documentId: string; sourceType: string; locationType: 'page' | 'slide' | 'time'; locationNumber: number }[] }>('/quiz/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
  submitGeneratedQuiz: (quizId: string, answers: string[]) => request<{ score: number; total: number; accuracy: number; mode: string; topics: { topic: string; correct: number; total: number; accuracy: number }[]; weakTopics: string[]; possibleMisconceptions: { topic: string; statement: string; confidence: number; questionIds: string[]; evidence: string; sources: { source: string; documentId: string; sourceType: string; locationType: 'page' | 'slide' | 'time'; locationNumber: number }[] }[]; results: { id: string; correct: boolean; topic: string; correctAnswer: string; explanation: string; source: string; documentId: string; sourceType: string; locationType: 'page' | 'slide' | 'time'; locationNumber: number }[] }>('/quiz/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quizId, answers }) }),
};
