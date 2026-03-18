import type { Session, InsertSession, Message, InsertMessage } from "@shared/schema";

export interface IStorage {
  createSession(data: InsertSession): Promise<Session>;
  getSession(id: number): Promise<Session | undefined>;
  addMessage(data: InsertMessage): Promise<Message>;
  getMessages(sessionId: number): Promise<Message[]>;
  clearMessages(sessionId: number): Promise<void>;
}

export class MemStorage implements IStorage {
  private sessions: Map<number, Session> = new Map();
  private messages: Map<number, Message[]> = new Map();
  private nextSessionId = 1;
  private nextMessageId = 1;

  async createSession(data: InsertSession): Promise<Session> {
    const session: Session = {
      id: this.nextSessionId++,
      personality: data.personality ?? "friendly",
      mode: data.mode ?? "conversation",
      createdAt: new Date(),
    };
    this.sessions.set(session.id, session);
    this.messages.set(session.id, []);
    return session;
  }

  async getSession(id: number): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async addMessage(data: InsertMessage): Promise<Message> {
    const message: Message = {
      id: this.nextMessageId++,
      sessionId: data.sessionId,
      role: data.role,
      content: data.content,
      feedback: data.feedback ?? null,
      createdAt: new Date(),
    };
    const list = this.messages.get(data.sessionId) ?? [];
    list.push(message);
    this.messages.set(data.sessionId, list);
    return message;
  }

  async getMessages(sessionId: number): Promise<Message[]> {
    return this.messages.get(sessionId) ?? [];
  }

  async clearMessages(sessionId: number): Promise<void> {
    this.messages.set(sessionId, []);
  }
}

export const storage = new MemStorage();
