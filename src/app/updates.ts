export const appBuild = __APP_BUILD__;
export type AppBuild = typeof appBuild;

export async function checkUpdate(): Promise<AppBuild> {
  const url = new URL(`${import.meta.env.BASE_URL}version.json`, location.origin);
  url.searchParams.set('check', Date.now().toString());
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('检查失败，请稍后重试');
  const build = await response.json();
  if (
    !build ||
    typeof build.id !== 'string' ||
    !build.id ||
    typeof build.version !== 'string' ||
    typeof build.revision !== 'string' ||
    typeof build.builtAt !== 'string' ||
    !Number.isFinite(Date.parse(build.builtAt))
  )
    throw new Error('版本信息暂不可用，请稍后重试');
  return build;
}

function waitForWorker(worker: ServiceWorker, state: 'installed' | 'activated'): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', onState);
    };
    const onState = () => {
      if (worker.state === state || worker.state === 'activated') {
        cleanup();
        resolve();
      } else if (worker.state === 'redundant') {
        cleanup();
        reject(new Error('更新未完成，请稍后重试'));
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('更新超时，请稍后重试'));
    }, 20000);
    worker.addEventListener('statechange', onState);
    onState();
  });
}

export async function applyUpdate(build: AppBuild): Promise<void> {
  // Only called by the explicit refresh button; never interrupt cooking automatically.
  if ('serviceWorker' in navigator) {
    const registration =
      (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)) ??
      (await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        updateViaCache: 'none',
      }));
    await registration.update();
    if (registration.installing) await waitForWorker(registration.installing, 'installed');
    const waiting = registration.waiting;
    if (waiting) {
      const activated = waitForWorker(waiting, 'activated');
      waiting.postMessage({ type: 'SKIP_WAITING' });
      await activated;
    } else if (!registration.active || registration.active === navigator.serviceWorker.controller) {
      throw new Error('新版尚未准备好，请稍后重试');
    }
  }
  const url = new URL(location.href);
  url.searchParams.set('v', build.id);
  location.replace(url.href);
}
