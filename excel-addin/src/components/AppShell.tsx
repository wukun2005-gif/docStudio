/**
 * AppShell — Task Pane 主布局
 *
 * 单面板设计：顶部栏（Logo + 齿轮配置入口）+ 写入面板。
 * 配置通过现有 i-Write 网页端完成。
 */
import { useState } from 'react';
import { Button, makeStyles, tokens } from '@fluentui/react-components';
import { Settings24Regular, ArrowCounterclockwise24Regular } from '@fluentui/react-icons';

import WriteTab from './WriteTab';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100%',
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
    fontSize: '13px',
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  body: {
    flex: 1,
    width: '100%',
    overflow: 'auto',
  },
});

export default function AppShell() {
  const styles = useStyles();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSettingsClick = () => {
    window.open('http://localhost:5173/settings', '_blank');
  };

  const handleRefresh = () => {
    // 通过改变 key 重新挂载 WriteTab，比 window.location.reload() 快 10 倍+
    setRefreshKey(k => k + 1);
  };

  return (
    <div className={styles.root}>
      {/* 顶部栏 */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logoTitle}>i-Write, Doc Generation with Knowledge</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            appearance="subtle"
            icon={<ArrowCounterclockwise24Regular />}
            size="small"
            title="刷新 Task Pane"
            onClick={handleRefresh}
          />
          <Button
            appearance="subtle"
            icon={<Settings24Regular />}
            size="small"
            title="打开 i-Write 配置"
            onClick={handleSettingsClick}
          />
        </div>
      </div>

      {/* 写入面板 */}
      <div className={styles.body}>
        <WriteTab key={refreshKey} onSettingsClick={handleSettingsClick} />
      </div>
    </div>
  );
}
