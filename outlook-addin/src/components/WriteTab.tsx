/**
 * WriteTab — 写入面板状态机
 *
 * 四个阶段：chat → outline → generating → results
 * 严格对齐 word-addin 的 WriteTab 模式。
 * 聊天消息状态提升到 WriteTab，跨阶段持久化。
 */
import { useState, useCallback } from 'react';
import ChatPanel, { type ChatMessage } from './ChatPanel';
import OutlinePanel from './OutlinePanel';
import WriteProgress, { type GenerationSection } from './WriteProgress';
import ResultsPanel from './ResultsPanel';

export interface OutlineItem {
  id: string;
  title: string;
  description?: string;
}

export type WriteStage = 'chat' | 'outline' | 'generating' | 'results';

const STORAGE_KEY = 'iwrite-outlook-addin-chat-history';

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ChatMessage[];
  } catch {}
  return [{ id: 'welcome', role: 'ai', content: '你好！请描述你的邮件生成需求。', timestamp: Date.now() }];
}

export default function WriteTab() {
  const [stage, setStage] = useState<WriteStage>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [runId, setRunId] = useState<string>('');
  const [sections, setSections] = useState<GenerationSection[]>([]);
  const [userRequest, setUserRequest] = useState('');

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => {
      const next = [...prev, { ...msg, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), timestamp: Date.now() }];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-50))); } catch {}
      return next;
    });
  }, []);

  const setMessagesDirect = useCallback((updater: React.SetStateAction<ChatMessage[]>) => {
    setMessages(prev => {
      const next = typeof updater === 'function' ? (updater as (p: ChatMessage[]) => ChatMessage[])(prev) : updater;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-50))); } catch {}
      return next;
    });
  }, []);

  const handleOutlineGenerated = (newOutline: OutlineItem[], request: string) => {
    setOutline(newOutline);
    setUserRequest(request);
    setStage('outline');
  };

  const handleConfirmGenerate = () => {
    setStage('generating');
  };

  const handleGenerationComplete = (newRunId: string, newSections: GenerationSection[]) => {
    setRunId(newRunId);
    setSections(newSections);
    setStage('results');
  };

  const handleRegenerate = () => {
    setStage('chat');
  };

  switch (stage) {
    case 'chat':
      return (
        <ChatPanel
          messages={messages}
          onMessagesChange={setMessagesDirect}
          onAddMessage={addMessage}
          onOutlineGenerated={handleOutlineGenerated}
        />
      );
    case 'outline':
      return (
        <OutlinePanel
          outline={outline}
          onOutlineChange={setOutline}
          onConfirm={handleConfirmGenerate}
          onBack={() => setStage('chat')}
        />
      );
    case 'generating':
      return (
        <WriteProgress
          outline={outline}
          userRequest={userRequest}
          onComplete={handleGenerationComplete}
        />
      );
    case 'results':
      return (
        <ResultsPanel
          runId={runId}
          sections={sections}
          onRegenerate={handleRegenerate}
        />
      );
  }
}
