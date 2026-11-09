let pending: Promise<Blob> | undefined;

export function exportDownload(): Promise<Blob> {
  return (pending ??= new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new Error('导出超时，请重试'));
    }, 120000);
    worker.onerror = () => {
      finish();
      reject(new Error('导出失败，请重试'));
    };
    worker.onmessage = ({ data }: MessageEvent<{ blob?: Blob; error?: string }>) => {
      finish();
      if (data.blob) resolve(data.blob);
      else reject(new Error(data.error ?? '导出失败，请重试'));
    };
    worker.postMessage({});
  }).finally(() => {
    pending = undefined;
  }));
}
