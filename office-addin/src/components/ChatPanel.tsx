/**
 * ChatPanel — Chat 对话面板
 *
 * 用户输入文档需求，AI 返回大纲。
 */
import { useState, useRef, useEffect } from 'react';
import { Card, Textarea, Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { TextareaOnChangeData } from '@fluentui/react-components';
import { Send24Regular } from '@fluentui/react-icons';
import { apiClient } from '../services/apiClient';
import { readWorkbookContext } from '../services/contextReader';
import type { OutlineItem } from './WriteTab';

interface ChatMessage {
  role: 'user' | 'ai' | 'error';
  content: string;
}

interface ChatPanelProps {
  onOutlineGenerated: (outline: OutlineItem[], request: string) => void;
}

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    gap: tokens.spacingVerticalS,
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: `0 ${tokens.spacingHorizontalS}`,
  },
  messageUser: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
  },
  messageAi: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
  },
  messageError: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
  },
  bubbleError: {
    background: tokens.colorPaletteRedBackground2,
    color: tokens.colorPaletteRedForeground1,
  },
  bubble: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
  },
  bubbleUser: {
    background: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  bubbleAi: {
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
  },
  inputArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  inputRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
  },
  placeholder: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

export default function ChatPanel({ onOutlineGenerated }: ChatPanelProps) {
  const styles = useStyles();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'ai', content: '你好！请描述你的 Excel 生成需求。' },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // 读取当前工作簿上下文
      const workbookContext = await readWorkbookContext();

      const response = await apiClient.post('/chat', {
        message: trimmed,
        context: { documentContent: workbookContext },
      });

      const aiContent = response.data?.content ?? response.data?.message ?? '';
      const aiMsg: ChatMessage = { role: 'ai', content: aiContent };
      setMessages(prev => [...prev, aiMsg]);

      // 尝试从 AI 回复中提取大纲
      // 如果回复中包含 JSON 格式的大纲数据，触发大纲面板
      if (response.data?.outline) {
        const outlineItems: OutlineItem[] = response.data.outline.map(
          (item: { title: string; description?: string }, idx: number) => ({
            id: `outline-${idx}`,
            title: item.title,
            description: item.description,
          })
        );
        onOutlineGenerated(outlineItems, trimmed);
      }
    } catch (err) {
      const errorContent = err instanceof Error ? err.message : '请求失败';
      const errorMsg: ChatMessage = { role: 'error', content: errorContent };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.messages}>
        {messages.map((msg, idx) => (
          <div key={idx} className={msg.role === 'user' ? styles.messageUser : msg.role === 'error' ? styles.messageError : styles.messageAi}>
            <Card className={`${styles.bubble} ${
              msg.role === 'user' ? styles.bubbleUser :
              msg.role === 'error' ? styles.bubbleError :
              styles.bubbleAi
            }`}>
              <Text size={200}>{msg.content}</Text>
            </Card>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.inputArea}>
        <div className={styles.inputRow}>
          <Textarea
            value={input}
            onChange={(_: React.FormEvent<HTMLElement | HTMLTextAreaElement>, data: TextareaOnChangeData) => setInput(data.value ?? '')}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="例如：帮我生成一份 Q3 季度销售报告..."
            resize="vertical"
            rows={2}
            style={{ minHeight: 60 }}
          />
          <Button
            appearance="primary"
            icon={<Send24Regular />}
            disabled={loading || !input.trim()}
            onClick={handleSend}
            style={{ alignSelf: 'flex-end' }}
          >
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
