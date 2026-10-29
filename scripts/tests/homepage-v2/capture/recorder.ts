import { prepareFrames } from "./domFrames";

/** Record only our synthetic component surface. No screen/microphone permission,
 * authentication state, live CRM data, generated illustrations or external I/O. */
export async function recordSurface(node: HTMLElement, begin: () => void) {
  await document.fonts.ready;
  const frame = await prepareFrames(node);
  await frame.draw();
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
    .find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("Browser recording is unavailable");
  const stream = frame.canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("Capture encoding failed"));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });
  let frames = 0, drawMilliseconds = 0;
  const started = performance.now(); recorder.start(100); begin();
  try {
    while (performance.now() - started < 6000) {
      const drawing = performance.now(); await frame.draw();
      drawMilliseconds += performance.now() - drawing; frames++;
      await new Promise<void>(resolve => setTimeout(resolve, 12));
    }
    recorder.stop(); const blob = await stopped;
    return { blob, frames, elapsed: performance.now() - started, drawMilliseconds };
  } finally { stream.getTracks().forEach(track => track.stop()); }
}
