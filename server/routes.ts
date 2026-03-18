import type { Express } from "express";
import { Server } from "http";
import { storage } from "./storage";
import { insertSessionSchema, insertMessageSchema } from "@shared/schema";

// Personality system prompts
const PERSONALITY_PROMPTS: Record<string, string> = {
  friendly: `You are Alex, a warm and supportive English-speaking friend. You speak naturally, use contractions, and encourage the user. If you notice grammar mistakes, gently correct them with a note like "By the way, we'd usually say...". Keep responses conversational and under 4 sentences unless the topic needs more.`,
  teacher: `You are Sarah, a professional English teacher. You are patient, clear, and focus on correct grammar and vocabulary. Always note grammar mistakes politely and explain the correct form. Use teaching phrases like "Great try! The correct form is..." or "Notice how we use...". Keep explanations brief and encouraging.`,
  debate: `You are Jordan, an articulate debate partner. You challenge the user's arguments respectfully and present counter-arguments to help them think critically. Use phrases like "That's an interesting point, but consider...", "Have you thought about...". Stay focused on the argument, not the person.`,
  interviewer: `You are a professional HR interviewer at a top tech company. Ask structured behavioral interview questions (STAR method), follow up on vague answers, and give brief feedback after each response. Be professional, slightly formal, and constructive.`,
  casual: `You are Sam, a laid-back casual friend who chats about everyday life, pop culture, movies, sports, and fun topics. Keep it relaxed, use slang occasionally, and make the conversation feel like texting a friend. Respond naturally and keep it short and fun.`,
};

// Mode-specific instructions
const MODE_INSTRUCTIONS: Record<string, string> = {
  conversation: "Have a free-flowing natural conversation on any topic the user brings up.",
  interview: "Conduct a job interview. Start by introducing the role and asking the first interview question. Ask follow-up questions based on responses.",
  daily: "Practice everyday English scenarios like ordering food, shopping, making plans, or discussing daily life. Set the scene naturally.",
  debate: "Pick a debatable topic and present a position. Defend it and challenge the user's counter-arguments.",
  story: "Collaboratively build a story. Start with a scene, then continue the story based on what the user adds. Keep it fun and creative.",
};

type ConversationMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

async function callOllama(messages: ConversationMessage[], model = "llama3.2"): Promise<string> {
  try {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: 0.8,
          num_predict: 200,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const data = await response.json() as { message?: { content?: string } };
    return data.message?.content ?? "I couldn't generate a response. Please check if Ollama is running.";
  } catch (err) {
    const error = err as Error;
    if (error.message.includes("ECONNREFUSED") || error.message.includes("fetch")) {
      return "⚠️ Ollama is not running. Please start Ollama locally (`ollama serve`) and make sure you have a model installed (`ollama pull llama3.2`). Once running, your messages will be processed locally.";
    }
    throw err;
  }
}

async function analyzeGrammar(userText: string): Promise<{ corrections: string[]; suggestions: string[] }> {
  const prompt = `Analyze this English text for grammar and vocabulary errors. Return a JSON object ONLY with two arrays: "corrections" (specific grammar mistakes found with corrections) and "suggestions" (vocabulary improvement ideas). Keep each item under 15 words. If the text is correct, return empty arrays.

Text: "${userText}"

Return only valid JSON like: {"corrections":[],"suggestions":[]}`;

  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 300 },
      }),
    });

    if (!response.ok) return { corrections: [], suggestions: [] };

    const data = await response.json() as { response?: string };
    const text = data.response ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { corrections: [], suggestions: [] };

    const parsed = JSON.parse(jsonMatch[0]) as { corrections?: string[]; suggestions?: string[] };
    return {
      corrections: Array.isArray(parsed.corrections) ? parsed.corrections.slice(0, 3) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [],
    };
  } catch {
    return { corrections: [], suggestions: [] };
  }
}

export async function registerRoutes(httpServer: Server, app: Express) {
  // Create a new session
  app.post("/api/sessions", async (req, res) => {
    try {
      const data = insertSessionSchema.parse(req.body);
      const session = await storage.createSession(data);
      res.json(session);
    } catch (err) {
      res.status(400).json({ error: "Invalid session data" });
    }
  });

  // Get a session
  app.get("/api/sessions/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const session = await storage.getSession(id);
    if (!session) return res.status(404).json({ error: "Not found" });
    res.json(session);
  });

  // Get session messages
  app.get("/api/sessions/:id/messages", async (req, res) => {
    const id = parseInt(req.params.id);
    const messages = await storage.getMessages(id);
    res.json(messages);
  });

  // Clear session messages
  app.delete("/api/sessions/:id/messages", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.clearMessages(id);
    res.json({ ok: true });
  });

  // Send a message and get AI response
  app.post("/api/sessions/:id/chat", async (req, res) => {
    const sessionId = parseInt(req.params.id);
    const { content } = req.body as { content: string };

    if (!content?.trim()) {
      return res.status(400).json({ error: "Message content required" });
    }

    const session = await storage.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Store user message
    const userMsg = await storage.addMessage({
      sessionId,
      role: "user",
      content: content.trim(),
      feedback: null,
    });

    // Analyze grammar in background (non-blocking)
    const feedbackPromise = analyzeGrammar(content.trim());

    // Build conversation history
    const history = await storage.getMessages(sessionId);
    const personality = PERSONALITY_PROMPTS[session.personality] ?? PERSONALITY_PROMPTS.friendly;
    const modeInstr = MODE_INSTRUCTIONS[session.mode] ?? MODE_INSTRUCTIONS.conversation;

    const systemPrompt = `${personality}\n\nMode: ${modeInstr}\n\nIMPORTANT: Respond naturally in 2-4 sentences. Do not use markdown. Be conversational.`;

    const ollamaMessages: ConversationMessage[] = [
      { role: "system", content: systemPrompt },
      ...history.slice(-10).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    // Get AI response
    const aiText = await callOllama(ollamaMessages);

    // Wait for feedback
    const feedback = await feedbackPromise;

    // Update user message with feedback
    await storage.addMessage({
      sessionId,
      role: "user",
      content: content.trim(),
      feedback: JSON.stringify(feedback),
    });

    // Store assistant message
    const assistantMsg = await storage.addMessage({
      sessionId,
      role: "assistant",
      content: aiText,
      feedback: null,
    });

    res.json({
      userMessage: { ...userMsg, feedback: JSON.stringify(feedback) },
      assistantMessage: assistantMsg,
      feedback,
    });
  });

  // Check Ollama status
  app.get("/api/ollama/status", async (_req, res) => {
    try {
      const response = await fetch("http://localhost:11434/api/tags");
      if (response.ok) {
        const data = await response.json() as { models?: Array<{ name: string }> };
        const models = data.models?.map(m => m.name) ?? [];
        res.json({ running: true, models });
      } else {
        res.json({ running: false, models: [] });
      }
    } catch {
      res.json({ running: false, models: [] });
    }
  });
}
