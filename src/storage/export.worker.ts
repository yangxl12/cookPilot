import { exportSnapshot } from './exportSnapshot';

self.onmessage = async () => {
  try {
    self.postMessage({ blob: await exportSnapshot() });
  } catch {
    self.postMessage({ error: '导出失败，请重试' });
  }
};
