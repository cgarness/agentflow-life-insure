// Google Picker loader. The access token is passed in from a fresh server call and is never stored:
// not in browser storage, React Query, component state or logs.

interface PickerWindow extends Window {
  gapi?: { load: (name: string, cb: () => void) => void };
  google?: { picker: any };
}

let loading: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  const w = window as PickerWindow;
  if (w.google?.picker) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.onload = () => w.gapi?.load("picker", () => resolve());
      script.onerror = () => { loading = null; reject(new Error("picker_load_failed")); };
      document.head.appendChild(script);
    });
  }
  return loading;
}

export const pickerConfigured = () =>
  Boolean(import.meta.env.VITE_GOOGLE_PICKER_API_KEY && import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_NUMBER);

/** Opens the Picker (spreadsheets only, single select). Resolves null when cancelled. */
export async function pickSpreadsheet(accessToken: string): Promise<{ id: string; name: string } | null> {
  await loadPicker();
  const g = (window as PickerWindow).google!.picker;
  return new Promise((resolve) => {
    const view = new g.DocsView(g.ViewId.SPREADSHEETS).setMimeTypes("application/vnd.google-apps.spreadsheet");
    const picker = new g.PickerBuilder()
      .setAppId(String(import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_NUMBER))
      .setDeveloperKey(String(import.meta.env.VITE_GOOGLE_PICKER_API_KEY))
      .setOAuthToken(accessToken)
      .setOrigin(window.location.origin)
      .addView(view)
      .setCallback((data: any) => {
        const action = data?.[g.Response.ACTION];
        if (action === g.Action.PICKED) {
          const doc = data[g.Response.DOCUMENTS]?.[0];
          resolve(doc ? { id: String(doc[g.Document.ID]), name: String(doc[g.Document.NAME] ?? "") } : null);
        } else if (action === g.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
