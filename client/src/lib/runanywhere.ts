/**
 * RunAnywhere Web SDK Integration
 *
 * Wraps @runanywhere/web, @runanywhere/web-llamacpp, and @runanywhere/web-onnx
 * for on-device AI inference in the browser without any API keys.
 *
 * Pipeline: Mic → STT (Whisper WASM) → LLM (llama.cpp WASM) → TTS (Piper WASM) → Audio
 */

import {
  RunAnywhere,
  SDKEnvironment,
  ModelManager,
  ModelCategory,
  LLMFramework,
  EventBus,
  type CompactModelDef,
} from '@runanywhere/web'

import { LlamaCPP, TextGeneration } from '@runanywhere/web-llamacpp'
import { ONNX, STT, TTS, STTModelType } from '@runanywhere/web-onnx'

// ── Model Catalog ────────────────────────────────────────────────────────────

/** Small, fast LLM that fits in browser memory */
export const LLM_MODELS: CompactModelDef[] = [
  {
    id: 'lfm2-350m-q4_k_m',
    name: 'LFM2 350M (Fast)',
    repo: 'LiquidAI/LFM2-350M-GGUF',
    files: ['LFM2-350M-Q4_K_M.gguf'],
    framework: LLMFramework.LlamaCpp,
    modality: ModelCategory.Language,
    memoryRequirement: 300_000_000, // ~300MB
  },
  {
    id: 'smollm2-360m-q4',
    name: 'SmolLM2 360M (Tiny)',
    url: 'https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf',
    framework: LLMFramework.LlamaCpp,
    modality: ModelCategory.Language,
    memoryRequirement: 250_000_000,
  },
]

// ── SDK State ─────────────────────────────────────────────────────────────────

export type SDKStatus =
  | 'uninitialized'
  | 'initializing'
  | 'ready'           // SDK ready, no model loaded
  | 'downloading'     // Downloading model file
  | 'loading'         // Loading model into WASM
  | 'active'          // Model loaded, ready to infer
  | 'error'

export interface SDKState {
  status: SDKStatus
  error: string | null
  downloadProgress: number  // 0-100
  activeModelId: string | null
  accelerationMode: string | null // 'webgpu' | 'cpu'
  sttReady: boolean
  ttsReady: boolean
}

let _initPromise: Promise<void> | null = null
let _state: SDKState = {
  status: 'uninitialized',
  error: null,
  downloadProgress: 0,
  activeModelId: null,
  accelerationMode: null,
  sttReady: false,
  ttsReady: false,
}

const _listeners = new Set<(s: SDKState) => void>()

function setState(patch: Partial<SDKState>) {
  _state = { ..._state, ...patch }
  _listeners.forEach(fn => fn(_state))
}

export function getSDKState(): SDKState { return _state }

export function subscribeSDK(fn: (s: SDKState) => void) {
  _listeners.add(fn)
  fn(_state) // immediate call with current state
  return () => { _listeners.delete(fn) }
}

// ── Initialization ────────────────────────────────────────────────────────────

export async function initSDK(): Promise<void> {
  if (_initPromise) return _initPromise

  setState({ status: 'initializing', error: null })

  _initPromise = (async () => {
    try {
      // 1. Initialize core SDK
      await RunAnywhere.initialize({
        environment: SDKEnvironment.Development,
        debug: true,
      })

      // 2. Register backends with explicit WASM URLs
      // IMPORTANT: Use import.meta.url-relative paths so the WASM resolves correctly
      // regardless of host. window.location.origin breaks in iframe proxy environments
      // (e.g., sites.pplx.app) because the JS bundle is served from a different origin.
      // The bundle is at .../assets/index-XXXX.js and WASM is at .../wasm/, so
      // ../wasm/ from the bundle file always resolves correctly.
      
      // In development, the files are at /wasm/ because they are in public/wasm
      const wasmBase = import.meta.env.DEV
        ? new URL('/wasm/', window.location.origin).href
        : new URL('../wasm/', import.meta.url).href

      await LlamaCPP.register({
        wasmUrl:       `${wasmBase}racommons-llamacpp.js`,
        webgpuWasmUrl: `${wasmBase}racommons-llamacpp-webgpu.js`,
      })
      await ONNX.register()

      // 3. Register model catalog
      RunAnywhere.registerModels(LLM_MODELS)

      // 4. Listen for download progress and lifecycle events
      // The SDK may emit progress as 0-1 fraction OR as 0-100 integer depending on version.
      // We normalise both cases to 0-100.
      EventBus.shared.on('model.downloadProgress', (evt: { modelId?: string; progress?: number; loaded?: number; total?: number }) => {
        let pct: number
        if (evt.loaded !== undefined && evt.total && evt.total > 0) {
          pct = Math.round((evt.loaded / evt.total) * 100)
        } else if (evt.progress !== undefined) {
          // Normalise: if > 1 it's already 0-100, otherwise it's 0-1 fraction
          pct = evt.progress > 1 ? Math.round(evt.progress) : Math.round(evt.progress * 100)
        } else {
          return
        }
        setState({ status: 'downloading', downloadProgress: Math.min(pct, 99) })
      })

      EventBus.shared.on('model.downloadStarted', (evt: { modelId?: string }) => {
        console.log('[RunAnywhere] Download started', evt)
        setState({ status: 'downloading', downloadProgress: 0 })
      })

      EventBus.shared.on('model.downloadComplete', (evt: { modelId?: string }) => {
        console.log('[RunAnywhere] Download complete', evt)
        setState({ status: 'loading', downloadProgress: 100 })
      })

      EventBus.shared.on('model.loadProgress', (evt: { modelId?: string; progress?: number }) => {
        console.log('[RunAnywhere] Load progress', evt)
        // Loading into WASM engine — keep status as 'loading'
        setState({ status: 'loading' })
      })

      setState({ status: 'ready', accelerationMode: LlamaCPP.accelerationMode ?? 'cpu' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setState({ status: 'error', error: msg })
      _initPromise = null
      throw err
    }
  })()

  return _initPromise
}

// ── Model Loading ─────────────────────────────────────────────────────────────

export async function loadLLMModel(modelId: string = LLM_MODELS[0].id): Promise<void> {
  const models = ModelManager.getModels()
  const model = models.find(m => m.id === modelId)
  if (!model) throw new Error(`Model ${modelId} not registered`)

  // Download if needed
  if (model.status !== 'downloaded' && model.status !== 'loaded') {
    setState({ status: 'downloading', downloadProgress: 0 })

    // Polling fallback: some SDK versions don't fire EventBus progress events reliably.
    // Poll ModelManager.getModels() every 300ms to update progress from model.downloadProgress field.
    let pollTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
      const current = ModelManager.getModels().find(m => m.id === modelId)
      if (!current) return
      const rawPct = (current as any).downloadProgress as number | undefined
      if (rawPct !== undefined && rawPct > 0) {
        const pct = rawPct > 1 ? Math.round(rawPct) : Math.round(rawPct * 100)
        setState({ status: 'downloading', downloadProgress: Math.min(pct, 99) })
      }
    }, 300)

    try {
      await ModelManager.downloadModel(modelId)
    } finally {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    }
  }

  // Load into WASM engine
  setState({ status: 'loading', downloadProgress: 100 })
  await ModelManager.loadModel(modelId)

  setState({
    status: 'active',
    activeModelId: modelId,
    accelerationMode: LlamaCPP.accelerationMode ?? 'cpu',
  })
}

// ── LLM Generation ────────────────────────────────────────────────────────────

export interface GenerateOptions {
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  onToken?: (token: string, accumulated: string) => void
}

export async function generateResponse(
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  console.log('[RunAnywhere] generateResponse start', { prompt, options })

  // Add a timeout for the initial stream generation to prevent hanging
  const streamPromise = TextGeneration.generateStream(prompt, {
    systemPrompt: options.systemPrompt,
    maxTokens: options.maxTokens ?? 200,
    temperature: options.temperature ?? 0.75,
  })

  // 10s timeout for stream start
  const timeoutPromise = new Promise<{ stream: AsyncIterable<string> }>((_, reject) =>
    setTimeout(() => reject(new Error('Model generation timed out')), 15000)
  )

  const { stream } = await Promise.race([streamPromise, timeoutPromise])

  let accumulated = ''
  
  // Safety check
  if (!stream) {
    console.error('[RunAnywhere] TextGeneration.generateStream returned undefined stream')
    throw new Error('SDK returned empty stream')
  }

  // Consume the stream directly without for-await to handle potential generator variations
  const iterator = stream[Symbol.asyncIterator] ? stream[Symbol.asyncIterator]() : (stream as any)[Symbol.iterator]?.()
  
  if (!iterator) {
    console.error('[RunAnywhere] Stream is not iterable', stream)
    throw new Error('Model generation stream is not iterable')
  }

  while (true) {
    const { value, done } = await iterator.next()
    if (done) break
    
    // Safety check for value
    if (value === null || value === undefined) {
      console.warn('[RunAnywhere] Received null/undefined token in stream, skipping')
      continue
    }

    const token = value
    if (typeof token !== 'string') {
      console.warn('[RunAnywhere] Unexpected token type:', typeof token, token)
    }
    const textPart = (typeof token === 'string' ? token : (token as any).token) || ''
    accumulated += textPart
    options.onToken?.(textPart, accumulated)
  }

  console.log('[RunAnywhere] generateResponse end', accumulated)
  return accumulated
}

export async function resetContext(): Promise<void> {
  console.log('[RunAnywhere] Resetting context...')
  try {
    // Attempt to reset context if the underlying engine supports it
    // @ts-expect-error - TextGeneration.reset might exist in some versions
    if (typeof TextGeneration.reset === 'function') {
      // @ts-expect-error
      await TextGeneration.reset()
      console.log('[RunAnywhere] Context reset successful')
    } else {
      // If no explicit reset, we rely on the next generation call with system prompt
      // to hopefully clear context, but we log a warning.
      console.log('[RunAnywhere] TextGeneration.reset not found, relying on system prompt refresh')
    }
  } catch (err) {
    console.warn('[RunAnywhere] Failed to reset context:', err)
  }
}

// ── STT (Speech-to-Text) ──────────────────────────────────────────────────────
// STT uses browser Web Speech API as the primary path (instant, no download),
// with RunAnywhere ONNX Whisper as the fallback when available.
// The Web Speech API path is used by default for the best UX.

export type STTMode = 'webspeech' | 'runanywhere'

let _sttMode: STTMode = 'webspeech'

export function getSTTMode(): STTMode { return _sttMode }

/**
 * Transcribe using RunAnywhere ONNX Whisper (local, no network for inference).
 * Requires STT model to be loaded first.
 */
export async function transcribeWithRunAnywhere(audioSamples: Float32Array): Promise<string> {
  const result = await STT.transcribe(audioSamples)
  return result.text
}

// ── TTS (Text-to-Speech) ──────────────────────────────────────────────────────
// TTS uses browser Web Speech API as primary (instant), with RunAnywhere
// Piper TTS available when voice model is loaded.

/**
 * Speak text using browser's built-in speechSynthesis (fast, no download).
 */
export function speakBrowser(
  text: string,
  opts: { rate?: number; onStart?: () => void; onEnd?: () => void; gender?: 'male' | 'female' } = {}
): SpeechSynthesisUtterance {
  window.speechSynthesis?.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.rate = opts.rate ?? 0.95
  utt.pitch = 1.0
  utt.volume = 1.0
  const voices = window.speechSynthesis.getVoices()
  
  let preferred: SpeechSynthesisVoice | undefined;

  // 1. Try to find a voice matching the requested gender (heuristic based on name)
  if (opts.gender === 'female') {
    preferred = voices.find(v => (v.name.includes('Female') || v.name.includes('Samantha') || v.name.includes('Victoria') || v.name.includes('Zira') || v.name.includes('Google US English')) && v.lang.startsWith('en'))
  } else if (opts.gender === 'male') {
    preferred = voices.find(v => (v.name.includes('Male') || v.name.includes('Daniel') || v.name.includes('David') || v.name.includes('Microsoft Mark') || v.name.includes('Google UK English Male')) && v.lang.startsWith('en'))
  }

  // 2. Fallback to generic high-quality voices if gender specific failed or not requested
  if (!preferred) {
      preferred = voices.find(v =>
        v.lang.startsWith('en') &&
        (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Daniel'))
      ) ?? voices.find(v => v.lang.startsWith('en-US'))
  }

  if (preferred) utt.voice = preferred
  
  if (opts.onStart) utt.onstart = opts.onStart
  if (opts.onEnd) utt.onend = opts.onEnd
  window.speechSynthesis.speak(utt)
  return utt
}

// ── AudioCapture (for RunAnywhere STT path) ───────────────────────────────────

export class MicrophoneCapture {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private chunks: Float32Array[] = []
  private onChunk?: (chunk: Float32Array) => void

  async start(onChunk?: (chunk: Float32Array) => void): Promise<void> {
    this.onChunk = onChunk
    this.chunks = []
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 }, video: false })
    this.ctx = new AudioContext({ sampleRate: 16000 })
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1)
    this.processor.onaudioprocess = (e) => {
      const chunk = e.inputBuffer.getChannelData(0).slice()
      this.chunks.push(chunk)
      this.onChunk?.(chunk)
    }
    source.connect(this.processor)
    this.processor.connect(this.ctx.destination)
  }

  stop(): Float32Array {
    this.processor?.disconnect()
    this.stream?.getTracks().forEach(t => t.stop())
    const total = this.chunks.reduce((s, c) => s + c.length, 0)
    const result = new Float32Array(total)
    let offset = 0
    for (const c of this.chunks) { result.set(c, offset); offset += c.length }
    this.chunks = []
    return result
  }
}
