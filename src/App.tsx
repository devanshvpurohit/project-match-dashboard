import { useCallback, useEffect, useState } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase, FUNCTIONS_URL, ANON_KEY } from './lib/supabase';

// ---------- types ----------

interface Project {
  id: string;
  title: string;
  description: string;
  tech_stack: string[] | null;
  github_url: string | null;
  demo_url: string | null;
  submitter: { full_name: string | null; department: string | null } | null;
}

interface ScoreResult {
  project_id: string;
  title: string;
  submitter: string;
  score: number;
  rationale: string;
  best_problem: string;
}

// ---------- config ----------

const ADMIN_USERNAME = import.meta.env.VITE_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? 'bazinga2026';
const EMAIL_TO = import.meta.env.VITE_EMAIL_TO ?? 'devanshvpurohit@gmail.com';
const SESSION_KEY = 'pmd_session';

const buildEmailHtml = (best: ScoreResult, total: number) => `
  <div style="font-family: Inter, system-ui, sans-serif; max-width: 560px; margin: auto; padding: 24px;">
    <div style="font-size: 22px; font-weight: 700; color: #00897B;">Trophy Best Developer Match</div>
    <p style="color: #666; margin: 4px 0 20px;">AI-ranked from ${total} submitted projects against this month's problem statements.</p>
    <div style="border: 1px solid #e5e7eb; border-radius: 14px; padding: 20px;">
      <div style="font-size: 18px; font-weight: 600;">${best.title}</div>
      <div style="color: #666; font-size: 14px;">by ${best.submitter}</div>
      <div style="margin: 16px 0; padding: 12px; background: #f0fdfa; border-radius: 10px; font-size: 26px; font-weight: 800; color: #00897B;">
        Match score: ${best.score}/100
      </div>
      <div style="color: #444; font-size: 14px; line-height: 1.6;">${best.rationale}</div>
      <div style="margin-top: 12px; font-size: 13px; color: #888;">Best fit for: <b>${best.best_problem}</b></div>
    </div>
    <p style="color: #aaa; font-size: 12px; margin-top: 24px;">Sent by the Bazinga Project Match Agent.</p>
  </div>
`;

// ---------- login screen ----------

const Login = ({ onLogin }: { onLogin: () => void }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      localStorage.setItem(SESSION_KEY, '1');
      onLogin();
    } else {
      setError('Invalid credentials');
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-4">
      <div className="w-full max-w-sm card">
        <div className="mb-6 text-center">
          <div className="h-12 w-12 rounded-xl bg-teal-500/20 flex items-center justify-center mx-auto mb-3 text-2xl">🧠</div>
          <h1 className="text-xl font-bold">Project Match Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">Admin access only</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Username</label>
            <input className="input" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn-primary w-full" type="submit">Sign in</button>
          <p className="text-[11px] text-slate-500 text-center">
            Default: {ADMIN_USERNAME} / {ADMIN_PASSWORD} — override via VITE_ADMIN_USERNAME / VITE_ADMIN_PASSWORD
          </p>
        </form>
      </div>
    </div>
  );
};

// ---------- dashboard ----------

const Dashboard = ({ onLogout }: { onLogout: () => void }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [results, setResults] = useState<ScoreResult[] | null>(null);
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const fetchProjects = useCallback(async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('id, title, description, tech_stack, github_url, demo_url, submitter:profiles!projects_submitted_by_fkey(full_name, department)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      setNotice(`Could not load projects: ${error.message}`);
    } else {
      const rows = (data || []) as any[];
      setProjects(rows.map(r => ({
        ...r,
        submitter: Array.isArray(r.submitter) ? (r.submitter[0] ?? null) : (r.submitter ?? null),
      })));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const saveKey = () => {
    if (apiKey.trim()) {
      localStorage.setItem('gemini_api_key', apiKey.trim());
      setNotice('Gemini key saved locally.');
    }
  };

  const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPdfFile(file && file.type === 'application/pdf' ? file : null);
  };

  const runAgent = async () => {
    if (!apiKey.trim()) return setNotice('Paste your Gemini API key first.');
    if (!pdfFile) return setNotice('Upload the problem statements PDF first.');
    if (!projects.length) return setNotice('No projects found in the database yet.');
    if (pdfFile.size > 25 * 1024 * 1024) return setNotice('PDF must be under 25MB.');

    setIsAnalyzing(true);
    setResults(null);
    setNotice('');
    try {
      const base64 = await readAsBase64(pdfFile);
      const prompt = `You are a tech-hiring match agent. Below is a PDF of problem statements, and a JSON list of student projects submitted on a campus platform.

For EVERY project, score how useful its developers are to solving the problem statements, on a scale 0-100. Be strict: relevant tech stack, scope, and completeness matter. Return ONLY valid JSON — an array of objects with exactly these fields:
- project_id: string
- title: string
- submitter: string
- score: number (0-100)
- rationale: string (2-3 sentences, specific)
- best_problem: string (the problem statement this project fits best)

Order the array from highest score to lowest.

PROJECTS JSON:
${JSON.stringify(projects.map(p => ({
  id: p.id,
  title: p.title,
  description: p.description,
  tech_stack: p.tech_stack,
  github_url: p.github_url,
  demo_url: p.demo_url,
  submitter: p.submitter?.full_name || 'Anonymous',
  department: p.submitter?.department,
})))}`;

      const genAI = new GoogleGenerativeAI(apiKey.trim());
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
      const result = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'application/pdf', data: base64 } },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json' },
      });

      const parsed = JSON.parse(result.response.text()) as ScoreResult[];
      const ranked = parsed.filter(r => r && typeof r.score === 'number').sort((a, b) => b.score - a.score);
      if (!ranked.length) throw new Error('Empty response from model');
      setResults(ranked);
      setNotice(`${ranked.length} projects scored.`);
    } catch (err) {
      console.error('Agent error:', err);
      setNotice('Agent failed — check the Gemini key and PDF, then retry.');
    }
    setIsAnalyzing(false);
  };

  const sendToEmail = async () => {
    if (!results?.length) return;
    const best = results[0];
    setIsSending(true);
    const subject = `Best Developer Match: ${best.title} (score ${best.score}/100)`;
    const html = buildEmailHtml(best, results.length);

    try {
      const res = await fetch(`${FUNCTIONS_URL}/send-project-recommendation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ANON_KEY}`,
          apikey: ANON_KEY,
        },
        body: JSON.stringify({ to: EMAIL_TO, subject, html }),
      });
      if (!res.ok) throw new Error((await res.text()) || 'edge function error');
      setNotice(`Email sent to ${EMAIL_TO}.`);
    } catch (err) {
      console.error('Edge function failed, mailto fallback:', err);
      const plain = `Best Developer Match\n\nProject: ${best.title}\nBy: ${best.submitter}\nMatch score: ${best.score}/100\nBest fit for: ${best.best_problem}\n\n${best.rationale}\n\nRanked from ${results.length} submitted projects by the Project Match Agent.`;
      window.location.href = `mailto:${EMAIL_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plain)}`;
      setNotice('Edge function not deployed — opened your email app instead.');
    }
    setIsSending(false);
  };

  const best = results?.[0];
  const rankColors = ['bg-amber-400 text-amber-950', 'bg-slate-300 text-slate-800', 'bg-orange-400 text-orange-950'];

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span>🧠</span> Project Match Dashboard
          </h1>
          <p className="text-sm text-slate-400">Score submitted projects against a problem-statement PDF and email the best developer.</p>
        </div>
        <button className="btn-outline" onClick={onLogout}>Log out</button>
      </header>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <label className="label">Gemini API Key</label>
          <div className="flex gap-2">
            <input className="input" type="password" placeholder="Paste your Gemini key" value={apiKey} onChange={e => setApiKey(e.target.value)} />
            <button className="btn-outline shrink-0" onClick={saveKey}>Save</button>
          </div>
          <label className="label pt-2">Problem Statements PDF</label>
          <label className="block cursor-pointer border-2 border-dashed border-teal-500/30 rounded-xl p-6 text-center hover:border-teal-400 transition-colors">
            <input type="file" accept="application/pdf" className="hidden" onChange={handlePdfChange} />
            <div className="text-2xl mb-1">📄</div>
            <p className="text-sm font-medium">{pdfFile ? pdfFile.name : 'Click to upload PDF'}</p>
            <p className="text-xs text-slate-500 mt-1">{isLoading ? 'Loading projects...' : `${projects.length} project(s) ready to score`}</p>
          </label>
          <button className="btn-primary w-full" onClick={runAgent} disabled={isAnalyzing || !pdfFile}>
            {isAnalyzing ? 'Agent is scoring...' : '✨ Run AI Match'}
          </button>
          {notice && <p className="text-xs text-slate-400">{notice}</p>}
        </div>

        {best && (
          <div className="card border-amber-400/40 bg-gradient-to-br from-amber-400/10 via-slate-900 to-teal-500/10 flex flex-col">
            <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">🏆 Best Developer Match</span>
            <h2 className="text-xl font-bold mt-2">{best.title}</h2>
            <p className="text-sm text-slate-400">by {best.submitter}</p>
            <div className="my-3 text-4xl font-extrabold text-teal-300">{best.score}<span className="text-lg text-slate-400">/100</span></div>
            <p className="text-sm text-slate-300 flex-1">{best.rationale}</p>
            <p className="text-xs text-slate-500 mt-3">Best fit for: <span className="text-slate-300">{best.best_problem}</span></p>
            <button className="btn-primary w-full mt-4" onClick={sendToEmail} disabled={isSending}>
              {isSending ? 'Sending...' : `✉️ Send to ${EMAIL_TO}`}
            </button>
          </div>
        )}
      </div>

      {results && results.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Ranked Projects</h2>
          {results.map((r, i) => (
            <div key={r.project_id} className="card flex items-start gap-4">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${rankColors[i] ?? 'bg-teal-500/20 text-teal-300'}`}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{r.title}</h3>
                  <span className="font-extrabold text-teal-300">{r.score}</span>
                </div>
                <p className="text-xs text-slate-500">by {r.submitter}</p>
                <div className="h-1.5 rounded-full bg-slate-800 mt-2 overflow-hidden">
                  <div className="h-full bg-teal-400 rounded-full" style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }} />
                </div>
                <p className="text-sm text-slate-400 mt-2">{r.rationale}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------- app shell ----------

const App = () => {
  const [authed, setAuthed] = useState(() => localStorage.getItem(SESSION_KEY) === '1');
  return authed
    ? <Dashboard onLogout={() => { localStorage.removeItem(SESSION_KEY); setAuthed(false); }} />
    : <Login onLogin={() => setAuthed(true)} />;
};

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default App;
