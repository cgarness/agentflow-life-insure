import React, { useEffect, useState } from "react";
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

const ROLE_COLORS: Record<string, string> = {
  Admin: "#3B82F6",
  "Team Leader": "#8B5CF6",
  Agent: "#10B981",
};

const ViewAsModal: React.FC<ViewAsModalProps> = ({ open, onClose, currentUserId }) => {
  const { startImpersonation } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<(User & { profile: UserProfile })[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  /** Activation is a server round-trip now, so the clicked row is disabled while it is in flight. */
  const [activatingId, setActivatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    usersApi.getAll({ status: "Active" }).then(data => {
      // Exclude the super admin (current user)
      setUsers(data.filter(u => u.id !== currentUserId));
      setLoading(false);
    });
  }, [open, currentUserId]);

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
      const activated = await startImpersonation(user.id);
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
