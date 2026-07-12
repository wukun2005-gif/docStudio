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
  placeholder: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

const STORAGE_KEY = 'iwrite-addin-chat-history';

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ChatMessage[];
  } catch {}
  return [{ role: 'ai', content: '你好！请描述你的 Excel 生成需求。' }];
}

export default function ChatPanel({ onOutlineGenerated }: ChatPanelProps) {
  const styles = useStyles();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 持久化聊天记录
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  // 自动调整 textarea 高度
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = 200;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  };

  // input 变化时调整高度
  useEffect(() => {
    adjustTextareaHeight();
  }, [input]);

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

      // 后端返回 outline_request 类型时，提取 suggestedOutline 触发大纲面板
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
              placeholder="例如：帮我生成一份 Q3 季度销售报告..."
              resize="none"
              rows={1}
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
