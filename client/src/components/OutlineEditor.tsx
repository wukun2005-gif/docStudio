import { useState } from "react";

interface OutlineSection {
  id: string;
  title: string;
  level: number;
  children: OutlineSection[];
  description?: string;
}

interface OutlineEditorProps {
  outline: OutlineSection[];
  onChange: (outline: OutlineSection[]) => void;
  onGenerate: () => void;
}

export default function OutlineEditor({ outline, onChange, onGenerate }: OutlineEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  function handleEdit(section: OutlineSection) {
    setEditingId(section.id);
    setEditTitle(section.title);
  }

  function handleSave() {
    if (editingId && editTitle.trim()) {
      onChange(renameSection(outline, editingId, editTitle.trim()));
    }
    setEditingId(null);
  }

  function handleDelete(id: string) {
    onChange(deleteSection(outline, id));
  }

  function handleMove(id: string, direction: "up" | "down") {
    onChange(moveSection(outline, id, direction));
  }

  function handleAdd(parentId?: string) {
    const newTitle = "新章节";
    onChange(addSection(outline, parentId ?? null, newTitle));
  }

  return (
    <div className="bg-white">
      <div className="px-4 py-2 flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => handleAdd()}
            className="px-2.5 py-1 text-xs border rounded hover:bg-gray-50 transition-colors"
          >
            + 添加章节
          </button>
          <button
            id="demo-generate-btn"
            onClick={onGenerate}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            🚀 一键生成
          </button>
        </div>
      </div>

      <div className="divide-y">
        {outline.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            暂无大纲，请先通过 Chat 生成或手动添加
          </div>
        ) : (
          outline.map((section) => (
            <OutlineItem
              key={section.id}
              section={section}
              editingId={editingId}
              editTitle={editTitle}
              setEditTitle={setEditTitle}
              onEdit={handleEdit}
              onSave={handleSave}
              onDelete={handleDelete}
              onMove={handleMove}
              onAdd={handleAdd}
            />
          ))
        )}
      </div>
    </div>
  );
}

function OutlineItem({
  section,
  editingId,
  editTitle,
  setEditTitle,
  onEdit,
  onSave,
  onDelete,
  onMove,
  onAdd,
  depth = 0,
}: {
  section: OutlineSection;
  editingId: string | null;
  editTitle: string;
  setEditTitle: (s: string) => void;
  onEdit: (s: OutlineSection) => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  onMove: (id: string, d: "up" | "down") => void;
  onAdd: (parentId?: string) => void;
  depth?: number;
}) {
  const isEditing = editingId === section.id;

  return (
    <div>
      <div
        className="group px-4 py-2 flex items-center gap-2 hover:bg-gray-50"
        style={{ paddingLeft: `${16 + depth * 24}px` }}
      >
        <span className="text-gray-400 text-xs w-8">{section.id}</span>

        {isEditing ? (
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSave()}
            onBlur={onSave}
            autoFocus
            className="flex-1 border rounded px-2 py-1 text-sm"
          />
        ) : (
          <span
            className="flex-1 cursor-pointer hover:text-blue-600"
            onClick={() => onEdit(section)}
          >
            {section.title}
          </span>
        )}

        <div className="flex gap-1 opacity-0 group-hover:opacity-100">
          <button onClick={() => onMove(section.id, "up")} className="text-gray-400 hover:text-gray-600 text-xs" title="上移">↑</button>
          <button onClick={() => onMove(section.id, "down")} className="text-gray-400 hover:text-gray-600 text-xs" title="下移">↓</button>
          <button onClick={() => onAdd(section.id)} className="text-gray-400 hover:text-green-600 text-xs" title="添加子章节">+</button>
          <button onClick={() => onDelete(section.id)} className="text-gray-400 hover:text-red-600 text-xs" title="删除">×</button>
        </div>
      </div>

      {section.children.length > 0 && (
        <div>
          {section.children.map((child) => (
            <OutlineItem
              key={child.id}
              section={child}
              editingId={editingId}
              editTitle={editTitle}
              setEditTitle={setEditTitle}
              onEdit={onEdit}
              onSave={onSave}
              onDelete={onDelete}
              onMove={onMove}
              onAdd={onAdd}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 大纲操作工具函数 ──────────────────────────────────

function addSection(outline: OutlineSection[], parentId: string | null, title: string): OutlineSection[] {
  const newId = `s${Math.random().toString(36).slice(2, 6)}`;
  const newSection: OutlineSection = { id: newId, title, level: 1, children: [] };

  if (!parentId) {
    return [...outline, newSection];
  }

  return outline.map((s) => addSectionRecursive(s, parentId, newSection));
}

function addSectionRecursive(section: OutlineSection, parentId: string, newSection: OutlineSection): OutlineSection {
  if (section.id === parentId) {
    return { ...section, children: [...section.children, { ...newSection, level: section.level + 1 }] };
  }
  return { ...section, children: section.children.map((c) => addSectionRecursive(c, parentId, newSection)) };
}

function deleteSection(outline: OutlineSection[], sectionId: string): OutlineSection[] {
  return outline
    .filter((s) => s.id !== sectionId)
    .map((s) => ({ ...s, children: deleteSection(s.children, sectionId) }));
}

function renameSection(outline: OutlineSection[], sectionId: string, newTitle: string): OutlineSection[] {
  return outline.map((s) => {
    if (s.id === sectionId) return { ...s, title: newTitle };
    return { ...s, children: renameSection(s.children, sectionId, newTitle) };
  });
}

function moveSection(outline: OutlineSection[], sectionId: string, direction: "up" | "down"): OutlineSection[] {
  const idx = outline.findIndex((s) => s.id === sectionId);
  if (idx === -1) {
    return outline.map((s) => ({ ...s, children: moveSection(s.children, sectionId, direction) }));
  }

  const newOutline = [...outline];
  if (direction === "up" && idx > 0) {
    [newOutline[idx - 1], newOutline[idx]] = [newOutline[idx], newOutline[idx - 1]];
  } else if (direction === "down" && idx < newOutline.length - 1) {
    [newOutline[idx], newOutline[idx + 1]] = [newOutline[idx + 1], newOutline[idx]];
  }
  return newOutline;
}
