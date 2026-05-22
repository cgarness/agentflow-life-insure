import React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  onInvite: () => void;
}

const UserManagementHeader: React.FC<Props> = ({ onInvite }) => (
  <div className="flex items-center justify-between">
    <div>
      <h3 className="text-xl font-bold text-foreground tracking-tight">Team Management</h3>
      <p className="text-sm text-muted-foreground mt-1">Manage your team members and pending invitations.</p>
    </div>
    <Button onClick={onInvite} className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all duration-300">
      <Plus className="w-4 h-4 mr-2" /> Invite New Agent
    </Button>
  </div>
);

export default UserManagementHeader;
