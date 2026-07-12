/**
 * WriteTab — 写入面板状态机
 *
 * 四个阶段：chat → outline → generating → results
 */
import { useState } from 'react';
import ChatPanel from './ChatPanel';
import OutlinePanel from './OutlinePanel';
import WriteProgress from './WriteProgress';
import ResultsPanel from './ResultsPanel';

export interface OutlineItem {
  id: string;
  title: string;
  description?: string;
}

export interface GenerationSection {
  title: string;
  content: string;
  groundingScore: number;
  sources: Array<{ chunkId: string; score: number; sourceName?: string }>;
}

export type WriteStage = 'chat' | 'outline' | 'generating' | 'results';

interface WriteTabProps {
  onSettingsClick: () => void;
}

export default function WriteTab({ onSettingsClick }: WriteTabProps) {
  const [stage, setStage] = useState<WriteStage>('chat');
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [runId, setRunId] = useState<string>('');
  const [sections, setSections] = useState<GenerationSection[]>([]);
  const [userRequest, setUserRequest] = useState('');

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
      return <ChatPanel onOutlineGenerated={handleOutlineGenerated} />;
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
          onSettingsClick={onSettingsClick}
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
