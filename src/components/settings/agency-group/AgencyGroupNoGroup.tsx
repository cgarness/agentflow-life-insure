import React, { useState } from "react";
import { Network, MailOpen, Trophy, Users, FileText } from "lucide-react";
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
            Link independent agents under your agency for shared visibility — without merging their data.
          </p>
          <ul className="space-y-2 mb-5 text-sm">
            <li className="flex items-start gap-2.5 text-foreground/90">
              <Trophy className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <span>See every agent's stats on one leaderboard</span>
            </li>
            <li className="flex items-start gap-2.5 text-foreground/90">
              <FileText className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <span>Share training scripts and resources</span>
            </li>
            <li className="flex items-start gap-2.5 text-foreground/90">
              <Users className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <span>Each agent keeps their own account, numbers, and billing</span>
            </li>
          </ul>
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
          <p className="text-sm text-muted-foreground mb-3">
            When a manager invites your agency to their group, you'll see the invitation here.
          </p>
          <p className="text-sm text-muted-foreground">
            Your manager will send an invitation to your admin email address. You can also accept via the link in the email.
          </p>
        </div>
      </div>

      <CreateGroupModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={onCreated} />
    </div>
  );
};

export default AgencyGroupNoGroup;
