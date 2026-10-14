import { useState } from 'react';
import { appBuild, applyUpdate, checkUpdate, type AppBuild } from '../../app/updates';

export function AppVersion() {
  const [latest, setLatest] = useState<AppBuild | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const available = latest && latest.id !== appBuild.id;
  const run = async () => {
    setBusy(true);
    setStatus('');
    try {
      if (available) {
        await applyUpdate(latest);
      } else {
        const build = await checkUpdate();
        setLatest(build);
        setStatus(build.id === appBuild.id ? '已是最新版本' : '有新版本');
      }
    } catch (error) {
      setStatus(
        error instanceof Error && error.name === 'Error'
          ? error.message
          : available
            ? '更新失败，请联网后重试'
            : '检查失败，请联网后重试',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <footer className="app-version">
      <p>
        CookPilot v{appBuild.version} · {appBuild.revision}
      </p>
      <p>
        {import.meta.env.DEV ? '本地开发' : '构建于 '}
        {!import.meta.env.DEV && (
          <time dateTime={appBuild.builtAt}>
            {new Date(appBuild.builtAt).toLocaleString('zh-CN', { hour12: false })}
          </time>
        )}
      </p>
      {!import.meta.env.DEV && (
        <>
          <button className="text-button" disabled={busy} onClick={() => void run()}>
            {busy ? (available ? '正在更新…' : '正在检查…') : available ? '更新并刷新' : '检查更新'}
          </button>
          <p role="status">{status}</p>
        </>
      )}
    </footer>
  );
}
