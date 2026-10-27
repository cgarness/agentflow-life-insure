import { useCallback, useEffect, useRef, useState } from "react";
import { sheetsApi, SheetsApiError } from "@/lib/google-sheets/api";
import { previewKey, type PreviewState, type PreviewTarget } from "@/lib/google-sheets/previewGate";
import type { PreviewResult, SourceDraftV2 } from "@/lib/google-sheets/schema";

/**
 * The v2 preview, owned by the dialog so Save / Enable can depend on it. The request body IS the key, every request
 * is numbered, and only the latest request's response is applied: a slow or out-of-order response for an earlier
 * draft is dropped. Leaving the preview step discards any request in flight.
 */
export function usePreviewV2(target: PreviewTarget | null, draft: SourceDraftV2, active: boolean) {
  const key = target ? previewKey(draft, target) : null;
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const run = useCallback(async () => {
    if (!key) return;
    const n = ++seq.current;
    setState({ status: "loading", key });
    try {
      const data = await sheetsApi<PreviewResult>("preview", JSON.parse(key));
      if (alive.current && n === seq.current) setState({ status: "ready", key, data });
    } catch (e) {
      if (alive.current && n === seq.current) {
        setState({ status: "error", key, message: e instanceof SheetsApiError ? e.message : "Couldn't load a preview.",
          code: e instanceof SheetsApiError ? e.code : null });
      }
    }
  }, [key]);

  useEffect(() => {
    if (active) { void run(); return; }
    seq.current++;
    setState({ status: "idle" });
  }, [active, run]);

  return { state, key, retry: run };
}
