/**
 * AppShell — Task Pane 主布局
 *
 * 单面板设计：顶部栏（Logo + 齿轮配置入口）+ 写入面板。
 * 配置通过现有 i-Write 网页端完成。
 */
import { Button, makeStyles, tokens } from '@fluentui/react-components';
import { Settings24Regular } from '@fluentui/react-icons';

import WriteTab from './WriteTab';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  logo: {
    width: '28px',
    height: '28px',
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: tokens.fontWeightSemibold,
  },
  logoTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  body: {
    flex: 1,
    overflow: 'hidden',
  },
});

export default function AppShell() {
  const styles = useStyles();

  const handleSettingsClick = () => {
    window.open('http://localhost:5173/settings', '_blank');
  };

  return (
    <div className={styles.root}>
      {/* 顶部栏 */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logo}>i-W</div>
          <span className={styles.logoTitle}>i-Write</span>
        </div>
        <Button
          appearance="subtle"
          icon={<Settings24Regular />}
          size="small"
          title="打开 i-Write 配置"
          onClick={handleSettingsClick}
        />
      </div>

      {/* 写入面板 */}
      <div className={styles.body}>
        <WriteTab />
      </div>
    </div>
  );
}
