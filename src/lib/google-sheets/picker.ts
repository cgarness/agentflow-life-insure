// Google Picker loader. The access token is passed in from a fresh server call and is never stored:
// not in browser storage, React Query, component state or logs.

interface PickerWindow extends Window {
  gapi?: { load: (name: string, config: { callback: () => void; onerror: () => void }) => void };
  google?: { picker: any };
}

export type PickerErrorCode = "load_failed" | "load_timeout" | "picker_error" | "page_busy";

/** A Picker failure. `code` is safe to log; it never carries the token or Google's payload. */
export class PickerError extends Error {
  constructor(public code: PickerErrorCode) { super(code); }
}

/** Budget for the script plus the picker library. Any failure clears the cache, so a retry starts fresh. */
export const PICKER_LOAD_TIMEOUT_MS = 15_000;

let loading: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  const w = window as PickerWindow;
  if (w.google?.picker) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      let script: HTMLScriptElement | null = null;
      const fail = (code: PickerErrorCode) => {
        clearTimeout(timer); loading = null; script?.remove(); reject(new PickerError(code));
      };
      const timer = setTimeout(() => fail("load_timeout"), PICKER_LOAD_TIMEOUT_MS);
      const loadLibrary = () => {
        if (!w.gapi) return fail("load_failed");
        w.gapi.load("picker", { callback: () => { clearTimeout(timer); resolve(); }, onerror: () => fail("load_failed") });
      };
      if (w.gapi) return loadLibrary();
      script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.onload = loadLibrary;
      script.onerror = () => fail("load_failed");
      document.head.appendChild(script);
    });
  }
  return loading;
}

/** Loads the Picker library (bounded) without showing anything, so no token is minted for a Picker that can't load. */
export const preparePicker = loadPicker;

export const pickerConfigured = () =>
  Boolean(import.meta.env.VITE_GOOGLE_PICKER_API_KEY && import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_NUMBER);

/**
 * Opens the Picker (spreadsheets only, single select, list view). Settles exactly once and disposes the Picker on
 * every outcome: resolves the file when picked, null when cancelled or `signal` aborts, and rejects with
 * PickerError("picker_error") when Google reports an error. The caller must not show it over a modal layer.
 */
export async function pickSpreadsheet(accessToken: string, signal?: AbortSignal): Promise<{ id: string; name: string } | null> {
  await loadPicker();
  if (signal?.aborted) return null;
  const g = (window as PickerWindow).google!.picker;
  return new Promise((resolve, reject) => {
    let picker: { setVisible: (v: boolean) => void; dispose: () => void } | null = null;
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      try { picker?.dispose(); } catch { /* already gone */ }
      finish();
    };
    const onAbort = () => settle(() => resolve(null));
    try {
      // drive.file grants no thumbnail access, so Google recommends the list view for this scope.
      const view = new g.DocsView(g.ViewId.SPREADSHEETS)
        .setMimeTypes("application/vnd.google-apps.spreadsheet")
        .setMode(g.DocsViewMode.LIST);
      picker = new g.PickerBuilder()
        .setAppId(String(import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_NUMBER))
        .setDeveloperKey(String(import.meta.env.VITE_GOOGLE_PICKER_API_KEY))
        .setOAuthToken(accessToken)
        .setOrigin(window.location.origin)
        .addView(view)
        .setCallback((data: any) => {
          const action = data?.[g.Response.ACTION];
          if (action === g.Action.PICKED) {
            const doc = data[g.Response.DOCUMENTS]?.[0];
            settle(() => resolve(doc ? { id: String(doc[g.Document.ID]), name: String(doc[g.Document.NAME] ?? "") } : null));
          } else if (action === g.Action.CANCEL) {
            settle(() => resolve(null));
          } else if (action === (g.Action.ERROR ?? "error")) {
            settle(() => reject(new PickerError("picker_error")));
          } // other actions (e.g. "loaded") are informational
        })
        .build();
      signal?.addEventListener("abort", onAbort, { once: true });
      picker!.setVisible(true);
    } catch {
      settle(() => reject(new PickerError("picker_error")));
    }
  });
}
