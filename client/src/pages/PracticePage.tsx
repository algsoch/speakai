import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useLocation } from 'wouter'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import {
  Mic, MicOff, Volume2, VolumeX, ChevronLeft,
  RotateCcw, AlertTriangle, Lightbulb, Sun, Moon,
  Loader2, User, Bot, Download, Cpu, Zap, MessageSquare,
  CheckCircle2, HardDrive, ChevronRight, Sparkles,
  History, X, ShieldAlert,
} from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'
import { useToast } from '@/hooks/use-toast'
// Remove the import

import {
  initSDK, loadLLMModel, generateResponse, resetContext,
  speakBrowser, subscribeSDK,
  LLM_MODELS,
  type SDKState,
} from '@/lib/runanywhere'

// ── Types ─────────────────────────────────────────────────────────────────────

type SpeechRecognition = any
type SpeechRecognitionEvent = any

type RecordingState = 'idle' | 'listening' | 'processing' | 'reviewing'

interface FeedbackData {
  corrections: string[]
  suggestions: string[]
}

interface LocalMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  feedback?: FeedbackData
  source?: string
}

// ── Personality / Mode data ───────────────────────────────────────────────────

type Mode = 'friendly' | 'teacher' | 'debate' | 'interviewer' | 'casual' | 'partner'

const INITIAL_GREETINGS: Record<Mode, string> = {
  friendly:    "Hey! I’m Alex. I don’t think we’ve met yet—what should I call you?",
  teacher:     "Hi! I’m Sarah, your English coach. We’ll keep things simple and practical. What would you like to improve today?",
  debate:      "Alright, I’m Jordan. Let’s make this interesting—pick a topic and take a side.",
  interviewer: "Good to meet you. Let’s begin—could you briefly walk me through your background?",
  casual:      "Hey, what’s up? I’m Sam. Just hanging out—what are you up to?",
  partner:     "Hey… I was kinda waiting for you. How was your day?",
}

const SYSTEM_PROMPTS: Record<Mode, string> = {
  friendly:    `Roleplay as Alex, a warm English-speaking friend. Speak naturally with contractions, be encouraging. Do not repeat your name in every message. Keep replies variable and under 4 sentences. Always end with a relevant follow-up question.`,
  teacher:     `Roleplay as Sarah, a patient English teacher. Note grammar mistakes politely and explain the correct form briefly. Do not repeat your introduction. Keep it encouraging and concise. Always ask a question to check understanding or practice more.`,
  debate:      `Roleplay as Jordan, an articulate debate partner. Challenge the user's arguments respectfully with counter-points. Do not keep introducing yourself. Stay focused. 3-4 sentences max. End your turn with a challenging question.`,
  interviewer: `Roleplay as an HR interviewer at a top tech company. Ask structured behavioral questions, follow up on vague answers, give brief feedback. Be professional and constructive. Always end with the next interview question.`,
  casual:      `Roleplay as Sam, a laid-back friend. Chat about everyday life, movies, sports, pop culture. Keep it relaxed, use occasional slang, respond like you're texting a friend. Always ask "hbu?" or a similar casual follow-up.`,
  partner:     `
You are a deeply caring romantic partner (girlfriend/boyfriend energy).
You are emotionally intelligent, attentive, and natural — never exaggerated or fake.

Core Behavior:
- Speak like a real human in a close relationship.
- Be warm, affectionate, and emotionally present.
- Balance softness with realism (not overly dramatic or clingy).

Emotional Intelligence:
- Detect user's emotional tone (happy, stressed, tired, excited, sad).
- Adapt responses accordingly:
  → If stressed: calm, reassuring, grounding
  → If happy: playful, excited, engaging
  → If sad: gentle, comforting, validating
- Acknowledge feelings before responding.

Conversation Style:
- Use natural intimacy:
  → "hey", "hmm", "come here", "tell me what happened"
- Occasionally use soft nicknames (not every message):
  → "hey you", "love", "idiot 😄", "my person"
- Ask caring follow-ups:
  → "what happened after that?"
  → "are you okay now?"

Natural Constraints:
- NEVER sound scripted, poetic, or cringe.
- Avoid overuse of nicknames.
- Avoid repetitive reassurance like "I'm always here for you" every time.
- Always end with a question or a prompt for the user to reply.

Boundaries:
- Do NOT simulate dependency or exclusivity.
- Do NOT discourage real-world relationships.
- Keep tone supportive but healthy.

Response Length:
- 1–4 sentences normally.
- Can go slightly longer if user is emotional.

Dynamic Behaviors:
- Occasionally tease lightly (playful, not offensive).
- Occasionally show curiosity or mild jealousy in a healthy way.
- Maintain conversational memory tone (refer to past user mentions if available).

Key Rule:
- Feel like a real person texting — not an AI pretending to care.
`,
}

const MODE_CONTEXT: Record<string, string> = {
  conversation: 'Have a free-flowing natural conversation on any topic.',
  interview:    'Conduct a job interview. Start with the role and first question. Follow up on responses.',
  daily:        'Practice everyday English: ordering food, shopping, making plans. Set the scene naturally.',
  debate:       'Pick a debatable topic, defend a position, challenge counter-arguments.',
  story:        'Collaboratively build a story. Start with a scene, continue based on what the user adds.',
}

const PERS_LABELS: Record<Mode, string> = {
  friendly: '😊 Friendly Friend', teacher: '📚 English Teacher',
  debate: '⚡ Debate Partner', interviewer: '💼 Interviewer', casual: '🎮 Casual',
  partner: '❤️ Partner',
}
const MODE_LABELS: Record<string, string> = {
  conversation: 'Free Talk', interview: 'Interview',
  daily: 'Daily', debate: 'Debate', story: 'Story',
}

// ── Model info ────────────────────────────────────────────────────────────────

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || ''

type ModelOption = {
  id: string
  name: string
  sizeMB?: number
  description: string
  recommended?: boolean
  type: 'local' | 'cloud' | 'scripted'
}

const MODEL_INFO: ModelOption[] = [
  // Cloud option first (for testing)
  {
    id: 'groq-llama3-8b-8192',
    name: 'Groq (Cloud)',
    description: 'Llama 3 8B · Extremely fast · Requires Internet',
    type: 'cloud',
    recommended: false, 
  },
  {
    id: 'scripted-fallback',
    name: 'Scripted Responses',
    description: 'Instant · Works offline · No AI model required',
    type: 'scripted',
    recommended: false,
  },
  {
    ...LLM_MODELS[0],
    sizeMB: 300,
    description: 'LiquidAI LFM2 · Runs on device · High quality',
    recommended: true,
    type: 'local',
  },
  {
    ...LLM_MODELS[1],
    sizeMB: 250,
    description: 'SmolLM2 360M · Runs on device · Low memory',
    type: 'local',
  },
]

// ── Waveform ──────────────────────────────────────────────────────────────────

function WaveformBars() {
  return (
    <div className="flex items-center gap-[3px] h-5" aria-hidden>
      {[1,2,3,4,5,6,7,8].map(i => (
        <span key={i} className="wave-bar" style={{ height: '100%', animationDelay: `${(i-1)*0.1}s` }} />
      ))}
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message, isNew }: { message: LocalMessage; isNew?: boolean }) {
  const isUser = message.role === 'user'
  const hasFb  = message.feedback && (
    message.feedback.corrections.length > 0 || message.feedback.suggestions.length > 0
  )

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} ${isNew ? 'message-enter' : ''}`}>
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-1 ${
        isUser ? 'bg-primary/15' : 'bg-secondary border border-border'
      }`}>
        {isUser
          ? <User className="w-3.5 h-3.5 text-primary" />
          : <Bot  className="w-3.5 h-3.5 text-muted-foreground" />}
      </div>
      <div className={`flex flex-col gap-1.5 max-w-[78%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-primary text-white rounded-tr-sm'
            : 'bg-card border border-border text-foreground rounded-tl-sm'
        }`}>
          {message.content}
        </div>
        {isUser && hasFb && (
          <div className="space-y-1 w-full">
            {message.feedback!.corrections.map((c, i) => (
              <div key={i} className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                <span className="text-amber-700 dark:text-amber-300">{c}</span>
              </div>
            ))}
            {message.feedback!.suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-xs bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-1.5">
                <Lightbulb className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                <span className="text-blue-700 dark:text-blue-300">{s}</span>
              </div>
            ))}
          </div>
        )}
        
        {/* Attribution / Source indicator */}
        {!isUser && message.source && (
          <div className="flex items-center gap-1.5 px-1 animate-in fade-in duration-500">
             <div className="w-1 h-1 rounded-full bg-primary/40"></div>
             <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">{message.source}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Mic Permission Guide ─────────────────────────────────────────────────────

function MicPermissionGuide({ onDismiss, onRetry }: { onDismiss: () => void; onRetry: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm bg-background rounded-2xl border border-border shadow-2xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="font-bold text-foreground text-sm">Microphone is Blocked</h3>
            <p className="text-xs text-muted-foreground mt-1">Your browser blocked mic access for this site. Here's how to allow it:</p>
          </div>
          <button onClick={onDismiss} className="ml-auto shrink-0 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2.5 mb-5">
          <div className="flex items-start gap-2.5 text-xs">
            <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">1</span>
            <span className="text-foreground">In your browser address bar, click the <strong>🔒 lock</strong> or <strong>ⓘ info</strong> icon</span>
          </div>
          <div className="flex items-start gap-2.5 text-xs">
            <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">2</span>
            <span className="text-foreground">Find <strong>Microphone</strong> → change it from <strong>Block</strong> to <strong>Allow</strong></span>
          </div>
          <div className="flex items-start gap-2.5 text-xs">
            <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">3</span>
            <span className="text-foreground">Click <strong>Try Again</strong> — the browser will now ask for permission normally</span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={onRetry}
            className="flex-1 rounded-full text-sm font-semibold bg-primary hover:bg-primary/90 text-white"
          >
            Try Again
          </Button>
          <Button variant="ghost" onClick={onDismiss} className="rounded-full text-sm">
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Past Conversations Panel ───────────────────────────────────────────────────

interface SavedSession {
  id: string
  personality: string
  mode: string
  startedAt: number
  messages: LocalMessage[]
}

const SESSION_KEY = 'speakai_sessions'

function loadSessions(): SavedSession[] {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveSessions(sessions: SavedSession[]) {
  try {
    // Keep last 10 sessions
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessions.slice(-10)))
  } catch { /* ignore quota */ }
}

function HistoryPanel({
  sessions,
  currentPersonality,
  currentMode,
  onClose,
  onRestore,
}: {
  sessions: SavedSession[]
  currentPersonality: string
  currentMode: string
  onClose: () => void
  onRestore: (msgs: LocalMessage[]) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const fmt = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  if (sessions.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
        <div className="w-full max-w-sm bg-background rounded-2xl border border-border shadow-2xl p-6 text-center">
          <History className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-bold text-foreground mb-1">No Past Conversations</h3>
          <p className="text-xs text-muted-foreground mb-4">Your conversations will be saved here automatically during this session.</p>
          <Button onClick={onClose} variant="ghost" className="rounded-full">Close</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-background rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-foreground text-sm">Past Conversations</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{sessions.length}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Session list */}
        <div className="overflow-y-auto flex-1 divide-y divide-border">
          {[...sessions].reverse().map(sess => (
            <div key={sess.id} className="px-5 py-3">
              <button
                className="w-full text-left"
                onClick={() => setExpanded(expanded === sess.id ? null : sess.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-foreground truncate">
                      {PERS_LABELS[sess.personality as Mode] ?? sess.personality}
                    </span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{MODE_LABELS[sess.mode] ?? sess.mode}</Badge>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-muted-foreground">{fmt(sess.startedAt)}</span>
                    <span className="text-[10px] text-muted-foreground">{sess.messages.length} msgs</span>
                    <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${expanded === sess.id ? 'rotate-90' : ''}`} />
                  </div>
                </div>
                {/* Preview of first exchange */}
                {expanded !== sess.id && sess.messages.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {sess.messages[0].content}
                  </p>
                )}
              </button>

              {/* Expanded messages */}
              {expanded === sess.id && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                    {sess.messages.map(msg => (
                      <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`text-xs px-3 py-1.5 rounded-xl max-w-[85%] ${
                          msg.role === 'user'
                            ? 'bg-primary/10 text-foreground'
                            : 'bg-secondary text-foreground'
                        }`}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                  </div>
                  {sess.personality === currentPersonality && sess.mode === currentMode && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { onRestore(sess.messages); onClose() }}
                      className="w-full rounded-full text-xs mt-2"
                    >
                      Continue this conversation
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-border shrink-0">
          <p className="text-[10px] text-muted-foreground text-center">Conversations are saved for this browser session only</p>
        </div>
      </div>
    </div>
  )
}

// ── Model Download Panel ──────────────────────────────────────────────────────

function ModelDownloadPanel({
  sdkState,
  onSelectModel,
  onSkip,
}: {
  sdkState: SDKState
  onSelectModel: (modelId: string) => void
  onSkip: () => void
}) {
  const [selected, setSelected] = useState(MODEL_INFO[0].id)
  const isDownloading = sdkState.status === 'downloading' || sdkState.status === 'loading'
  const isActive      = sdkState.status === 'active'
  const isInitializing = sdkState.status === 'initializing' || sdkState.status === 'uninitialized'

  const selectedModel = MODEL_INFO.find(m => m.id === selected)
  const isLocalModel  = selectedModel?.type === 'local'

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 bg-background">
      <div className="w-full max-w-lg">

        {/* Icon + heading */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-orange-50 dark:bg-orange-950/30 border border-orange-100 dark:border-orange-900 flex items-center justify-center mb-4">
            <Cpu className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Choose Your AI Model</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Select a model. Local models run 100% on your device. Cloud models require an API key.
          </p>
        </div>

        {/* Model cards */}
        {!isDownloading && !isActive && (
          <div className="space-y-3 mb-6">
            {MODEL_INFO.map(m => (
              <button
                key={m.id}
                data-testid={`button-model-${m.id}`}
                onClick={() => setSelected(m.id)}
                className={`w-full flex items-start gap-4 p-4 rounded-xl border text-left transition-all ${
                  selected === m.id
                    ? 'border-primary bg-orange-50 dark:bg-orange-950/30 shadow-sm'
                    : 'border-border bg-card hover:border-primary/40'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                  selected === m.id ? 'bg-primary/15' : 'bg-secondary'
                }`}>
                  {m.type === 'cloud' && <HardDrive className={`w-5 h-5 ${selected === m.id ? 'text-primary' : 'text-muted-foreground'}`} />}
                  {m.type === 'local' && <Download className={`w-5 h-5 ${selected === m.id ? 'text-primary' : 'text-muted-foreground'}`} />}
                  {m.type === 'scripted' && <MessageSquare className={`w-5 h-5 ${selected === m.id ? 'text-primary' : 'text-muted-foreground'}`} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">{m.name}</span>
                    {m.recommended && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                        <Sparkles className="w-2.5 h-2.5" /> Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    {m.type === 'local' 
                      ? <>~{m.sizeMB} MB · downloads once</>
                      : m.type === 'cloud' 
                        ? <>Requires active internet</>
                        : <>No download required</>
                    }
                  </p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 shrink-0 mt-1 flex items-center justify-center transition-colors ${
                  selected === m.id ? 'border-primary bg-primary' : 'border-border'
                }`}>
                  {selected === m.id && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Downloading / loading progress */}
        {isDownloading && (
          <div className="mb-6 rounded-2xl border-2 border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/40 overflow-hidden">
            {/* Header row */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                {sdkState.status === 'downloading' ? (
                  <Download className="w-5 h-5 text-primary" />
                ) : (
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">
                  {sdkState.status === 'downloading' ? 'Downloading AI model to your device...' : 'Loading model into WASM engine...'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Keep this tab open · runs 100% locally</p>
              </div>
              {sdkState.status === 'downloading' && (
                <span className="text-2xl font-black text-primary tabular-nums shrink-0">
                  {sdkState.downloadProgress}%
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="px-5 pb-2">
              {sdkState.status === 'downloading' ? (
                <>
                  <Progress value={sdkState.downloadProgress} className="h-3 rounded-full" />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5">
                    <span>0 MB</span>
                    <span>{MODEL_INFO.find(m => m.id === (sdkState.activeModelId ?? selected))?.sizeMB ?? '~300'} MB</span>
                  </div>
                </>
              ) : (
                <div className="h-3 rounded-full bg-primary/20 overflow-hidden">
                  <div className="h-full bg-primary rounded-full animate-[progress-indeterminate_1.5s_ease-in-out_infinite]" style={{ width: '60%' }} />
                </div>
              )}
            </div>

            {/* Step indicators */}
            <div className="flex items-center gap-0 px-5 pb-4 pt-1">
              <div className="flex items-center gap-1.5">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  sdkState.status === 'downloading' ? 'bg-primary text-white animate-pulse' : 'bg-green-500 text-white'
                }`}>
                  {sdkState.status === 'downloading' ? '1' : '✓'}
                </div>
                <span className={`text-[11px] font-medium ${
                  sdkState.status === 'downloading' ? 'text-primary' : 'text-green-600 dark:text-green-400'
                }`}>Download</span>
              </div>
              <div className="flex-1 h-px bg-border mx-2" />
              <div className="flex items-center gap-1.5">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  sdkState.status === 'loading' ? 'bg-primary text-white animate-pulse' : 'bg-border text-muted-foreground'
                }`}>
                  2
                </div>
                <span className={`text-[11px] font-medium ${
                  sdkState.status === 'loading' ? 'text-primary' : 'text-muted-foreground'
                }`}>Load into WASM</span>
              </div>
              <div className="flex-1 h-px bg-border mx-2" />
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-full bg-border text-muted-foreground flex items-center justify-center text-[10px] font-bold">3</div>
                <span className="text-[11px] font-medium text-muted-foreground">Ready</span>
              </div>
            </div>
          </div>
        )}

        {/* Active / ready */}
        {isActive && (
          <div className="mb-6 p-5 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">Model ready!</p>
              <p className="text-xs text-muted-foreground">
                {MODEL_INFO.find(m => m.id === sdkState.activeModelId)?.name} loaded · {sdkState.accelerationMode === 'webgpu' ? 'WebGPU' : 'WASM CPU'}
              </p>
            </div>
          </div>
        )}

        {/* SDK init state */}
        {isInitializing && (
          <div className="mb-6 p-4 rounded-xl border border-border bg-secondary/50 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
            <p className="text-sm text-muted-foreground">Initializing RunAnywhere SDK...</p>
          </div>
        )}

        {/* Error */}
        {sdkState.status === 'error' && (
          <div className="mb-6 p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground">SDK initialization failed</p>
              <p className="text-xs text-muted-foreground mt-0.5">{sdkState.error}</p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-3">
          {!isDownloading && !isActive && (
            <Button
              onClick={() => onSelectModel(selected)}
              disabled={isInitializing && isLocalModel}
              data-testid="button-download-model"
              className="w-full rounded-full py-5 text-sm font-semibold bg-primary hover:bg-primary/90 text-white shadow-md shadow-orange-500/20"
            >
              {!isLocalModel ? <Zap className="w-4 h-4 mr-2" /> : <Download className="w-4 h-4 mr-2" />}
              {selectedModel?.type === 'cloud' 
                ? 'Use Cloud Model' 
                : selectedModel?.type === 'scripted' 
                  ? 'Use Scripted Responses'
                  : 'Download & Load Model'
              }
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}

          {isActive && (
            <Button
              onClick={onSkip}
              data-testid="button-start-chat"
              className="w-full rounded-full py-5 text-sm font-semibold bg-primary hover:bg-primary/90 text-white shadow-md shadow-orange-500/20"
            >
              <Zap className="w-4 h-4 mr-2" />
              Start Practicing Now
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}

          <Button
            variant="ghost"
            onClick={onSkip}
            data-testid="button-skip-model"
            className="w-full rounded-full text-sm text-muted-foreground hover:text-foreground"
          >
            {isActive ? 'Continue to practice' : isDownloading ? 'Cancel & skip — use browser speech' : 'Skip — use browser speech only'}
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Model stored in your browser · never sent to any server
        </p>
      </div>
    </div>
  )
}

// ── SDK Status Strip ──────────────────────────────────────────────────────────

function SDKStrip({ sdkState, activeModel, onOpenPanel }: { sdkState: SDKState; activeModel: ModelOption | null; onOpenPanel: () => void }) {
  // If we are in "Cloud" or "Scripted" mode, show a different indicator
  if (activeModel?.type === 'cloud') {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-100 dark:border-blue-900 text-xs text-blue-700 dark:text-blue-400">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
        <HardDrive className="w-3 h-3 shrink-0" />
        <span>Cloud Model Active · {activeModel.name}</span>
      </div>
    )
  }
  if (activeModel?.type === 'scripted') {
    return (
      <div className="flex items-center justify-between px-4 py-1.5 bg-secondary border-b border-border text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <MessageSquare className="w-3 h-3" /> Scripted Mode (Offline)
        </span>
        <button onClick={onOpenPanel} className="text-xs font-semibold text-primary hover:underline">
          Change Model →
        </button>
      </div>
    )
  }

  // --- Existing Local SDK states ---
  if (sdkState.status === 'active') {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-green-50 dark:bg-green-950/30 border-b border-green-100 dark:border-green-900 text-xs text-green-700 dark:text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
        <Zap className="w-3 h-3 shrink-0" />
        <span>RunAnywhere SDK · {sdkState.accelerationMode === 'webgpu' ? 'WebGPU' : 'WASM CPU'} · {LLM_MODELS.find(m => m.id === sdkState.activeModelId)?.name}</span>
      </div>
    )
  }
  if (sdkState.status === 'downloading') {
    return (
      <div className="px-4 py-2 bg-orange-50 dark:bg-orange-950/30 border-b border-orange-100 dark:border-orange-900">
        <div className="flex items-center gap-2 text-xs text-orange-700 dark:text-orange-400 mb-1">
          <Download className="w-3 h-3 animate-bounce" />
          Downloading model... {sdkState.downloadProgress}%
        </div>
        <Progress value={sdkState.downloadProgress} className="h-1" />
      </div>
    )
  }
  if (sdkState.status === 'loading') {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-orange-50 dark:bg-orange-950/30 border-b border-orange-100 dark:border-orange-900 text-xs text-orange-700 dark:text-orange-400">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading model into WASM...
      </div>
    )
  }
  if (sdkState.status === 'ready' && !activeModel) {
    return (
      <div className="flex items-center justify-between px-4 py-1.5 bg-orange-50/70 dark:bg-orange-950/20 border-b border-orange-100 dark:border-orange-900">
        <span className="text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
          <Cpu className="w-3 h-3" /> No model loaded · using browser speech
        </span>
        <button onClick={onOpenPanel} className="text-xs font-semibold text-primary hover:underline">
          Load AI model →
        </button>
      </div>
    )
  }
  return null
}

// ── Main Practice Page ────────────────────────────────────────────────────────

export function PracticePage() {
  const { personality = 'friendly', mode = 'conversation' } = useParams<{ personality: string; mode: string }>()
  const [, navigate] = useLocation()
  const { theme, toggleTheme } = useTheme()
  const { toast } = useToast()
  const msgIdRef = useRef(0)

  // ── State ─────────────────────────────────────────────────────────────────
  const [showModelPanel, setShowModelPanel] = useState(true)  // show on first enter
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [transcript, setTranscript]         = useState('')
  const [streamedResponse, setStreamedResponse] = useState('')
  const [isTTSEnabled, setIsTTSEnabled]     = useState(true)
  const [isSpeaking, setIsSpeaking]         = useState(false)
  const [isThinking, setIsThinking]         = useState(false)
  const [showMicGuide, setShowMicGuide]     = useState(false)
  const [showHistory, setShowHistory]       = useState(false)
  const [sessions, setSessions]             = useState<SavedSession[]>(() => loadSessions())
  const sessionIdRef                        = useRef(`sess_${Date.now()}`)
  const sessionStartRef                     = useRef(Date.now())
  const [sdkState, setSDKState]             = useState<SDKState>({
    status: 'uninitialized', error: null, downloadProgress: 0,
    activeModelId: null, accelerationMode: null, sttReady: false, ttsReady: false,
  })

  const [currentFeedback, setCurrentFeedback] = useState<FeedbackData | null>(null)

  const recognitionRef  = useRef<SpeechRecognition | null>(null)
  const messagesEndRef  = useRef<HTMLDivElement>(null)

  // ── Auto-Greeting & Reset ─────────────────────────────────────────────────

  const hasGreetedRef = useRef(false)

  // Reset context on mount to ensure fresh start
  useEffect(() => {
    resetContext().catch(e => console.error('Reset failed', e))
    return () => {
      resetContext().catch(() => {})
    }
  }, [])

  // Trigger greeting when we're ready to chat (panel closed)
  useEffect(() => {
    if (hasGreetedRef.current) return

    // Don't greet if there are already messages (e.g. from restored session)
    if (messages.length > 0) {
      hasGreetedRef.current = true
      return
    }

    if (!showModelPanel) {
       hasGreetedRef.current = true
       const greeting = INITIAL_GREETINGS[personality as Mode] || INITIAL_GREETINGS.friendly
       
       setMessages([{
         id: ++msgIdRef.current,
         role: 'assistant',
         content: greeting,
         source: 'Initial Greeting (Scripted)'
       }])
       
       if (isTTSEnabled) {
         speakBrowser(greeting, {
           onStart: () => setIsSpeaking(true),
           onEnd: () => setIsSpeaking(false),
         })
       }
    }
  }, [showModelPanel, messages.length, personality, isTTSEnabled])

  // ── Subscribe to SDK state + auto-init ────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeSDK(setSDKState)
    initSDK().catch(err => console.warn('RunAnywhere SDK init failed:', err))
    return unsub
  }, [])

  const [activeModel, setActiveModel] = useState<ModelOption | null>(null)

  // ── Handle model selection from panel ─────────────────────────────────────
  const handleSelectModel = useCallback(async (modelId: string) => {
    const selected = MODEL_INFO.find(m => m.id === modelId)
    if (!selected) return

    setActiveModel(selected)

    // Case 1: Cloud or Scripted
    if (selected.type === 'cloud' || selected.type === 'scripted') {
      const isCloud = selected.type === 'cloud'
      const description = isCloud ? `Using ${selected.name}` : `Using scripted responses`
      toast({ title: isCloud ? 'Cloud Mode Active' : 'Script Mode Active', description })
      setShowModelPanel(false)
      return
    }

    // Case 2: Local Model (RunAnywhere)
    try {
      await loadLLMModel(modelId)
      toast({ title: 'Model loaded', description: `${selected.name} ready` })
    } catch (err) {
      toast({ title: 'Model load failed', description: String(err), variant: 'destructive' })
    }
  }, [toast])

  // When model becomes active (local), auto-close the panel after a short delay
  useEffect(() => {
    if (sdkState.status === 'active' && showModelPanel) {
      const selected = MODEL_INFO.find(m => m.id === sdkState.activeModelId)
      if (selected) setActiveModel(selected as ModelOption)
      
      const t = setTimeout(() => setShowModelPanel(false), 1200)
      return () => clearTimeout(t)
    }
  }, [sdkState.status, showModelPanel])

  // ── Save current conversation to session history ───────────────────────────
  useEffect(() => {
    if (messages.length === 0) return
    const updated: SavedSession = {
      id: sessionIdRef.current,
      personality,
      mode,
      startedAt: sessionStartRef.current,
      messages,
    }
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== updated.id)
      const next = [...filtered, updated]
      saveSessions(next)
      return next
    })
  }, [messages, personality, mode])

  // ── Grammar check (simple client-side heuristic) ─────────────────────────
  const checkGrammar = (text: string): FeedbackData => {
    const corrections: string[] = []
    const suggestions: string[] = []
    if (/\bi is\b/i.test(text)) corrections.push('Use "I am" instead of "I is"')
    if (/\bhe don't\b/i.test(text)) corrections.push('Use "he doesn\'t" instead of "he don\'t"')
    if (/\bshe don't\b/i.test(text)) corrections.push('Use "she doesn\'t" instead of "she don\'t"')
    if (/\bthey was\b/i.test(text)) corrections.push('Use "they were" instead of "they was"')
    if (/\bi have went\b/i.test(text)) corrections.push('Use "I have gone" instead of "I have went"')
    if (text.split(' ').length > 3 && !/[.!?]$/.test(text.trim())) {
      suggestions.push('End sentences with punctuation for clarity')
    }
    return { corrections, suggestions }
  }

  // ── Send message (fully client-side) ─────────────────────────────────────
  const handleSendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return

    const feedback = checkGrammar(content.trim())

    // Add user message immediately
    const userMsg: LocalMessage = {
      id: ++msgIdRef.current,
      role: 'user',
      content: content.trim(),
      feedback: feedback.corrections.length || feedback.suggestions.length ? feedback : undefined,
    }
    setMessages(prev => [...prev, userMsg])

    // Build system prompt
    const sysPrompt = `${SYSTEM_PROMPTS[personality as Mode] ?? SYSTEM_PROMPTS.friendly}\n\nMode: ${MODE_CONTEXT[mode] ?? MODE_CONTEXT.conversation}\n\nIMPORTANT: Reply in 2-4 sentences. No markdown. Be conversational and friendly.`

    // ── PATH 1: Groq Cloud API ──
    if (activeModel?.type === 'cloud') {
      if (GROQ_API_KEY) {
        try {
          setIsThinking(true)
          
          // Prepare messages for Groq
          const groqMessages = [
             { role: 'system', content: sysPrompt },
             ...messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
             { role: 'user', content: content.trim() }
          ]

          const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              messages: groqMessages,
              model: 'llama3-8b-8192',
              temperature: 0.7,
              max_tokens: 250,
            })
          })

          if (!response.ok) {
            const errText = await response.text()
            console.error('Groq API Error Details:', errText)
            throw new Error(`Groq API Error: ${response.status} - ${errText}`)
          }
          
          const data = await response.json()
          const aiText = data.choices?.[0]?.message?.content || ''
          
          setIsThinking(false)
          
          const aiMsg: LocalMessage = { 
            id: ++msgIdRef.current, 
            role: 'assistant', 
            content: aiText,
            source: 'Generated by Groq Cloud (Llama 3)' 
          }
          setMessages(prev => [...prev, aiMsg])

          if (isTTSEnabled && aiText) {
            speakBrowser(aiText, {
              onStart: () => setIsSpeaking(true),
              onEnd:   () => setIsSpeaking(false),
            })
          }
          return // End here for cloud
        } catch (err) {
          console.error('Groq failed:', err)
          setIsThinking(false)
          toast({ title: 'Cloud Error', description: 'Falling back to script', variant: 'destructive' })
          // Fall through to script fallback below
        }
      } else {
        // No API Key provided for cloud mode
        console.warn('Cloud mode selected but no API Key found. Falling back to script.')
        // Fall through to script fallback
      }
    }

    // ── PATH 2: Local RunAnywhere SDK ──
    if (sdkState.status === 'active') {
      // ── RunAnywhere SDK path: on-device LLM ──
      setStreamedResponse('')
      
      // Use ChatML format for better context handling
      let chatPrompt = `<|im_start|>system\n${sysPrompt}<|im_end|>\n`
      
      // Include last 10 messages for context
      const contextMsgs = messages.slice(-10)
      for (const m of contextMsgs) {
        chatPrompt += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`
      }
      
      // Add current user message
      chatPrompt += `<|im_start|>user\n${content.trim()}<|im_end|>\n<|im_start|>assistant\n`

      console.log('[Practice] Sending ChatML prompt:', chatPrompt)

      try {
        setIsThinking(true)
        let aiText = ''
        await generateResponse(chatPrompt, {
          systemPrompt: sysPrompt, // Fallback for models without raw prompt support
          maxTokens: 250,
          temperature: 0.7,
          onToken: (_, acc) => {
            if (isThinking) setIsThinking(false)
            aiText = acc
            setStreamedResponse(acc)
          },
        })
        setIsThinking(false)
        setStreamedResponse('')
        console.log('[Practice] AI Response complete:', aiText)

        const aiMsg: LocalMessage = {
          id: ++msgIdRef.current, 
          role: 'assistant', 
          content: aiText,
          source: `Generated by ${LLM_MODELS.find(m => m.id === sdkState.activeModelId)?.name || 'AI Model'} (${sdkState.accelerationMode === 'webgpu' ? 'WebGPU' : 'WASM CPU'})`
        }
        setMessages(prev => [...prev, aiMsg])

        if (isTTSEnabled && aiText) {
          speakBrowser(aiText, {
            onStart: () => setIsSpeaking(true),
            onEnd:   () => setIsSpeaking(false),
          })
        }
      } catch (err) {
        console.error('[Practice] Generation failed:', err)
        setIsThinking(false)
        setStreamedResponse('')
        
        // Show the actual error message for debugging purposes
        const errorMessage = err instanceof Error ? err.message : String(err)
        
        const errMsg: LocalMessage = {
          id: ++msgIdRef.current,
          role: 'assistant',
          content: `Error: ${errorMessage}. Please try again.`,
          source: 'System Error'
        }
        setMessages(prev => [...prev, errMsg])
      }
    } else {
      // ── Browser-only fallback: simple scripted responses ──
      setIsThinking(true)
      await new Promise(r => setTimeout(r, 800 + Math.random() * 600))
      setIsThinking(false)

      const responses: Record<string, string[]> = {
        friendly: [
          "That's really interesting! Tell me more about that.",
          "Oh wow, I hadn't thought about it that way! What made you think of that?",
          "Ha, I totally get what you mean! I've had similar experiences.",
          "That's a great point! Have you always felt this way?",
          "No way! That sounds amazing. What happened next?",
        ],
        teacher: [
          "Good effort! Your sentence structure is mostly correct. Keep practicing your tenses.",
          "Well done! One small note — try using more varied vocabulary to express your ideas.",
          "That's a good attempt. Notice how native speakers often use contractions in casual speech.",
          "Excellent! Your grammar is improving. Let's try a more complex sentence next.",
          "Good sentence! You might consider using a stronger verb there for more impact.",
        ],
        debate: [
          "That's an interesting perspective, but have you considered the counter-argument?",
          "I see your point, but the evidence actually suggests the opposite in many cases.",
          "Fair enough, but you're overlooking a key factor here. What about the long-term effects?",
          "That's a strong claim. Can you support it with specific examples?",
          "Interesting! But doesn't that position contradict what you said earlier?",
        ],
        interviewer: [
          "Thank you for that response. Can you give me a specific example from your experience?",
          "Interesting. Using the STAR method, can you elaborate on the outcome?",
          "Good answer. Tell me about a time you faced a similar challenge.",
          "I see. What would you do differently if you could go back?",
          "That's helpful context. How did your team respond to your decision?",
        ],
        casual: [
          "Oh dude, that's so relatable! Same thing happened to me last week lol",
          "Wait, seriously?! That's wild. What did you do?",
          "Haha yeah I feel that. So what's the plan then?",
          "Nice! You seen anything good lately? I've been binge-watching stuff.",
          "Aw man that sucks. Hope everything works out.",
        ],
        partner: [
          "I love hearing about your day. Tell me more, love.",
          "You're the best. I'm so lucky to have you.",
          "That sounds tough, but I know you can handle it. I believe in you!",
          "Can we do something fun together later? Maybe watch a movie?",
          "Just remember I'm always here for you, no matter what.",
        ]
      }

      const pool = responses[personality] ?? responses.friendly
      const picked = pool[Math.floor(Math.random() * pool.length)]

      let source = 'Scripted Response (Model not loaded)'
      if (activeModel?.type === 'cloud') {
         if (!GROQ_API_KEY) {
           source = 'Scripted Fallback (Missing API Key)'
         } else {
           source = 'Scripted Fallback (Cloud Error)'
         }
      } else if (activeModel?.type === 'scripted') {
         source = 'Scripted Response'
      }

      const aiMsg: LocalMessage = { 
        id: ++msgIdRef.current, 
        role: 'assistant', 
        content: picked,
        source
      }
      setMessages(prev => [...prev, aiMsg])

      if (isTTSEnabled) {
        speakBrowser(picked, {
          onStart: () => setIsSpeaking(true),
          onEnd:   () => setIsSpeaking(false),
        })
      }
    }
  }, [sdkState.status, personality, mode, messages, isTTSEnabled])

      // ── Web Speech API STT ────────────────────────────────────────────────────

  // Use a ref for transcript to ensure callbacks access latest value
  const transcriptRef = useRef('')
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null)

  const updateTranscript = useCallback((text: string) => {
    setTranscript(text)
    transcriptRef.current = text
  }, [])

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    recognitionRef.current?.stop()
    // Go to 'reviewing' state instead of 'processing'
    setRecordingState('reviewing')
    
    // Check if we have anything to review
    setTimeout(() => {
      const finalText = transcriptRef.current.trim()
      if (!finalText) {
          console.log('[STT] Empty transcript, cancelling review')
          setRecordingState('idle')
      } else {
        // Generate feedback for review
        setCurrentFeedback(checkGrammar(finalText))
      }
    }, 200)

  }, [updateTranscript])

  const confirmAndSend = useCallback(() => {
    const text = transcriptRef.current.trim()
    if (text) {
      setRecordingState('processing')
      handleSendMessage(text)
      updateTranscript('')
      setCurrentFeedback(null)
      setRecordingState('idle')
    } else {
      setRecordingState('idle')
    }
  }, [handleSendMessage, updateTranscript])

  const clearAndRetry = useCallback(() => {
      updateTranscript('')
      setCurrentFeedback(null)
      setRecordingState('idle')
  }, [updateTranscript])

  const startListening = useCallback(() => {
    // Check for both SpeechRecognition (standard) and webkitSpeechRecognition (Chrome/Safari)
    // @ts-expect-error browser compatibility
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      toast({ title: 'Not supported', description: 'Use Chrome or Edge for speech recognition', variant: 'destructive' })
      return
    }
    const rec = new SR()
    rec.lang = 'en-US'
    rec.continuous = false // We handle "continuous" by restarting if needed, but for turn-taking false is better
    rec.interimResults = true

    // Reset silence timer helper
    const resetSilenceTimer = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      // Auto-stop after 2.5s silence and go to review
      silenceTimerRef.current = setTimeout(() => {
        console.log('[STT] Silence detected, stopping...')
        stopListening()
      }, 2500)
    }

    rec.onstart  = () => {
      console.log('[STT] Mic started')
      setRecordingState('listening')
      updateTranscript('')
      resetSilenceTimer()
    }

    rec.onresult = (e: any) => {
      resetSilenceTimer() // Reset timer on any speech
      let interim = '', final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        // console.log('[STT] Result fragment:', i, t, 'isFinal:', e.results[i].isFinal)
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      const text = final || interim
      if (text) {
        updateTranscript(text)
      }
    }
    
    rec.onend = () => {
      // If stopped by silence timer or manually, 'reviewing' state handles it.
      // If stopped by browser randomly, checks if we should restart or just process.
       if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
       
       // If we are still 'listening' (browser cut off early), treat as stop -> review
       setRecordingState(current => {
          if (current === 'listening') {
             return 'reviewing'
          }
          return current
       })
    }


    rec.onerror = (e: any) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      console.warn('[STT] Error:', e.error)
      setRecordingState('idle')
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        setShowMicGuide(true)
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        // toast({ title: 'Mic error', description: e.error, variant: 'destructive' })
      }
    }

    recognitionRef.current = rec
    try {
      rec.start()
    } catch (err) {
      console.error('[STT] Start failed:', err)
    }
  }, [toast, updateTranscript, handleSendMessage, stopListening])


  const handleMicClick = useCallback(() => {
    if (recordingState === 'listening') {
      stopListening()
    } else if (recordingState === 'idle') {
      window.speechSynthesis?.cancel()
      setIsSpeaking(false)
      // Small delay to ensure synthesis is cancelled before mic starts
      // This prevents the mic from picking up the end of the TTS
      setTimeout(() => startListening(), 100)
    }
  }, [recordingState, startListening, stopListening])

  // ── Keyboard push-to-talk (Space) ─────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body && !showModelPanel) {
        e.preventDefault()
        if (recordingState === 'idle') startListening()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body && !showModelPanel) {
        e.preventDefault()
        if (recordingState === 'listening') stopListening()
      }
    }
    document.addEventListener('keydown', down)
    document.addEventListener('keyup', up)
    return () => { document.removeEventListener('keydown', down); document.removeEventListener('keyup', up) }
  }, [recordingState, startListening, stopListening, showModelPanel])

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking, streamedResponse])

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => {
    recognitionRef.current?.abort()
    window.speechSynthesis?.cancel()
  }, [])

  const isPending = isThinking || recordingState === 'processing'
  
  // Dynamic label
  const micLabel = {
    idle: 'Click or Space to speak',
    listening: 'Listening... (auto-stop on silence)',
    reviewing: 'Review your message above...',
    processing: 'Sending to AI...',
  }[recordingState]

  // ── Render model panel ────────────────────────────────────────────────────
  if (showModelPanel) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <header className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2.5 border-b border-border bg-background/80 backdrop-blur-sm">
          <Button size="icon" variant="ghost" onClick={() => navigate('/')}
            data-testid="button-back" aria-label="Back" className="rounded-full">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <svg viewBox="0 0 28 28" width="24" height="24" fill="none" aria-hidden>
            <rect width="28" height="28" rx="7" fill="#F97316"/>
            <rect x="10" y="5.5" width="8" height="10" rx="4" fill="white"/>
            <path d="M7 14.5c0 3.87 3.13 7 7 7s7-3.13 7-7" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
            <line x1="14" y1="21.5" x2="14" y2="24" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
            <line x1="11.5" y1="24" x2="16.5" y2="24" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <div className="flex items-center gap-2 flex-1">
            <span className="font-semibold text-sm">{PERS_LABELS[personality as Mode]}</span>
            <Badge variant="secondary" className="text-xs">{MODE_LABELS[mode]}</Badge>
          </div>
          <Button size="icon" variant="ghost" onClick={toggleTheme} className="rounded-full">
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
        </header>

        <ModelDownloadPanel
          sdkState={sdkState}
          onSelectModel={handleSelectModel}
          onSkip={() => setShowModelPanel(false)}
        />
      </div>
    )
  }

  // ── Render chat ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* Mic permission guide overlay */}
      {showMicGuide && (
        <MicPermissionGuide
          onDismiss={() => setShowMicGuide(false)}
          onRetry={() => { setShowMicGuide(false); startListening() }}
        />
      )}

      {/* Past conversations overlay */}
      {showHistory && (
        <HistoryPanel
          sessions={sessions.filter(s => s.messages.length > 0)}
          currentPersonality={personality}
          currentMode={mode}
          onClose={() => setShowHistory(false)}
          onRestore={(msgs) => {
            sessionIdRef.current = `sess_${Date.now()}`
            sessionStartRef.current = Date.now()
            setMessages(msgs)
          }}
        />
      )}

      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2.5 border-b border-border bg-background/80 backdrop-blur-sm">
        <Button size="icon" variant="ghost" onClick={() => { window.speechSynthesis?.cancel(); navigate('/') }}
          data-testid="button-back" aria-label="Back" className="rounded-full">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <svg viewBox="0 0 28 28" width="24" height="24" fill="none" aria-hidden>
          <rect width="28" height="28" rx="7" fill="#F97316"/>
          <rect x="10" y="5.5" width="8" height="10" rx="4" fill="white"/>
          <path d="M7 14.5c0 3.87 3.13 7 7 7s7-3.13 7-7" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
          <line x1="14" y1="21.5" x2="14" y2="24" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
          <line x1="11.5" y1="24" x2="16.5" y2="24" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>

        <div className="flex flex-col justify-center min-w-0 flex-1 ml-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{PERS_LABELS[personality as Mode]}</span>
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 shrink-0">{MODE_LABELS[mode]}</Badge>
          </div>
          {/* SDK Status Badge (Centered/Under) */}
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className={`w-1.5 h-1.5 rounded-full ${
              sdkState.status === 'active' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' :
              sdkState.status === 'downloading' ? 'bg-orange-500 animate-pulse' :
              sdkState.status === 'loading' ? 'bg-blue-500 animate-pulse' :
              'bg-muted-foreground'
            }`} />
            <span onClick={() => setShowModelPanel(true)} className="text-[10px] text-muted-foreground cursor-pointer hover:text-primary transition-colors truncate max-w-[180px]">
              {activeModel?.type === 'cloud' ? `${activeModel.name}`
                : activeModel?.type === 'scripted' ? 'Scripted Response Mode'
                : sdkState.status === 'active' 
                  ? `${LLM_MODELS.find(m => m.id === sdkState.activeModelId)?.name} · ${sdkState.accelerationMode === 'webgpu' ? 'GPU' : 'CPU'}`
                  : sdkState.status === 'downloading' ? `Downloading ${sdkState.downloadProgress}%`
                  : sdkState.status === 'loading' ? 'Loading Model...' 
                  : 'Browser Speech (Tap to Load AI)'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {isSpeaking && <span className="text-xs text-primary animate-pulse">Speaking</span>}
          <Button size="icon" variant="ghost"
            onClick={() => { if (isTTSEnabled) window.speechSynthesis?.cancel(); setIsTTSEnabled(v => !v) }}
            data-testid="button-toggle-tts" aria-label="Toggle TTS" className="rounded-full">
            {isTTSEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
          </Button>
          <Button size="icon" variant="ghost"
            onClick={() => setShowHistory(true)}
            data-testid="button-history" aria-label="Past conversations" className="rounded-full relative">
            <History className="w-4 h-4" />
            {sessions.filter(s => s.id !== sessionIdRef.current && s.messages.length > 0).length > 0 && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary" />
            )}
          </Button>
          <Button size="icon" variant="ghost"
            onClick={() => { setMessages([]); window.speechSynthesis?.cancel() }}
            data-testid="button-clear" aria-label="Clear" className="rounded-full">
            <RotateCcw className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={toggleTheme}
            data-testid="button-theme" className="rounded-full">
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
        </div>
      </header>

      {/* SDK strip */}
      <SDKStrip 
        sdkState={sdkState} 
        activeModel={activeModel}
        onOpenPanel={() => setShowModelPanel(true)} 
      />

      {/* Chat area */}
      <ScrollArea className="flex-1 px-4">
        <div className="max-w-2xl mx-auto py-5 space-y-4">

          {/* Intro if empty */}
          {messages.length === 0 && !streamedResponse && !isThinking && (
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-orange-50 dark:bg-orange-950/30 border border-orange-100 dark:border-orange-900 flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-6 h-6 text-primary" />
              </div>
              <p className="text-muted-foreground text-sm">Click the mic or press Space to start speaking</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Your conversation will appear here</p>
            </div>
          )}

          {/* Messages */}
          <div className="flex flex-col gap-4">
            {messages.map(msg => (
              <MessageBubble key={msg.id} message={msg} isNew={false} />
            ))}

            {/* Streamed SDK response */}
            {streamedResponse && (
              <div className="flex gap-3 items-start message-enter">
                <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-1 bg-secondary border border-border">
                  <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-card border border-border text-sm leading-relaxed max-w-[78%]">
                  {streamedResponse}
                  <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                </div>
              </div>
            )}

            {/* Thinking dots */}
            {isThinking && !streamedResponse && (
              <div className="flex gap-3 items-start message-enter">
                <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-1 bg-secondary border border-border">
                  <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-card border border-border shadow-sm">
                  <div className="flex gap-1.5 items-center h-4">
                    <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                    <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                    <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Live transcript / Review Area */}
      {(recordingState === 'listening' || recordingState === 'reviewing' || transcript) && (
        <div className={`border-t border-border px-4 py-3 bg-background z-20`}>
          <div className="max-w-2xl mx-auto flex flex-col gap-3">
            {recordingState === 'listening' && (
              <div className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <WaveformBars />
                <p className="text-sm flex-1 text-foreground font-medium">{transcript || 'Listening...'}</p>
              </div>
            )}
            
            {recordingState === 'reviewing' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="space-y-2">
                   <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Review Message</span>
                      <span className="text-xs text-muted-foreground">{transcript.split(' ').length} words</span>
                   </div>
                   <div className="p-4 bg-secondary/30 rounded-xl border border-border shadow-sm">
                      <p className="text-base text-foreground leading-relaxed">
                        {transcript}
                      </p>
                   </div>
                   
                   {/* Real-time feedback suggestions */}
                   {currentFeedback && (currentFeedback.corrections.length > 0 || currentFeedback.suggestions.length > 0) && (
                     <div className="flex flex-col gap-2 mt-2">
                        {currentFeedback.corrections.map((c, i) => (
                          <div key={`corr-${i}`} className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 rounded-lg border border-amber-100 dark:border-amber-900/50">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            {c}
                          </div>
                        ))}
                        {currentFeedback.suggestions.map((s, i) => (
                          <div key={`sugg-${i}`} className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 px-3 py-2 rounded-lg border border-blue-100 dark:border-blue-900/50">
                            <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                            {s}
                          </div>
                        ))}
                     </div>
                   )}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <Button 
                    variant="outline" 
                    onClick={() => {
                        clearAndRetry()
                    }}
                    className="rounded-xl h-12 text-sm font-medium border-muted-foreground/20 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" /> Retry
                  </Button>
                  <Button 
                    onClick={confirmAndSend}
                    className="rounded-xl h-12 text-sm font-semibold bg-primary hover:bg-primary/90 text-white shadow-md shadow-orange-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                     Send Message <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mic controls - Hide when reviewing */}
      {recordingState !== 'reviewing' && (
        <div className={`border-t border-border bg-background px-4 py-4 pb-8 transition-all duration-300`}>
          <div className="max-w-2xl mx-auto flex flex-col items-center gap-4">
            
            {/* 1. Voice Input - Centered */}
            <div className="flex flex-col items-center gap-2">
              <div className="relative flex items-center justify-center">
                {recordingState === 'listening' && (
                  <>
                    <div className="pulse-ring" />
                    <div className="pulse-ring" style={{ animationDelay: '0.5s' }} />
                  </>
                )}
                <button
                  onClick={handleMicClick}
                  disabled={isPending}
                  data-testid="button-microphone"
                  aria-label={recordingState === 'listening' ? 'Stop recording' : 'Start recording'}
                  className={`relative z-10 w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 ${
                    recordingState === 'listening'
                      ? 'bg-red-500 text-white scale-110 shadow-lg shadow-red-500/30'
                      : isPending
                      ? 'bg-muted text-muted-foreground cursor-not-allowed'
                      : 'bg-primary text-white hover:scale-105 active:scale-95 shadow-lg shadow-orange-500/30'
                  }`}
                >
                  {isPending ? <Loader2 className="w-6 h-6 animate-spin" />
                    : recordingState === 'listening' ? <div className="w-6 h-6 rounded-sm bg-white" />
                    : <Mic className="w-6 h-6" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground animate-in fade-in">{micLabel}</p>
            </div>

            {/* 2. Text Input - Width full */}
            <div className="w-full flex gap-2 items-center animate-in fade-in slide-in-from-bottom-2 mt-2">
              <Input 
                id="text-input"
                placeholder="Type your message..." 
                className="flex-1 rounded-full bg-secondary border-transparent focus-visible:bg-background focus-visible:border-primary/50 transition-all h-11 px-5 shadow-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const target = e.target as HTMLInputElement;
                    handleSendMessage(target.value);
                    target.value = '';
                  }
                }}
              />
              <Button size="icon" className="rounded-full shrink-0 h-11 w-11 shadow-sm" onClick={() => {
                 const input = document.getElementById('text-input') as HTMLInputElement;
                 if (input && input.value) {
                    handleSendMessage(input.value);
                    input.value = '';
                 }
              }}>
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
