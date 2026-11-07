/// <reference lib="webworker" />
import { scanSource, type ImportSource } from '../lib/importCore';

self.onmessage = async (ev: MessageEvent<{ source: ImportSource; maxAttachmentBytes: number }>) => {
  const { source, maxAttachmentBytes } = ev.data;
  try {
    let last = 0;
    const result = await scanSource(source, {
      maxAttachmentBytes,
      onProgress: (done, total, current) => {
        const now = Date.now();
        if (now - last > 80 || done === total) { last = now; postMessage({ type: 'progress', done, total, current }); }
      },
    });
    postMessage({ type: 'done', result });
  } catch (e) {
    postMessage({ type: 'error', error: (e as Error).message || String(e) });
  }
};
