import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { User, UserProfile } from "@/lib/types";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface ViewAsModalProps {
  open: boolean;
  onClose: () => void;
  currentUserId: string;
}

/** Stable empty reference so an unmatched key cannot churn identity on every render. */
const EMPTY_USERS: (User & { profile: UserProfile })[] = [];

const ROLE_COLORS: Record<string, string> = {
  Admin: "#3B82F6",
  "Team Leader": "#8B5CF6",
  Agent: "#10B981",
};

const ViewAsModal: React.FC<ViewAsModalProps> = ({ open, onClose, currentUserId }) => {
  const { startImpersonation } = useAuth();
  const navigate = useNavigate();
  /**
   * The list is stored WITH the identity it was loaded for and read back through a derived value,
   * so a viewer change drops the previous account's rows on the very render the identity changes —
   * not one commit later. `error` is kept distinct from an empty list: a rejected request used to
   * leave `loading` true forever (there was no `.catch` at all), and any future short-circuit of
   * that would otherwise read as "this organization has no users".
   */
  const [loaded, setLoaded] = useState<{
    key: string;
    rows: (User & { profile: UserProfile })[];
    error: string | null;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  /**
   * Distinguishes one OPEN from the next.
   *
   * Without it the key is identical across a close/reopen, so the previous open's committed state
   * is painted again while a fresh request is in flight: a stale error with a live-looking Retry
   * button, or a row for a user who has since been deactivated.
   */
  const [openGen, setOpenGen] = useState(0);
  /** Activation is a server round-trip now, so the clicked row is disabled while it is in flight. */
  const [activatingId, setActivatingId] = useState<string | null>(null);
  /** Only the newest list request may commit — a stale one must never repaint the current modal. */
  const listSeqRef = useRef(0);

  const listKey = open ? `${currentUserId}::${retryToken}::${openGen}` : null;

  useEffect(() => {
    // Bumped on CLOSE, not on open: bumping on open would change the key mid-open and fire a second
    // request for every single open. Closing costs nothing, because `listKey` is null while closed.
    if (open) return;
    setOpenGen((g) => g + 1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // A round-trip that never settles would otherwise leave the row lock on forever, disabling
    // every row for the rest of the session with no way back short of a reload.
    setActivatingId(null);
  }, [open]);
  const current = listKey && loaded?.key === listKey ? loaded : null;
  const users = current?.rows ?? EMPTY_USERS;
  const listError = current?.error ?? null;
  // No state for this identity yet means the request has not settled. Unstarted is not empty.
  const loading = listKey !== null && current === null;

  useEffect(() => {
    if (!listKey) return;
    const seq = (listSeqRef.current += 1);
    const keyAtStart = listKey;
    const viewerAtStart = currentUserId;
    usersApi
      .getAll({ status: "Active" })
      .then((data) => {
        if (listSeqRef.current !== seq) return; // superseded — a newer request owns the modal
        // Exclude the super admin (current user)
        setLoaded({ key: keyAtStart, rows: data.filter((u) => u.id !== viewerAtStart), error: null });
      })
      .catch((e) => {
        if (listSeqRef.current !== seq) return;
        console.error("[ViewAs] Could not load the user list:", e);
        setLoaded({
          key: keyAtStart,
          rows: EMPTY_USERS,
          error: e instanceof Error ? e.message : "Could not load users.",
        });
      });
  }, [listKey, currentUserId]);

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return (
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  const handleSelect = async (user: User & { profile: UserProfile }) => {
    // A POINTER, not a profile. This list is rendered from a client-side DTO, and passing that DTO
    // to `startImpersonation` used to hand it the target's role, status and organization —
    // a candidate claiming `role: "Admin"` over an `Agent` row became an organization-wide viewer.
    // AuthContext now re-reads the target from `profiles` itself and ignores everything but the id.
    if (!user?.id) {
      toast.error("That user's profile is incomplete — cannot view as them.");
      return;
    }
    setActivatingId(user.id);
    try {
      // Navigate only on a CONFIRMED activation. AuthContext proves authority against the server
      // and can refuse; routing away regardless would leave the real account on a dashboard that
      // merely looks impersonated.
      // AuthContext contracts never to reject, but a caller that assumes that is one refactor away
      // from a silent unhandled rejection that navigates nowhere and says nothing.
      let activated = false;
      try {
        activated = await startImpersonation(user.id);
      } catch (e) {
        console.error("[ViewAs] Activation failed:", e);
        activated = false;
      }
      if (!activated) {
        toast.error("You aren't allowed to view as that user, or their account isn't active.");
        return;
      }
      navigate("/dashboard");
      onClose();
    } finally {
      setActivatingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>View As</span>
            <span className="text-xs font-normal text-muted-foreground ml-1">— Super Admin only</span>
          </DialogTitle>
        </DialogHeader>

        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="mt-2 space-y-1 max-h-80 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : listError ? (
            /* Distinct from the empty state on purpose: a failed load must never read as
               "this organization has no users". */
            <div className="text-center py-8">
              <p className="text-sm font-medium text-foreground mb-1">Couldn't load users</p>
              <p className="text-xs text-muted-foreground mb-4">{listError}</p>
              <button
                type="button"
                onClick={() => setRetryToken((t) => t + 1)}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No users found.</div>
          ) : (
            filtered.map(u => {
              const initials = `${u.firstName[0]}${u.lastName[0]}`;
              return (
                <button
                  key={u.id}
                  onClick={() => void handleSelect(u)}
                  disabled={activatingId !== null}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center overflow-hidden shrink-0">
                    {u.avatar ? (
                      <img src={u.avatar} alt="" className="w-full h-full object-cover" />
                    ) : initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-foreground">{u.firstName} {u.lastName}</div>
                    <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                  </div>
                  {activatingId === u.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
                  ) : (
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
                      style={{ backgroundColor: `${ROLE_COLORS[u.role]}20`, color: ROLE_COLORS[u.role] }}
                    >
                      {u.role}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ViewAsModal;
