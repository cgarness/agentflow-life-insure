import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { panel, field } from "./styles";
type Script = { id: string; name: string; content: string | null };
export function RoomScripts({
  org,
  onReady,
}: {
  org: string;
  onReady: (ready: boolean) => void;
}) {
  const [scripts, setScripts] = useState<Script[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      seq = 0;
    const load = async () => {
      const request = ++seq;
      setLoading(true);
      onReady(false);
      try {
        const { data, error: e } = await supabase
          .from("call_scripts")
          .select("id,name,content")
          .eq("organization_id", org)
          .eq("active", true)
          .order("name");
        if (!active || request !== seq) return;
        setLoading(false);
        setError(e?.message || "");
        const usable = (data || []).filter((s) => s.content?.trim());
        setScripts(usable);
        onReady(!e && !!usable.length);
      } catch (e) {
        if (active && request === seq) {
          setLoading(false);
          setError(e instanceof Error ? e.message : "Scripts unavailable");
          setScripts([]);
          onReady(false);
        }
      }
    };
    void load();
    const channel = supabase
      .channel(`room-scripts:${org}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "call_scripts",
          filter: `organization_id=eq.${org}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [org, retry, onReady]);
  const script = scripts.find((s) => s.id === selected) || scripts[0];
  return (
    <section className={panel}>
      <details open>
        <summary className="flex cursor-pointer list-none items-center justify-between p-5 font-bold text-white">
          Call script
          <ChevronDown className="h-4 w-4" />
        </summary>
        <div className="px-5 pb-6">
          {loading ? (
            <p role="status">Loading scripts…</p>
          ) : error ? (
            <div role="alert">
              Scripts unavailable.{" "}
              <button
                onClick={() => setRetry((x) => x + 1)}
                className="underline"
              >
                Retry
              </button>
            </div>
          ) : !script ? (
            <p>No active scripts. Add one in AgentFlow Settings.</p>
          ) : (
            <>
              <label className="sr-only" htmlFor="room-script">
                Script
              </label>
              <select
                id="room-script"
                className={field}
                value={script.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="mt-6 whitespace-pre-wrap break-words text-lg leading-relaxed text-white">
                {script.content || "This script has no content."}
              </p>
            </>
          )}
        </div>
      </details>
    </section>
  );
}
