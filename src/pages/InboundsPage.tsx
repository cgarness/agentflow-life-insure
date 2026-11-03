import { useAuth } from "@/contexts/AuthContext";
import { INBOUNDS_ENABLED } from "@/lib/inbounds/contracts";
import { RoomWorkspace } from "@/components/inbounds/RoomWorkspace";
export default function InboundsPage() {
  const { user, realProfile, isImpersonating } = useAuth();
  if (!INBOUNDS_ENABLED)
    return (
      <main className="p-8">
        Inbounds is not enabled for this build.{" "}
        <a className="underline" href="/dashboard">
          Return to AgentFlow
        </a>
      </main>
    );
  if (
    isImpersonating ||
    !user ||
    !realProfile?.organization_id ||
    realProfile.id !== user.id
  )
    return (
      <main className="p-8">
        Open Inbounds from your own AgentFlow account.
      </main>
    );
  return (
    <RoomWorkspace
      key={user.id + realProfile.organization_id}
      org={realProfile.organization_id}
      user={user.id}
      name={realProfile.first_name || "agent"}
    />
  );
}
