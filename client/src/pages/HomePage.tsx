import { useState } from 'react'
import { useLocation } from 'wouter'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTheme } from '@/components/ThemeProvider'
import { PerplexityAttribution } from '@/components/PerplexityAttribution'
import {
  Mic, Moon, Sun, Zap, MessageCircle, Briefcase,
  BookOpen, Swords, BookMarked, ChevronRight, Cpu,
  Shield, Wifi, Github
} from 'lucide-react'

// ── Data ──────────────────────────────────────────────────────────────────────

const PERSONALITIES = [
  { id: 'friendly',    name: 'Friendly Friend',   emoji: '😊', desc: 'Casual chat like a close friend' },
  { id: 'teacher',     name: 'English Teacher',   emoji: '📚', desc: 'Grammar tips + vocab corrections' },
  { id: 'debate',      name: 'Debate Partner',    emoji: '⚡', desc: 'Challenges your arguments' },
  { id: 'interviewer', name: 'Job Interviewer',   emoji: '💼', desc: 'Realistic HR practice' },
  { id: 'casual',      name: 'Casual Companion',  emoji: '🎮', desc: 'Movies, sports, pop culture' },
  { id: 'partner',     name: 'Romantic Partner',  emoji: '❤️', desc: 'Warm, caring & affectionate' },
]

const MODES = [
  { id: 'conversation', name: 'Free Conversation', icon: MessageCircle, desc: 'Talk freely on any topic' },
  { id: 'interview',    name: 'Interview Mode',    icon: Briefcase,     desc: 'Structured Q&A practice' },
  { id: 'daily',        name: 'Daily Situations',  icon: BookOpen,      desc: 'Real-life English scenarios' },
  { id: 'debate',       name: 'Debate Mode',       icon: Swords,        desc: 'Argue a position' },
  { id: 'story',        name: 'Story Building',    icon: BookMarked,    desc: 'Co-create a narrative' },
]

// ── Component ─────────────────────────────────────────────────────────────────

export function HomePage() {
  const [, navigate] = useLocation()
  const { theme, toggleTheme } = useTheme()
  const [personality, setPersonality] = useState('friendly')
  const [mode, setMode]               = useState('conversation')

  // Session is entirely client-side — encode in URL hash params
  const handleStart = () => {
    // Navigate to practice page with personality+mode as query string
    navigate(`/practice/${personality}/${mode}`)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* ── Nav (pill style matching runanywhere.ai) ── */}
      <header className="sticky top-0 z-50 flex justify-center pt-3 px-4">
        <nav className="ra-nav flex items-center gap-1 px-2 py-1.5 shadow-sm max-w-3xl w-full">
          <div className="flex items-center gap-2 px-2 py-1 flex-1">
            <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-label="SpeakAI">
              <rect width="32" height="32" rx="8" fill="#F97316"/>
              <rect x="11" y="7" width="10" height="12" rx="5" fill="white"/>
              <path d="M8 17c0 4.42 3.58 8 8 8s8-3.58 8-8" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
              <line x1="16" y1="25" x2="16" y2="28" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <line x1="13" y1="28" x2="19" y2="28" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="font-bold text-base tracking-tight text-foreground">SpeakAI</span>
            <Badge variant="secondary" className="text-[10px] ml-1 hidden sm:flex">
              Powered by RunAnywhere
            </Badge>
          </div>
          <div className="flex items-center gap-1 pr-1">
            <a
              href="https://github.com/RunanywhereAI/runanywhere-sdks"
              target="_blank" rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-full"
            >
              <Github className="w-3.5 h-3.5" /> SDK
            </a>
            <Button size="icon" variant="ghost" onClick={toggleTheme}
              className="rounded-full" data-testid="button-theme-toggle" aria-label="Toggle theme">
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>
        </nav>
      </header>

      {/* ── Hero ── */}
      <main className="flex-1 container max-w-3xl mx-auto px-4 pt-12 pb-8">

        {/* YC-style badge */}
        <div className="flex justify-center mb-6">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-md border border-dashed border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800 text-orange-600 dark:text-orange-400 text-xs font-medium">
            <Zap className="w-3 h-3" />
            Powered by RunAnywhere Web SDK · 100% On-Device
          </span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-center mb-4 leading-tight">
          <span className="ra-gradient-text">SpeakAI:</span>
          {' '}English Practice<br className="hidden sm:block" /> in Your Browser
        </h1>
        <p className="text-center text-muted-foreground text-base max-w-lg mx-auto mb-10">
          Voice-powered English conversations with a local AI. Speech recognition, LLM,
          and text-to-speech all run privately on your device via WebAssembly.
        </p>

        {/* Feature chips */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {[
            { icon: Shield,  text: 'Privacy-first' },
            { icon: Cpu,     text: 'On-device WASM' },
            { icon: Wifi,    text: 'Works offline' },
            { icon: Zap,     text: 'No API keys' },
          ].map(({ icon: Icon, text }) => (
            <span key={text} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs border border-border">
              <Icon className="w-3 h-3 text-primary" />
              {text}
            </span>
          ))}
        </div>

        {/* ── SDK Code block ── */}
        <div className="ra-code mb-10 text-[13px] hidden sm:block">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <span className="ml-2 text-xs text-white/40">speakai.ts — RunAnywhere Web SDK</span>
          </div>
          <pre className="whitespace-pre-wrap leading-relaxed">{`import { RunAnywhere } from '@runanywhere/web'
import { LlamaCPP, TextGeneration } from '@runanywhere/web-llamacpp'
import { ONNX, STT, TTS } from '@runanywhere/web-onnx'

await RunAnywhere.initialize({ environment: 'development' })
await LlamaCPP.register()  // llama.cpp → WASM
await ONNX.register()      // sherpa-onnx → WASM (STT + TTS)

// Full voice pipeline — STT → LLM → TTS, all on-device
const { stream } = await TextGeneration.generateStream(userSpeech, {
  systemPrompt: personality,  maxTokens: 200
})
for await (const token of stream) { updateUI(token) }`}</pre>
        </div>

        {/* ── Conversation Partner ── */}
        <section className="mb-8">
          <h2 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase mb-3">
            Conversation Partner
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PERSONALITIES.map(p => (
              <button
                key={p.id}
                data-testid={`button-personality-${p.id}`}
                onClick={() => setPersonality(p.id)}
                className={`relative flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all duration-150 ${
                  personality === p.id
                    ? 'border-primary bg-orange-50 dark:bg-orange-950/30 shadow-sm'
                    : 'border-border bg-card hover:border-primary/40 hover:bg-orange-50/50 dark:hover:bg-orange-950/10'
                }`}
              >
                {personality === p.id && (
                  <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-primary" />
                )}
                <span className="text-xl leading-none">{p.emoji}</span>
                <span className="font-semibold text-xs text-foreground">{p.name}</span>
                <span className="text-[10px] text-muted-foreground leading-tight">{p.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Practice Mode ── */}
        <section className="mb-10">
          <h2 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase mb-3">
            Practice Mode
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MODES.map(m => {
              const Icon = m.icon
              return (
                <button
                  key={m.id}
                  data-testid={`button-mode-${m.id}`}
                  onClick={() => setMode(m.id)}
                  className={`relative flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all duration-150 ${
                    mode === m.id
                      ? 'border-primary bg-orange-50 dark:bg-orange-950/30 shadow-sm'
                      : 'border-border bg-card hover:border-primary/40 hover:bg-orange-50/50 dark:hover:bg-orange-950/10'
                  }`}
                >
                  {mode === m.id && (
                    <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-primary" />
                  )}
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    mode === m.id ? 'bg-primary/15' : 'bg-secondary'
                  }`}>
                    <Icon className={`w-4 h-4 ${mode === m.id ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-foreground">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.desc}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── CTA ── */}
        <div className="flex flex-col items-center gap-3">
          <Button
            onClick={handleStart}
            data-testid="button-start-practicing"
            className="rounded-full px-10 py-6 text-base font-semibold bg-primary hover:bg-primary/90 text-white shadow-lg shadow-orange-500/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Mic className="w-5 h-5 mr-2" />
            Start Practicing
            <ChevronRight className="w-5 h-5 ml-1" />
          </Button>
          <p className="text-xs text-muted-foreground">
            Models download once, then run fully offline · Chrome / Edge recommended
          </p>
          <PerplexityAttribution />
        </div>
      </main>
    </div>
  )
}
