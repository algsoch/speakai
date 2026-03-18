# SpeakAI — Local English Practice

AI-powered English speaking practice that runs 100% on your device.  
Powered by RunAnywhere Web SDK (llama.cpp WASM) — no API keys, no server.

---

## Requirements

- **Node.js 18+** — download from https://nodejs.org
- **npm** (comes with Node.js)
- **Chrome or Edge** browser (Web Speech API for microphone)

Check your version:
```bash
node --version   # should be v18 or higher
npm --version
```

---

## Setup & Run

```bash
# 1. Go into the project folder
cd speakai-local

# 2. Install dependencies (only needed once — takes 1-2 minutes)
npm install

# 3. Start the dev server
npm run dev
```

Then open **http://localhost:5001** in Chrome or Edge.

---

## How it works

1. Open the app → choose a personality and practice mode
2. On the practice page, you can:
   - **Skip** → use browser speech only (instant, no download)
   - **Download a model** → downloads ~300MB AI model to your browser once, then works offline
3. Click the **mic button** or press **Space** to speak
4. The AI responds in text + voice

---

## Deployment to Render

1. **Dashboard**: Create a new **Web Service** on [Render](https://render.com/).
2. **Repo**: Connect this GitHub repository.
3. **Settings**:
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment Variables**: Add `PORT` (set to `10000` or allow Render to set it).

The app serves static files from `dist/` and handles API routes via Express.

## Folder structure

```
speakai-local/
├── client/
│   ├── public/wasm/        ← WASM binaries (RunAnywhere SDK)
│   └── src/
│       ├── pages/          ← HomePage, PracticePage
│       ├── lib/runanywhere.ts  ← SDK integration
│       └── index.css       ← RunAnywhere orange theme
├── server/                 ← Express dev server
├── package.json
└── vite.config.ts
```

---

## Notes

- **Mic permission**: Chrome will ask for microphone access when you first click the mic button — click Allow
- **Model download**: the AI model (~300MB) downloads once and is cached in your browser. You don't need to re-download it each time.
- **No internet needed** for AI inference — only for the initial model download from HuggingFace
