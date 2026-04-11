import React from "react";
import VoicemailInbox from "@/components/voicemail/VoicemailInbox";

const VoicemailPage: React.FC = () => {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <VoicemailInbox />
    </div>
  );
};

export default VoicemailPage;
