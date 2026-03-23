import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Code, Zap, Globe, Download, ArrowRight, ChevronDown,
  Star, Shield, Cpu, Terminal, RefreshCw, Copy, Check,
  Loader2, Key, Eye, EyeOff, X,
} from "lucide-react";
import { claudeConvertCode, claudeDetectAndConvertCode, getActiveProvider, getProviderMeta, getProviders, setActiveProvider, setApiKey, hasApiKey, requiresApiKey, ApiKeyError, ClaudeApiError } from "./claude.js";

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS — defined outside components (never re-allocated on render)
// ═══════════════════════════════════════════════════════════════════════════════

const BASE_LANGUAGES = [
  'Ada','Apex','Assembly','AWK','Ballerina','Bash','BASIC','Boo',
  'C','C#','C++','Carbon','Chapel','Clojure','COBOL','Crystal','CSS','CUDA',
  'D','Dart','Delphi','Eiffel','Elixir','Elm','Erlang',
  'F#','Factor','Fantom','Fortran','FoxPro',
  'Go','Groovy','Hack','Haskell','Haxe','HTML',
  'Idris','Io','J','Java','JavaScript','Julia',
  'Kotlin','KRL','LabVIEW','Lisp','Logo','Lua',
  'MATLAB','Modula-2','Monkey C','Nim',
  'Objective-C','OCaml','Odin',
  'Pascal','Perl','PHP','Pike','Pony','PowerShell','Prolog','PureScript','Python',
  'PyTorch','Q#','R','Racket','ReasonML','Red','Rebol','Ring','Ruby','Rust',
  'Scala','Scheme','Scratch','Seed7','Smalltalk','SML','Solidity','SQL','Squirrel','Swift',
  'Tcl','TensorFlow','TypeScript',
  'V','Vala','VB.NET','Verilog','VHDL','Visual Basic',
  'Wolfram','Xtend','Zig','.ore',
].sort((a, b) => a.localeCompare(b));

const EXT_MAP = {
  JavaScript:'js', TypeScript:'ts', Python:'py',   Rust:'rs',    Go:'go',
  Java:'java',     'C++':'cpp',    'C#':'cs',       C:'c',        Kotlin:'kt',
  Swift:'swift',   Ruby:'rb',      PHP:'php',       Lua:'lua',    Bash:'sh',
  HTML:'html',     CSS:'css',      SQL:'sql',       Dart:'dart',  Scala:'scala',
  Perl:'pl',       Haskell:'hs',   Elixir:'ex',     Clojure:'clj','F#':'fs',
  Zig:'zig',       Nim:'nim',      Crystal:'cr',    R:'r',        OCaml:'ml',
  Haxe:'hx',       Erlang:'erl',   Elm:'elm',       PowerShell:'ps1',
  'Visual Basic':'vb','VB.NET':'vb',Verilog:'v',    VHDL:'vhd',
  Prolog:'pl',     Fortran:'f90',  COBOL:'cbl',     Assembly:'asm','.ore':'ore',
};

const TICKER_ITEMS = [...BASE_LANGUAGES, ...BASE_LANGUAGES, ...BASE_LANGUAGES];
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace';
const LINE_H = 20; // px — must match textarea lineHeight

const EXAMPLE_SRC =
`# Example Python code
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))`;

// ═══════════════════════════════════════════════════════════════════════════════
// SYNTAX HIGHLIGHT
// Uses U+0002 (STX) as a marker — immune to every syntax rule's regex.
// ═══════════════════════════════════════════════════════════════════════════════
const MARK = '\u0002';

function highlight(code) {
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const spans = [];
  const rules = [
    { re: /(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/)/g,  color: '#6a9955' },
    { re: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g,   color: '#ce9178' },
    { re: /\b(abstract|and|as|async|await|break|case|catch|class|const|continue|def|delete|do|else|end|enum|extends|false|final|finally|for|from|fun|func|fn|if|implements|import|in|instanceof|interface|is|lambda|let|match|module|mut|namespace|new|None|not|null|or|override|package|print|println|pub|return|self|static|struct|super|switch|then|throw|throws|true|try|type|typeof|unless|until|use|var|void|when|where|while|with|yield)\b/g, color: '#569cd6' },
    { re: /\b([A-Z][a-zA-Z0-9_]*)\b/g,      color: '#4ec9b0' },
    { re: /\b(\w+)(?=\s*\()/g,              color: '#dcdcaa' },
    { re: /\b(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, color: '#b5cea8' },
  ];
  let result = esc(code);
  rules.forEach(({ re, color }) => {
    result = result.replace(re, match => {
      if (match.includes(MARK)) return match;
      spans.push(`<span style="color:${color}">${match}</span>`);
      return MARK;
    });
  });
  let i = 0;
  return result.replace(/\u0002/g, () => spans[i++] ?? '');
}

// ═══════════════════════════════════════════════════════════════════════════════
// API KEY MODAL — shown on first launch if no key is configured
// ═══════════════════════════════════════════════════════════════════════════════
function ApiKeyModal({ provider, onProviderChange, onSave }) {
  const providerMeta = useMemo(() => getProviderMeta(provider), [provider]);
  const [key, setKey]     = useState('');
  const [show, setShow]   = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setKey('');
    setError('');
    setShow(false);
  }, [provider]);

  const handleSave = () => {
    const trimmed = key.trim();
    if (!trimmed.startsWith(providerMeta.keyPrefix)) {
      setError(`Key should start with "${providerMeta.keyPrefix}".`);
      return;
    }
    setApiKey(trimmed, provider);
    onSave();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.97)' }}>
      <div className="w-full max-w-md rounded-2xl border flex flex-col gap-0 overflow-hidden"
        style={{ background: '#0a0a0a', borderColor: '#333' }}>

        {/* Header */}
        <div className="px-6 py-5 flex items-center gap-3"
          style={{ borderBottom: '1px solid #1a1a1a' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: '#fff' }}>
            <Key className="w-4 h-4" style={{ color: '#000' }} />
          </div>
          <div>
            <h2 className="font-bold text-base" style={{ color: '#fff' }}>Enter API Key</h2>
            <p className="text-xs" style={{ color: '#666' }}>Required to run code conversions</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4">
          <p className="text-sm leading-relaxed" style={{ color: '#888' }}>
            CodeVerse can use Anthropic, Gemini, or OpenRouter free models. Keys stay only
            in this browser tab and are cleared when the tab closes.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: '#aaa' }}>
              API Provider
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {getProviders().map(option => (
                <button key={option.id} type="button" onClick={() => onProviderChange(option.id)}
                  className="px-3 py-2 rounded-lg border text-sm text-left"
                  style={{
                    background: provider === option.id ? '#fff' : '#000',
                    color: provider === option.id ? '#000' : '#ccc',
                    borderColor: provider === option.id ? '#fff' : '#333',
                  }}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: '#aaa' }}>
              {providerMeta.label} API Key
            </label>
            <div className="flex items-center rounded-lg overflow-hidden border"
              style={{ background: '#000', borderColor: error ? '#ff6b6b' : '#333' }}>
              <input
                type={show ? 'text' : 'password'}
                value={key}
                onChange={e => { setKey(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                placeholder={providerMeta.keyPlaceholder}
                autoFocus
                className="flex-1 px-4 py-2.5 bg-transparent text-sm outline-none font-mono"
                style={{ color: '#fff' }}
              />
              <button onClick={() => setShow(s => !s)}
                className="px-3 flex-shrink-0" style={{ color: '#555' }}>
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {error && <p className="text-xs" style={{ color: '#ff6b6b' }}>{error}</p>}
          </div>

          <a href={providerMeta.helpUrl} target="_blank" rel="noreferrer"
            className="text-xs inline-flex items-center gap-1"
            style={{ color: '#555' }}>
            {providerMeta.helpLabel} →
          </a>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex gap-2 justify-end"
          style={{ borderTop: '1px solid #1a1a1a' }}>
          <button onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium"
            style={{ background: key.trim() ? '#fff' : '#222', color: key.trim() ? '#000' : '#555',
              cursor: key.trim() ? 'pointer' : 'not-allowed' }}>
            <Key className="w-3.5 h-3.5" /> Save Key &amp; Launch
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TICKER — frame-rate independent via delta-time normalisation
// ═══════════════════════════════════════════════════════════════════════════════
function Ticker() {
  const trackRef = useRef(null);
  const posRef   = useRef(0);
  const velRef   = useRef(-1.5);
  const dragging = useRef(false);
  const lastX    = useRef(0);
  const raf      = useRef(null);
  const lastTime = useRef(null);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const half = el.scrollWidth / 3;

    const tick = ts => {
      const dt = lastTime.current
        ? Math.min((ts - lastTime.current) / 16.667, 3)
        : 1;
      lastTime.current = ts;

      if (!dragging.current) {
        velRef.current *= Math.pow(0.98, dt);
        if (Math.abs(velRef.current) < 0.8)
          velRef.current = velRef.current < 0 ? -1.5 : 1.5;
        posRef.current += velRef.current * dt;
      }
      if (posRef.current <= -half) posRef.current += half;
      if (posRef.current >=  half) posRef.current -= half;
      el.style.transform = `translateX(${posRef.current}px)`;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 select-none"
      style={{ background: '#000', borderTop: '1px solid #222', cursor: 'grab' }}>
      <div className="px-3 pt-1.5 pb-0.5">
        <span className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: '#555' }}>Supported Languages</span>
      </div>
      <div className="overflow-hidden py-2"
        onPointerDown={e => {
          dragging.current = true; lastX.current = e.clientX;
          trackRef.current?.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={e => {
          if (!dragging.current) return;
          const dx = e.clientX - lastX.current;
          velRef.current = dx; posRef.current += dx; lastX.current = e.clientX;
        }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerLeave={() => { dragging.current = false; }}>
        <div ref={trackRef} className="flex gap-3 whitespace-nowrap will-change-transform">
          {TICKER_ITEMS.map((l, i) => (
            <span key={i}
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0 border"
              style={{ background: '#111', color: '#fff', borderColor: '#333' }}>{l}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LANGUAGE DROPDOWN — memoised filter, optional Auto-Detect entry
// ═══════════════════════════════════════════════════════════════════════════════
function LangDropdown({ value, onChange, includeAutoDetect = false }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  const allLangs = useMemo(
    () => includeAutoDetect ? ['Auto-Detect', ...BASE_LANGUAGES] : BASE_LANGUAGES,
    [includeAutoDetect]
  );
  const filtered = useMemo(
    () => allLangs.filter(l => l.toLowerCase().includes(search.toLowerCase())),
    [allLangs, search]
  );

  useEffect(() => {
    const h = e => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false); setSearch('');
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div className="relative flex-1 min-w-0" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border"
        style={{ background: '#111', borderColor: open ? '#fff' : '#333', color: '#fff' }}>
        <span className="text-sm truncate">
          {value === 'Auto-Detect' ? '✦ Auto-Detect' : value}
        </span>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: '#888' }} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-lg shadow-xl z-50 border overflow-hidden"
          style={{ background: '#111', borderColor: '#333' }}>
          <div className="p-2" style={{ borderBottom: '1px solid #222' }}>
            <input autoFocus type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full px-3 py-1.5 rounded text-sm outline-none border"
              style={{ background: '#000', color: '#fff', borderColor: '#333' }} />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length
              ? filtered.map(l => (
                <button key={l}
                  onClick={() => { onChange(l); setOpen(false); setSearch(''); }}
                  className="w-full text-left px-3 py-2 text-sm"
                  style={{ background: value === l ? '#fff' : 'transparent',
                    color: value === l ? '#000' : '#ccc' }}
                  onMouseEnter={e => { if (value !== l) e.currentTarget.style.background = '#1a1a1a'; }}
                  onMouseLeave={e => { if (value !== l) e.currentTarget.style.background = 'transparent'; }}>
                  {l === 'Auto-Detect' ? '✦ Auto-Detect' : l}
                </button>
              ))
              : <p className="px-3 py-2 text-sm" style={{ color: '#555' }}>No results</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CODE PANEL — line numbers + stats bar, editable or read-only
// ═══════════════════════════════════════════════════════════════════════════════
function CodePanel({ value = '', onChange, readOnly = false, placeholder, loading = false }) {
  const taRef = useRef(null);
  const lnRef = useRef(null);

  const lineCount = useMemo(() => value.split('\n').length, [value]);
  const chars     = value.length;
  const words     = useMemo(() => {
    const t = value.trim(); return t ? t.split(/\s+/).length : 0;
  }, [value]);

  const syncScroll = () => {
    if (lnRef.current && taRef.current)
      lnRef.current.scrollTop = taRef.current.scrollTop;
  };

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      <div className="flex flex-1 min-h-0 relative overflow-hidden">
        {/* Line number gutter */}
        <div ref={lnRef}
          className="overflow-hidden select-none flex-shrink-0"
          style={{
            width: '2.75rem', paddingTop: '1rem', paddingRight: '0.45rem',
            textAlign: 'right', background: '#050505',
            borderRight: '1px solid #181818',
            color: '#3a3a3a', fontSize: '11px',
            lineHeight: `${LINE_H}px`, fontFamily: MONO,
          }}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} style={{ height: LINE_H }}>{i + 1}</div>
          ))}
        </div>
        {/* Editor */}
        <textarea ref={taRef} value={value} onChange={onChange}
          readOnly={readOnly} spellCheck={false} wrap="off"
          onScroll={syncScroll} placeholder={placeholder}
          style={{
            flex: 1, background: '#000', color: '#fff',
            fontSize: '12px', lineHeight: `${LINE_H}px`,
            padding: '1rem', resize: 'none', outline: 'none',
            fontFamily: MONO, minWidth: 0, height: '100%',
          }} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.75)' }}>
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: '#fff' }} />
          </div>
        )}
      </div>
      {/* Stats bar */}
      <div className="flex gap-4 px-3 py-1.5 text-xs select-none flex-shrink-0"
        style={{ background: '#050505', borderTop: '1px solid #181818', color: '#3a3a3a' }}>
        <span>{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>
        <span>{chars.toLocaleString()} chars</span>
        <span>{words.toLocaleString()} words</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERTER PAGE
// ═══════════════════════════════════════════════════════════════════════════════
function ConverterPage({ provider, onProviderChange, onHome, onKeyRequired }) {
  const [src,          setSrc]          = useState(EXAMPLE_SRC);
  const [out,          setOut]          = useState('');
  const [srcLang,      setSrcLang]      = useState('Python');
  const [tgtLang,      setTgtLang]      = useState('JavaScript');
  const [detectedLang, setDetectedLang] = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [copied,       setCopied]       = useState(false);
  const [filename,     setFilename]     = useState('converted');
  const [downloaded,   setDownloaded]   = useState(false);
  const [showSave,     setShowSave]     = useState(false);
  const [tab,          setTab]          = useState('paste');
  const [ghUrl,        setGhUrl]        = useState('');
  const [ghLoading,    setGhLoading]    = useState(false);
  const [ghError,      setGhError]      = useState('');
  const [showHelp,     setShowHelp]     = useState(false);
  const fileRef = useRef(null);
  const providerMeta = useMemo(() => getProviderMeta(provider), [provider]);

  // ── File upload ─────────────────────────────────────────────────────────────
  const handleFile = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setSrc(ev.target.result); setTab('paste'); };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── GitHub load (direct fetch — no API call) ─────────────────────────────
  const loadGhFile = async () => {
    setGhError('');
    const url = ghUrl.trim();
    if (!url.includes('github.com')) {
      setGhError('Please paste a valid GitHub file URL.'); return;
    }
    const rawUrl = url
      .replace('https://github.com/', 'https://raw.githubusercontent.com/')
      .replace('/blob/', '/');
    setGhLoading(true);
    try {
      const res = await fetch(rawUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error('Empty file');
      setSrc(text); setTab('paste'); setGhUrl('');
    } catch {
      setGhError('Could not load file. Make sure it is a public GitHub file URL.');
    } finally { setGhLoading(false); }
  };

  // ── Convert ──────────────────────────────────────────────────────────────
  const convert = async () => {
    if (!src.trim()) { setError('Please enter some code to convert.'); return; }
    if (!hasApiKey(provider)) { onKeyRequired(); return; }
    setLoading(true); setError(''); setOut(''); setDetectedLang('');
    try {
      if (srcLang === 'Auto-Detect') {
        const parsed = await claudeDetectAndConvertCode({
          sourceCode: src,
          targetLanguage: tgtLang,
          providerId: provider,
        });
        setOut(parsed.code);
        if (parsed.detectedLanguage) setDetectedLang(parsed.detectedLanguage);
      } else {
        const result = await claudeConvertCode({
          sourceCode: src,
          sourceLanguage: srcLang,
          targetLanguage: tgtLang,
          providerId: provider,
        });
        setOut(result);
      }
    } catch (err) {
      if (err.name === 'ApiKeyError') {
        setError('Invalid or missing API key.'); onKeyRequired();
      } else if (err instanceof ClaudeApiError) {
        setError(err.message);
      } else {
        setError('Conversion failed. Please try again.');
      }
    } finally { setLoading(false); }
  };

  // ── Swap ─────────────────────────────────────────────────────────────────
  const handleSwap = () => {
    const effectiveSrc = (srcLang === 'Auto-Detect' && detectedLang) ? detectedLang : srcLang;
    setSrcLang(tgtLang);
    setTgtLang(effectiveSrc === 'Auto-Detect' ? tgtLang : effectiveSrc);
    if (out.trim()) { setSrc(out); setOut(''); setDetectedLang(''); }
  };

  const copy = () => {
    if (!out) return;
    navigator.clipboard.writeText(out);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    if (!out) return;
    const ext  = EXT_MAP[tgtLang] || 'txt';
    const name = (filename.trim() || 'converted').replace(/\.[^.]+$/, '');
    try {
      const blob = new Blob([out], { type: 'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), {
        href: url, download: `${name}.${ext}`, style: 'display:none',
      });
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      setDownloaded(true); setTimeout(() => setDownloaded(false), 2000);
    } catch { setShowSave(true); }
  };

  const handleClear = () => {
    setSrc(''); setOut(''); setError(''); setGhUrl('');
    setFilename('converted'); setTab('paste'); setDetectedLang('');
  };

  return (
    <div className="min-h-screen flex flex-col pb-20" style={{ background: '#000', color: '#fff' }}>
      {/* Topbar */}
      <div className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: '1px solid #222' }}>
        <button onClick={onHome}
          className="text-xs px-3 py-1.5 rounded-lg border"
          style={{ borderColor: '#333', color: '#aaa', background: '#111' }}>← Home</button>
        <Code className="w-5 h-5" style={{ color: '#fff' }} />
        <h1 className="text-lg font-bold flex-1">CodeVerse</h1>
        <div className="hidden md:flex items-center gap-2 rounded-lg border px-3 py-1.5" style={{ borderColor: '#333', background: '#111', color: '#aaa' }}>
          <span className="text-xs">Provider</span>
          <select value={provider} onChange={e => onProviderChange(e.target.value)} className="bg-transparent text-xs outline-none" style={{ color: '#fff' }}>
            {getProviders().map(option => <option key={option.id} value={option.id} style={{ color: '#000' }}>{option.label}</option>)}
          </select>
        </div>
        {requiresApiKey(provider) && (
          <button onClick={() => onKeyRequired()}
            className="text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1"
            style={{ borderColor: '#333', color: '#888', background: '#111' }}
            title="Change API key">
            <Key className="w-3 h-3" /> Key
          </button>
        )}
        <button onClick={() => setShowHelp(true)}
          className="text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1"
          style={{ borderColor: '#333', color: '#fff', background: '#111' }}>❓ Help</button>
        <button onClick={handleClear}
          className="text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1"
          style={{ borderColor: '#333', color: '#ff6b6b', background: '#111' }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#ff6b6b'}
          onMouseLeave={e => e.currentTarget.style.borderColor = '#333'}>🗑 Clear</button>
      </div>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      <div className="flex-1 p-3 sm:p-5">
        <div className="max-w-6xl mx-auto flex flex-col gap-4">

          {/* Language selector */}
          <div className="flex items-center gap-2">
            <LangDropdown value={srcLang}
              onChange={v => { setSrcLang(v); setDetectedLang(''); }}
              includeAutoDetect />
            <button onClick={handleSwap}
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border"
              style={{ background: '#111', borderColor: '#333', color: '#fff', fontSize: '16px' }}
              title="Swap languages"
              onMouseEnter={e => e.currentTarget.style.borderColor = '#fff'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#333'}>⇄</button>
            <LangDropdown value={tgtLang} onChange={setTgtLang} />
          </div>

          {/* Auto-detect badge */}
          {detectedLang && (
            <div>
              <span className="text-xs px-2.5 py-1 rounded-full border"
                style={{ background: '#111', borderColor: '#2a2a2a', color: '#aaa' }}>
                ✦ Detected: <span style={{ color: '#fff' }}>{detectedLang}</span>
              </span>
            </div>
          )}

          {/* Convert button */}
          <button onClick={convert} disabled={loading}
            className="w-full sm:w-auto sm:self-center flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-medium text-sm"
            style={{
              background: loading ? '#222' : '#fff',
              color: loading ? '#555' : '#000',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}>
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" />Converting…</>
              : <><Code className="w-4 h-4" />Convert Code</>}
          </button>

          <div className="flex flex-wrap items-center justify-center gap-2 text-xs" style={{ color: '#777' }}>
            <span className="px-2.5 py-1 rounded-full border" style={{ borderColor: '#222', background: '#0a0a0a' }}>
              Provider: <span style={{ color: '#fff' }}>{providerMeta.label}</span>
            </span>
            <span className="px-2.5 py-1 rounded-full border" style={{ borderColor: '#222', background: '#0a0a0a' }}>
              Model: <span style={{ color: '#fff' }}>{providerMeta.model}</span>
            </span>
          </div>

          {error && (
            <div className="px-4 py-2 rounded-lg text-sm text-center border"
              style={{ borderColor: '#444', color: '#ff6b6b' }}>{error}</div>
          )}

          {/* Panels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* ── Source ── */}
            <div className="rounded-lg overflow-hidden flex flex-col border"
              style={{ borderColor: '#222', minHeight: '22rem' }}>
              <div className="flex items-center"
                style={{ background: '#111', borderBottom: '1px solid #222' }}>
                {[['paste', '✏️ Paste'], ['file', '↑ File'], ['github', '🐙 GitHub']].map(([key, label]) => (
                  <button key={key} onClick={() => setTab(key)}
                    className="px-4 py-2 text-xs font-medium"
                    style={{
                      color: tab === key ? '#fff' : '#666',
                      borderBottom: tab === key ? '2px solid #fff' : '2px solid transparent',
                      background: 'transparent',
                    }}>{label}</button>
                ))}
              </div>
              <input ref={fileRef} type="file" className="hidden"
                accept=".txt,.js,.ts,.py,.rs,.go,.java,.cpp,.c,.cs,.rb,.php,.lua,.sh,.html,.css,.sql,.dart,.scala,.hs,.ex,.clj,.zig,.swift,.kt,.fs,.nim,.asm,.ps1,.r,.pl,.ore,.jsx,.tsx,.vue"
                onChange={handleFile} />

              <div className="flex-1" style={{ minHeight: '18rem' }}>
                {tab === 'paste' && (
                  <CodePanel value={src} onChange={e => setSrc(e.target.value)}
                    placeholder="Paste your source code here…" />
                )}
                {tab === 'file' && (
                  <div className="flex flex-col items-center justify-center h-full gap-4"
                    style={{ background: '#000', minHeight: '18rem' }}>
                    <div className="text-4xl">📂</div>
                    <p className="text-sm" style={{ color: '#888' }}>Pick a code file from your device</p>
                    <button onClick={() => fileRef.current.click()}
                      className="px-5 py-2 rounded-lg text-sm font-medium"
                      style={{ background: '#fff', color: '#000' }}>Browse File</button>
                    {src && (
                      <p className="text-xs" style={{ color: '#555' }}>
                        ✓ File loaded — switch to Paste tab to preview
                      </p>
                    )}
                  </div>
                )}
                {tab === 'github' && (
                  <div className="flex flex-col h-full p-4 gap-4"
                    style={{ background: '#000', minHeight: '18rem' }}>
                    <div>
                      <p className="text-xs mb-1" style={{ color: '#888' }}>
                        Paste a direct link to a file on GitHub:
                      </p>
                      <p className="text-xs font-mono mb-3" style={{ color: '#555' }}>
                        https://github.com/user/repo/blob/main/index.js
                      </p>
                      <div className="flex gap-2">
                        <input type="text" value={ghUrl}
                          onChange={e => setGhUrl(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && loadGhFile()}
                          placeholder="https://github.com/user/repo/blob/main/file.py"
                          className="flex-1 px-3 py-2 rounded-lg text-xs outline-none border"
                          style={{ background: '#111', color: '#fff', borderColor: '#333' }} />
                        <button onClick={loadGhFile} disabled={ghLoading}
                          className="px-4 py-2 rounded-lg text-xs font-medium flex-shrink-0 flex items-center gap-1"
                          style={{
                            background: ghLoading ? '#222' : '#fff',
                            color: ghLoading ? '#555' : '#000',
                            cursor: ghLoading ? 'not-allowed' : 'pointer',
                          }}>
                          {ghLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Load'}
                        </button>
                      </div>
                      {ghError && <p className="mt-2 text-xs" style={{ color: '#ff6b6b' }}>{ghError}</p>}
                    </div>
                    <p className="text-xs text-center" style={{ color: '#444' }}>
                      Works with any public GitHub file.<br />
                      Content loads into Paste tab automatically.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Output ── */}
            <div className="rounded-lg overflow-hidden flex flex-col border"
              style={{ borderColor: '#222', minHeight: '22rem' }}>
              <div className="px-3 py-2 flex flex-col gap-2"
                style={{ background: '#111', borderBottom: '1px solid #222' }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: '#aaa' }}>
                    Output — {tgtLang}
                  </span>
                  <button onClick={copy} disabled={!out}
                    className="flex items-center gap-1 text-xs"
                    style={{ color: out ? '#fff' : '#444', cursor: out ? 'pointer' : 'not-allowed' }}>
                    {copied
                      ? <><Check className="w-3 h-3" />Copied!</>
                      : <><Copy className="w-3 h-3" />Copy</>}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center rounded-lg overflow-hidden border"
                    style={{ background: '#000', borderColor: '#333' }}>
                    <input type="text" value={filename}
                      onChange={e => setFilename(e.target.value)} placeholder="filename"
                      className="flex-1 px-3 py-1.5 bg-transparent text-xs outline-none min-w-0"
                      style={{ color: '#fff' }} />
                    <span className="px-2 text-xs border-l"
                      style={{ color: '#555', borderColor: '#333', background: '#111' }}>
                      .{EXT_MAP[tgtLang] || 'txt'}
                    </span>
                  </div>
                  <button onClick={download} disabled={!out}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 border"
                    style={{
                      background: out ? '#fff' : '#111',
                      color: out ? '#000' : '#444',
                      borderColor: out ? '#fff' : '#333',
                      cursor: out ? 'pointer' : 'not-allowed',
                    }}>
                    <Download className="w-3 h-3" />
                    {downloaded ? 'Done!' : 'Download'}
                  </button>
                </div>
              </div>
              <div className="flex-1" style={{ minHeight: '18rem' }}>
                <CodePanel value={out} readOnly loading={loading}
                  placeholder={loading ? 'Converting…' : 'Converted code will appear here…'} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <Ticker />

      {/* Save fallback modal */}
      {showSave && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div className="rounded-xl w-full max-w-lg border"
            style={{ background: '#0a0a0a', borderColor: '#333' }}>
            <div className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: '1px solid #222' }}>
              <span className="font-semibold text-sm">Save File</span>
              <button onClick={() => setShowSave(false)} style={{ color: '#888' }}>✕</button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <textarea readOnly value={out} onClick={e => e.target.select()}
                className="w-full h-48 p-3 font-mono text-xs rounded-lg border resize-none outline-none"
                style={{ background: '#000', color: '#fff', borderColor: '#333' }} />
              <div className="flex gap-2">
                <button onClick={() => { navigator.clipboard.writeText(out); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium"
                  style={{ background: '#fff', color: '#000' }}>
                  {copied
                    ? <><Check className="w-4 h-4" />Copied!</>
                    : <><Copy className="w-4 h-4" />Copy All</>}
                </button>
                <button onClick={() => setShowSave(false)}
                  className="px-4 py-2 rounded-lg text-sm border"
                  style={{ background: '#111', color: '#fff', borderColor: '#333' }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOME PAGE COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════
function TypeWriter({ words }) {
  const [idx,  setIdx]  = useState(0);
  const [text, setText] = useState('');
  const [del,  setDel]  = useState(false);
  useEffect(() => {
    const word = words[idx];
    if (!del && text === word) {
      const t = setTimeout(() => setDel(true), 1500); return () => clearTimeout(t);
    }
    if (del && text === '') {
      setDel(false); setIdx(i => (i + 1) % words.length); return;
    }
    const t = setTimeout(
      () => setText(del ? text.slice(0, -1) : word.slice(0, text.length + 1)),
      del ? 40 : 80
    );
    return () => clearTimeout(t);
  }, [text, del, idx, words]);
  return (
    <span style={{ color: '#fff', borderBottom: '2px solid #fff' }}>
      {text}<span className="animate-pulse">|</span>
    </span>
  );
}

function FeatureCard({ icon: Icon, title, desc }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div className="rounded-2xl p-6 border transition-all duration-200"
      style={{
        background: '#0a0a0a',
        borderColor: hovered ? '#fff' : '#222',
        transform: hovered ? 'translateY(-4px)' : 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
        style={{ background: '#fff' }}>
        <Icon className="w-5 h-5" style={{ color: '#000' }} />
      </div>
      <h3 className="font-semibold text-base mb-2" style={{ color: '#fff' }}>{title}</h3>
      <p className="text-sm leading-relaxed" style={{ color: '#888' }}>{desc}</p>
    </div>
  );
}

function CodeSnippet({ lang, code }) {
  return (
    <div className="rounded-xl overflow-hidden border text-xs font-mono"
      style={{ background: '#0d1117', borderColor: '#333' }}>
      <div className="px-3 py-1.5 flex items-center gap-2"
        style={{ background: '#161b22', borderBottom: '1px solid #333' }}>
        <Terminal className="w-3 h-3" style={{ color: '#58a6ff' }} />
        <span style={{ color: '#58a6ff' }}>{lang}</span>
      </div>
      <pre className="p-3 overflow-x-auto leading-relaxed"
        dangerouslySetInnerHTML={{ __html: highlight(code) }} />
    </div>
  );
}

function HomePage({ onLaunch }) {
  const features = [
    { icon: Zap,       title: 'Instant Conversion',  desc: 'Convert any code in seconds with high accuracy.' },
    { icon: Globe,     title: '100+ Languages',       desc: 'From Python to Zig, Assembly to .ore — the widest coverage available.' },
    { icon: Download,  title: 'Download Instantly',   desc: 'Save converted code with the correct file extension.' },
    { icon: Shield,    title: 'Bring Your Own API',  desc: 'Use Anthropic, Gemini, or OpenRouter free models with your own key.' },
    { icon: RefreshCw, title: 'Bidirectional',        desc: 'Convert in any direction — swap languages freely.' },
    { icon: Cpu,       title: 'Smart Conversion',     desc: 'Intelligent conversion that preserves logic and intent.' },
  ];

  return (
    <div className="min-h-screen flex flex-col pb-20" style={{ background: '#000', color: '#fff' }}>
      <nav className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid #222' }}>
        <div className="flex items-center gap-2">
          <Code className="w-6 h-6" style={{ color: '#fff' }} />
          <span className="font-bold text-lg">CodeVerse</span>
        </div>
        <div className="hidden sm:flex items-center gap-6 text-sm" style={{ color: '#888' }}>
          {['Features', 'Languages', 'Demo'].map(l => (
            <a key={l} href={`#${l.toLowerCase()}`} style={{ color: '#888' }}>{l}</a>
          ))}
        </div>
        <button onClick={onLaunch}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: '#fff', color: '#000' }}
          onMouseEnter={e => e.currentTarget.style.background = '#ddd'}
          onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
          Launch App <ArrowRight className="w-4 h-4" />
        </button>
      </nav>

      <section className="flex flex-col items-center justify-center text-center px-4 py-20">
        <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs mb-6 border"
          style={{ background: '#111', borderColor: '#333', color: '#aaa' }}>
          <Star className="w-3 h-3" /> 100+ Languages · Free · AI-powered
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold leading-tight mb-4 max-w-3xl">
          Convert Code to<br />
          <TypeWriter words={['JavaScript', 'Rust', 'Python', 'Go', 'Kotlin', 'Swift', 'C++', 'TypeScript']} />
        </h1>
        <p className="text-base sm:text-lg max-w-xl mb-8 leading-relaxed" style={{ color: '#888' }}>
          Instantly translate your code between 100+ programming languages — with a single click.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={onLaunch}
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm"
            style={{ background: '#fff', color: '#000' }}
            onMouseEnter={e => e.currentTarget.style.background = '#ddd'}
            onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
            Start Converting <ArrowRight className="w-4 h-4" />
          </button>
          <a href="#demo"
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm border"
            style={{ background: '#000', color: '#fff', borderColor: '#333' }}>
            See Demo <ChevronDown className="w-4 h-4" />
          </a>
        </div>
      </section>

      <section id="languages" className="py-6"
        style={{ borderTop: '1px solid #222', borderBottom: '1px solid #222', background: '#080808' }}>
        <p className="text-center text-xs uppercase tracking-widest mb-4" style={{ color: '#555' }}>
          Supported Languages
        </p>
        <div className="flex flex-wrap justify-center gap-2 px-6">
          {BASE_LANGUAGES.slice(0, 28).map(l => (
            <span key={l}
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border"
              style={{ background: '#111', color: '#fff', borderColor: '#333' }}>{l}</span>
          ))}
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border"
            style={{ background: '#111', color: '#666', borderColor: '#333' }}>
            +{BASE_LANGUAGES.length - 28} more
          </span>
        </div>
      </section>

      <section id="features" className="px-6 py-16 max-w-6xl mx-auto w-full">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-2">Everything you need</h2>
        <p className="text-sm text-center mb-10" style={{ color: '#888' }}>
          Built for developers who move fast.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(f => <FeatureCard key={f.title} {...f} />)}
        </div>
      </section>

      <section id="demo" className="px-6 py-16"
        style={{ background: '#080808', borderTop: '1px solid #222' }}>
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-2">See it in action</h2>
        <p className="text-sm text-center mb-10" style={{ color: '#888' }}>Same logic, different language.</p>
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row gap-4 items-center">
          <div className="flex-1 w-full">
            <CodeSnippet lang="Python"
              code={`def greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("World"))`} />
          </div>
          <div className="flex-shrink-0 flex items-center justify-center">
            <div className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold border"
              style={{ background: '#fff', color: '#000' }}>
              <Zap className="w-3 h-3" /> Convert
            </div>
          </div>
          <div className="flex-1 w-full">
            <CodeSnippet lang="Rust"
              code={`fn greet(name: &str) -> String {\n    format!("Hello, {}!", name)\n}\n\nfn main() {\n    println!("{}", greet("World"));\n}`} />
          </div>
        </div>
      </section>

      <section className="px-6 py-20 flex flex-col items-center text-center"
        style={{ borderTop: '1px solid #222' }}>
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">Ready to convert?</h2>
        <p className="text-sm mb-8 max-w-md" style={{ color: '#888' }}>
          Paste your code, pick your target language, and download in seconds.
        </p>
        <button onClick={onLaunch}
          className="flex items-center gap-2 px-8 py-3 rounded-xl font-semibold text-sm"
          style={{ background: '#fff', color: '#000' }}
          onMouseEnter={e => e.currentTarget.style.background = '#ddd'}
          onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
          Launch CodeVerse <ArrowRight className="w-4 h-4" />
        </button>
      </section>

      <footer className="px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs"
        style={{ borderTop: '1px solid #222', color: '#555' }}>
        <div className="flex items-center gap-2">
          <Code className="w-4 h-4" style={{ color: '#fff' }} />
          <span>CodeVerse</span>
        </div>
        <span>© {new Date().getFullYear()} CodeVerse. All rights reserved.</span>
      </footer>
      <Ticker />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELP MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function HelpModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('overview');
  const tabs = [
    { key: 'overview', label: '🏠 Overview' },
    { key: 'paste',    label: '✏️ Paste' },
    { key: 'file',     label: '📂 File Upload' },
    { key: 'github',   label: '🐙 GitHub' },
    { key: 'convert',  label: '⚡ Convert' },
    { key: 'download', label: '💾 Download' },
  ];
  const content = {
    overview: { title: 'What is CodeVerse?', steps: [
      { icon: '1️⃣', heading: 'Load your code',    desc: 'Paste code, upload a file, or load directly from a public GitHub URL.' },
      { icon: '2️⃣', heading: 'Pick languages',    desc: 'Select the source language (or use ✦ Auto-Detect) and your target.' },
      { icon: '3️⃣', heading: 'Convert',           desc: 'Choose your provider, then hit Convert Code — the AI translates and shows the result.' },
      { icon: '4️⃣', heading: 'Download or Copy', desc: 'Copy to clipboard or download with the correct file extension.' },
    ]},
    paste: { title: '✏️ How to use Paste', steps: [
      { icon: '📋', heading: 'Copy your code',        desc: 'Select all code in your editor and copy (Ctrl+C / Cmd+C).' },
      { icon: '🖱️', heading: 'Click the Paste tab',   desc: 'Paste tab is selected by default.' },
      { icon: '📝', heading: 'Paste into the editor', desc: 'Click the code area and paste. Line numbers update automatically.' },
      { icon: '✅', heading: 'Ready',                 desc: 'Select languages and hit Convert Code.' },
    ]},
    file: { title: '📂 How to use File Upload', steps: [
      { icon: '🗂️', heading: 'Click the File tab',  desc: 'Switch to the "↑ File" tab.' },
      { icon: '📁', heading: 'Browse File',          desc: 'Press Browse File — a file picker opens.' },
      { icon: '🔍', heading: 'Select your file',     desc: 'Pick any code file (.py, .js, .ts, .cpp, .rs, .java etc.).' },
      { icon: '✅', heading: 'Auto loads',           desc: 'Read entirely in-browser. No server upload. Switches to Paste tab.' },
    ]},
    github: { title: '🐙 How to use GitHub', steps: [
      { icon: '🔗', heading: 'Open file on GitHub',   desc: 'Navigate to a public repo and open the specific file.' },
      { icon: '📎', heading: 'Copy the URL',          desc: 'Copy the URL: github.com/user/repo/blob/main/file.py' },
      { icon: '📋', heading: 'Paste into GitHub tab', desc: 'Switch to 🐙 GitHub tab and paste the URL.' },
      { icon: '⬇️', heading: 'Click Load',            desc: 'Press Load (or Enter). Content loads into Paste tab.' },
      { icon: '⚠️', heading: 'Public repos only',     desc: 'Private repos require auth — not supported.' },
    ]},
    convert: { title: '⚡ How to Convert', steps: [
      { icon: '✦',  heading: 'Auto-Detect (optional)', desc: 'Select "✦ Auto-Detect" as source — language is identified automatically.' },
      { icon: '🎯', heading: 'Select target language', desc: 'Use the right dropdown to choose the output language.' },
      { icon: '🚀', heading: 'Hit Convert Code',       desc: 'The AI rewrites your code in the target language.' },
      { icon: '⏳', heading: 'Wait a moment',          desc: 'Conversion takes a few seconds. A spinner shows progress.' },
      { icon: '👁️', heading: 'Review result',          desc: 'Always review converted code before using in production.' },
    ]},
    download: { title: '💾 How to Download', steps: [
      { icon: '✏️', heading: 'Type a filename',         desc: 'Type your filename in the output panel (e.g. myApp, server).' },
      { icon: '🏷️', heading: 'Extension is automatic', desc: 'Correct extension added automatically — .js, .py, .rs, .cpp etc.' },
      { icon: '⬇️', heading: 'Click Download',          desc: 'Your browser saves the file directly to your device.' },
      { icon: '📋', heading: 'Or just Copy',            desc: 'Use the Copy button to copy output to clipboard.' },
    ]},
  };
  const current = content[activeTab];
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.9)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-2xl w-full max-w-lg max-h-screen overflow-hidden border flex flex-col"
        style={{ background: '#0a0a0a', borderColor: '#333' }}>
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid #222' }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">❓</span>
            <span className="font-bold text-base" style={{ color: '#fff' }}>Help & Guide</span>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm"
            style={{ background: '#222', color: '#aaa' }}>✕</button>
        </div>
        <div className="flex gap-2 px-4 py-3 overflow-x-auto"
          style={{ borderBottom: '1px solid #222' }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0"
              style={{
                background: activeTab === t.key ? '#fff' : '#1a1a1a',
                color: activeTab === t.key ? '#000' : '#888',
                border: '1px solid',
                borderColor: activeTab === t.key ? '#fff' : '#333',
              }}>{t.label}</button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <h2 className="text-base font-bold mb-4" style={{ color: '#fff' }}>{current.title}</h2>
          <div className="flex flex-col gap-4">
            {current.steps.map((s, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-xl"
                style={{ background: '#111', border: '1px solid #222' }}>
                <span className="text-xl flex-shrink-0 mt-0.5">{s.icon}</span>
                <div>
                  <p className="text-sm font-semibold mb-1" style={{ color: '#fff' }}>{s.heading}</p>
                  <p className="text-xs leading-relaxed" style={{ color: '#888' }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="px-5 py-3 flex justify-end" style={{ borderTop: '1px solid #222' }}>
          <button onClick={onClose}
            className="px-5 py-2 rounded-lg text-sm font-medium"
            style={{ background: '#fff', color: '#000' }}>Got it</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// APP ROOT — manages page routing + API key state
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [page, setPage] = useState('home');
  const [provider, setProvider] = useState(() => getActiveProvider());
  const [showKeyModal, setShowKeyModal] = useState(() => requiresApiKey(getActiveProvider()) && !hasApiKey(getActiveProvider()));

  const handleProviderChange = useCallback(nextProvider => {
    setProvider(nextProvider);
    setActiveProvider(nextProvider);
    setShowKeyModal(requiresApiKey(nextProvider) && !hasApiKey(nextProvider));
  }, []);

  const handleKeySaved = useCallback(() => setShowKeyModal(false), []);

  return (
    <>
      {showKeyModal && <ApiKeyModal provider={provider} onProviderChange={handleProviderChange} onSave={handleKeySaved} />}
      {page === 'home'
        ? <HomePage onLaunch={() => setPage('converter')} />
        : <ConverterPage
            provider={provider}
            onProviderChange={handleProviderChange}
            onHome={() => setPage('home')}
            onKeyRequired={() => setShowKeyModal(true)} />}
    </>
  );
}
