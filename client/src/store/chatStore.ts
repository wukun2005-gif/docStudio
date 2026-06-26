/**
 * Chat Zustand Store
 * 照搬 patentExaminator 的 chatSlice：write-through + load-on-mount
 */
import { create } from "zustand";
import { localIso } from "../../../shared/src/datetime.js";
import type { ChatSession, ChatMessage } from "../../../shared/src/types/chat.js";
import {
  createSession as repoCreateSession,
  updateSession as repoUpdateSession,
  deleteSession as repoDeleteSession,
  createMessage as repoCreateMessage,
  deleteMessagesBySessionId as repoDeleteMessages,
} from "../lib/chatRepo.js";

export interface ChatStore {
  sessions: ChatSession[];
  messages: ChatMessage[];
  activeSessionId: string | null;

  // Session 管理
  loadSessions: (sessions: ChatSession[]) => void;       // 从 DB 加载，不回写
  addSession: (session: ChatSession) => void;             // write-through
  removeSession: (id: string) => void;                    // 删除 session + messages
  renameSession: (id: string, title: string) => void;     // 更新标题

  // Message 管理
  loadMessages: (messages: ChatMessage[]) => void;        // 从 DB 加载，不回写
  addMessage: (message: ChatMessage) => void;             // write-through
  clearMessages: () => void;                              // 清空当前 session 消息

  // Active session
  setActiveSessionId: (id: string | null) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: [],
  messages: [],
  activeSessionId: null,

  loadSessions: (sessions) => set({ sessions }),

  addSession: (session) => {
    repoCreateSession(session).catch(console.error);
    set((prev) => ({ sessions: [session, ...prev.sessions] }));
  },

  removeSession: (id) => {
    repoDeleteSession(id).catch(console.error);
    repoDeleteMessages(id).catch(console.error);
    set((prev) => ({
      sessions: prev.sessions.filter((s) => s.id !== id),
      messages: prev.activeSessionId === id ? [] : prev.messages,
      activeSessionId: prev.activeSessionId === id ? null : prev.activeSessionId,
    }));
  },

  renameSession: (id, title) => {
    set((prev) => {
      const session = prev.sessions.find((s) => s.id === id);
      if (session) {
        const updated = { ...session, title, updatedAt: localIso() };
        repoUpdateSession(updated).catch(console.error);
        return {
          sessions: prev.sessions.map((s) => (s.id === id ? updated : s)),
        };
      }
      return {};
    });
  },

  loadMessages: (messages) => set({ messages }),

  addMessage: (message) => {
    repoCreateMessage(message).catch(console.error);
    set((prev) => ({ messages: [...prev.messages, message] }));
  },

  clearMessages: () => set({ messages: [] }),

  setActiveSessionId: (id) => set({ activeSessionId: id }),
}));
