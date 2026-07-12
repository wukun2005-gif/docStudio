/**
 * OutlinePanel — 大纲编辑面板
 *
 * 支持拖拽排序、编辑标题、删除、添加章节。
 */
import { useState } from 'react';
import { Button, Text, makeStyles, tokens, Input } from '@fluentui/react-components';
import { ArrowUp24Regular, ArrowDown24Regular, Dismiss24Regular, Add24Regular, Checkmark24Regular } from '@fluentui/react-icons';
import type { OutlineItem } from './WriteTab';

interface OutlinePanelProps {
  outline: OutlineItem[];
  onOutlineChange: (outline: OutlineItem[]) => void;
  onConfirm: () => void;
  onBack: () => void;
}

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    gap: tokens.spacingVerticalS,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    padding: `0 ${tokens.spacingHorizontalS}`,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  numberBadge: {
    width: '20px',
    height: '20px',
    borderRadius: tokens.borderRadiusLarge,
    background: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    fontSize: tokens.fontSizeBase200,
  },
  editInput: {
    flex: 1,
  },
  iconBtn: {
    cursor: 'pointer',
    color: tokens.colorNeutralForeground3,
    display: 'flex',
    alignItems: 'center',
    padding: '2px',
    background: 'none',
    border: 'none',
    borderRadius: tokens.borderRadiusSmall,
    minWidth: '24px',
  },
  footer: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
  },
});

export default function OutlinePanel({ outline, onOutlineChange, onConfirm, onBack }: OutlinePanelProps) {
  const styles = useStyles();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= outline.length) return;
    const next = [...outline];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    onOutlineChange(next);
  };

  const handleDelete = (id: string) => {
    onOutlineChange(outline.filter(item => item.id !== id));
  };

  const handleAdd = () => {
    const newItem: OutlineItem = {
      id: `outline-${Date.now()}`,
      title: '新章节',
    };
    onOutlineChange([...outline, newItem]);
    setEditingId(newItem.id);
    setEditTitle('新章节');
  };

  const handleEdit = (item: OutlineItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
  };

  const handleEditSave = () => {
    if (editingId && editTitle.trim()) {
      onOutlineChange(outline.map(item =>
        item.id === editingId ? { ...item, title: editTitle.trim() } : item
      ));
    }
    setEditingId(null);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text weight="semibold" size={300}>大纲编辑</Text>
        <Text size={100} className={styles.hint}>可拖拽调整顺序</Text>
      </div>

      <div className={styles.list}>
        {outline.map((item, idx) => (
          <div key={item.id} className={styles.item}>
            <div className={styles.numberBadge}>{idx + 1}</div>

            {editingId === item.id ? (
              <>
                <Input
                  value={editTitle}
                  onChange={(_, data) => setEditTitle(data.value ?? '')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEditSave();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className={styles.editInput}
                  size="small"
                  autoFocus
                />
                <button className={styles.iconBtn} onClick={handleEditSave}>
                  <Checkmark24Regular />
                </button>
              </>
            ) : (
              <Text
                className={styles.title}
                onClick={() => handleEdit(item)}
                style={{ cursor: 'pointer' }}
              >
                {item.title}
              </Text>
            )}

            <button
              className={styles.iconBtn}
              onClick={() => handleMove(idx, 'up')}
              disabled={idx === 0}
              title="上移"
            >
              <ArrowUp24Regular />
            </button>
            <button
              className={styles.iconBtn}
              onClick={() => handleMove(idx, 'down')}
              disabled={idx === outline.length - 1}
              title="下移"
            >
              <ArrowDown24Regular />
            </button>
            <button className={styles.iconBtn} onClick={() => handleDelete(item.id)} title="删除">
              <Dismiss24Regular />
            </button>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <Button appearance="subtle" icon={<Add24Regular />} onClick={handleAdd}>
          添加章节
        </Button>
        <Button appearance="secondary" onClick={onBack} style={{ marginLeft: 'auto' }}>
          返回
        </Button>
        <Button appearance="primary" onClick={onConfirm} disabled={outline.length === 0}>
          确认并生成
        </Button>
      </div>
    </div>
  );
}