import React from "react";
import { Mail, Network, Users } from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

const UserManagementTabs: React.FC = () => (
  <div className="w-full max-w-2xl overflow-x-auto">
    <TabsList className="grid min-w-[min(100%,520px)] grid-cols-3 bg-muted/50 p-1 rounded-xl gap-0.5">
      <TabsTrigger value="users" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm min-w-0 px-2 sm:px-3">
        <Users className="w-4 h-4 mr-1.5 sm:mr-2 shrink-0" />
        <span className="truncate">Team Members</span>
      </TabsTrigger>
      <TabsTrigger value="invites" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm min-w-0 px-2 sm:px-3">
        <Mail className="w-4 h-4 mr-1.5 sm:mr-2 shrink-0" />
        <span className="truncate">Pending Invites</span>
      </TabsTrigger>
      <TabsTrigger value="hierarchy" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm min-w-0 px-2 sm:px-3">
        <Network className="w-4 h-4 mr-1.5 sm:mr-2 shrink-0" />
        <span className="truncate">Team hierarchy</span>
      </TabsTrigger>
    </TabsList>
  </div>
);

export default UserManagementTabs;
