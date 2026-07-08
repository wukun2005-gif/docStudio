/**
 * WriteTab — 写入面板（占位组件）
 *
 * Phase 1 将实现完整的四阶段状态机：
 *   Chat → 大纲编辑 → 生成中 → 结果展示
 *
 * 当前为 Phase 0 占位，验证 Fluent UI 渲染。
 */
import { Card, Text, makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    padding: '12px',
    gap: tokens.spacingVerticalM,
    height: '100%',
  },
  welcome: {
    padding: '16px',
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground2,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

export default function WriteTab() {
  const styles = useStyles();

  return (
    <div className={styles.container}>
      <Card className={styles.welcome}>
        <Text block weight="semibold" style={{ marginBottom: 8 }}>
          i-Write Excel Add-in
        </Text>
        <Text block className={styles.hint}>
          Phase 0 基础设施搭建完成。
          后续 Phase 将实现 Chat 对话、大纲编辑、文档生成、评估结果等完整功能。
        </Text>
      </Card>

      <Card>
        <Text block size={200} className={styles.hint}>
          请在 Excel 工作簿中选择一个单元格，然后使用 i-Write 生成文档。
        </Text>
      </Card>
    </div>
  );
}
