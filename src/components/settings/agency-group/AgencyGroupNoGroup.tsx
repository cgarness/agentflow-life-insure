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
          <p className="text-sm text-muted-foreground mb-4">
            Share leaderboards and resources with other agencies; contacts, phone numbers, billing, and settings stay separate.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="h-10 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 self-start mt-auto"
          >
            Create Agency Group
          </button>
        </div>

        <div className="rounded-2xl bg-card border border-border p-6 flex flex-col">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center animate-pulse">
              <MailOpen className="w-5 h-5 text-primary" />
            </div>
            <h3 className="font-semibold">Waiting for an invite?</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Invitations appear here and are sent to your agency admin by email.
          </p>
        </div>
      </div>

      <CreateGroupModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={onCreated} />
    </div>
  );
};

export default AgencyGroupNoGroup;
