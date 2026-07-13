/**
 * ChatPanel — Chat 对话面板
 *
 * 用户输入邮件需求，AI 返回大纲。
 * 严格对齐 word-addin 的 ChatPanel 模式。
 * 消息状态由父组件(WriteTab)管理，跨阶段持久化。
 */
import { useState, useRef, useEffect } from 'react';
import { Card, Textarea, Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { TextareaOnChangeData } from '@fluentui/react-components';
import { Send24Regular } from '@fluentui/react-icons';
import { apiClient } from '../services/apiClient';
import type { OutlineItem } from './WriteTab';

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai' | 'error';
  content: string;
  timestamp: number;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onMessagesChange: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  onAddMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  onOutlineGenerated: (outline: OutlineItem[], request: string) => void;
}

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
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
    alignItems: 'flex-end',
    position: 'relative',
  },
  textareaWrap: {
    flex: 1,
    width: '100%',
    position: 'relative',
  },
  sendButton: {
    position: 'absolute',
    right: '6px',
    bottom: '6px',
    width: '28px',
    height: '28px',
    minWidth: '28px',
    padding: 0,
    borderRadius: tokens.borderRadiusCircular,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
});

export default function ChatPanel({ messages, onMessagesChange, onAddMessage, onOutlineGenerated }: ChatPanelProps) {
  const styles = useStyles();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = 200;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [input]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, loading]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    // Add user message immediately
    onAddMessage({ role: 'user', content: trimmed });
    setInput('');
    setLoading(true);

    try {
      const response = await apiClient.post('/chat', {
        message: trimmed,
        format: 'email',
        providerPreference: ['stub'],
      });

      const aiContent = response.data?.reply ?? response.data?.content ?? response.data?.message ?? '';
      onAddMessage({ role: 'ai', content: aiContent });

      const suggestedOutline = response.data?.suggestedOutline ?? response.data?.outline;
      if (response.data?.type === 'outline_request' && suggestedOutline) {
        const outlineItems: OutlineItem[] = suggestedOutline.map(
          (item: { id?: string; title: string; description?: string }, idx: number) => ({
            id: item.id ?? `outline-${idx}`,
            title: item.title,
            description: item.description,
          })
        );
        onOutlineGenerated(outlineItems, trimmed);
      }
    } catch (err) {
      const errorContent = err instanceof Error ? err.message : '请求失败';
      onAddMessage({ role: 'error', content: errorContent });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.messages}>
        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === 'user' ? styles.messageUser : msg.role === 'error' ? styles.messageError : styles.messageAi}>
            <Card className={`${styles.bubble} ${
              msg.role === 'user' ? styles.bubbleUser :
              msg.role === 'error' ? styles.bubbleError :
              styles.bubbleAi
            }`}>
              <Text size={200}>{msg.content}</Text>
            </Card>
          </div>
        ))}
        {loading && (
          <div className={styles.messageAi}>
            <Card className={`${styles.bubble} ${styles.bubbleAi}`}>
              <Text size={200}>正在生成大纲…</Text>
            </Card>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.inputArea}>
        <div className={styles.inputRow}>
          <div className={styles.textareaWrap}>
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(_: React.FormEvent<HTMLElement | HTMLTextAreaElement>, data: TextareaOnChangeData) => setInput(data.value ?? '')}
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="例如：帮我写一封邮件汇报本周工作进展..."
              resize="none"
              rows={1}
              disabled={loading}
              style={{ minHeight: 40, width: '100%', overflowY: 'auto', paddingRight: 40 }}
            />
            <Button
              appearance="primary"
              icon={<Send24Regular style={{ width: 14, height: 14 }} />}
              disabled={loading || !input.trim()}
              onClick={handleSend}
              className={styles.sendButton}
              title="发送"
              aria-label="发送"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
