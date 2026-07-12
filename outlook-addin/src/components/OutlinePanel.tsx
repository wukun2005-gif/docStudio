/**
 * OutlinePanel — 显示生成的大纲（stub 模式写死 3 段，符合 case-1782296242386 实际数据）
 */
import { tokens, Card, Badge } from "@fluentui/react-components";

export interface OutlinePanelProps {
  outline: Array<{ title: string; description?: string }>;
  userRequest: string;
}

export function OutlinePanel({ outline, userRequest }: OutlinePanelProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3 }}>
        你的需求：<span style={{ color: tokens.colorNeutralForeground1 }}>{userRequest}</span>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>
        邮件大纲（{outline.length} 段）
      </div>

      {outline.map((section, i) => (
        <Card key={i} style={{ padding: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Badge appearance="tint" color="brand" size="small">
              {i + 1}
            </Badge>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{section.title}</div>
          </div>
          {section.description && (
            <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3, paddingLeft: 26 }}>
              {section.description}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
