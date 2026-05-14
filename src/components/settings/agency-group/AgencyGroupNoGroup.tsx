import React, { useState } from "react";
import { Network, MailOpen } from "lucide-react";
import CreateGroupModal from "./CreateGroupModal";

interface Props {
  onCreated: () => void;
}

const AgencyGroupNoGroup: React.FC<Props> = ({ onCreated }) => {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-card border border-border p-6 flex flex-col">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Network className="w-5 h-5 text-primary" />
            </div>
            <h3 className="font-semibold">Create an Agency Group</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4 flex-1">
            Create a group and invite independent agents to join. You'll see their stats on a shared leaderboard and can share training resources.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="h-10 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 self-start"
          >
            Create Agency Group
          </button>
        </div>

        <div className="rounded-2xl bg-card border border-border p-6 flex flex-col">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
              <MailOpen className="w-5 h-5 text-muted-foreground" />
            </div>
            <h3 className="font-semibold">Waiting for an invite?</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            When a manager invites your agency to their group, you'll see the invitation here. You can also accept via the email link.
          </p>
        </div>
      </div>

      <CreateGroupModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={onCreated} />
    </div>
  );
};

export default AgencyGroupNoGroup;
