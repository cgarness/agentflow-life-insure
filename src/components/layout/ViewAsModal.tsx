import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";
import { useViewAs } from "@/contexts/ViewAsContext";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { User, UserProfile } from "@/lib/types";

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
  const { activateViewAs } = useViewAs();
  const [users, setUsers] = useState<(User & { profile: UserProfile })[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

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

  const handleSelect = (user: User & { profile: UserProfile }) => {
    activateViewAs(user);
    onClose();
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
                  onClick={() => handleSelect(u)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-accent"
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
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: `${ROLE_COLORS[u.role]}20`, color: ROLE_COLORS[u.role] }}
                  >
                    {u.role}
                  </span>
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
