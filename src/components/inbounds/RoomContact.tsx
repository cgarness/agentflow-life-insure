import { useState } from "react";
import { roomAddContact } from "@/lib/inbounds/api";
import { button, field } from "./styles";
export function RoomContact({
  callId,
  onSaved,
}: {
  callId: string;
  onSaved: () => Promise<void>;
}) {
  const [first, setFirst] = useState(""),
    [last, setLast] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <details className="my-4 rounded-lg border border-slate-600 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-blue-200">
        Add caller details
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await roomAddContact(callId, first, last);
            await onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not save caller");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block text-sm">
          First name
          <input
            className={field}
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            required
            maxLength={100}
          />
        </label>
        <label className="block text-sm">
          Last name
          <input
            className={field}
            value={last}
            onChange={(e) => setLast(e.target.value)}
            required
            maxLength={100}
          />
        </label>
        <button className={button} disabled={busy}>
          Save caller to Contacts
        </button>
        {error && (
          <p role="alert" className="text-sm text-rose-200">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
