import React, { useState } from "react";
import { AgentTypePicker, AgentType } from "@/components/ai-agents/AgentTypePicker";
import { AgentConfigForm } from "@/components/ai-agents/AgentConfigForm";
import { useNavigate } from "react-router-dom";

const AIAgentCreate: React.FC = () => {
  const [selectedType, setSelectedType] = useState<AgentType>("SMS agent");
  const navigate = useNavigate();

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* Left Column - Type Picker */}
      <div className="w-[40%] flex-shrink-0 border-r border-border overflow-y-auto">
        <div className="p-6 lg:p-8 max-w-md mx-auto w-full">
          <AgentTypePicker 
            selectedType={selectedType}
            onSelectType={setSelectedType}
          />
        </div>
      </div>

      {/* Right Column - Config Form */}
      <div className="flex-1 flex flex-col overflow-y-auto relative bg-muted/10">
        <div className="p-6 lg:p-8 max-w-2xl mx-auto w-full flex-grow">
          <AgentConfigForm selectedType={selectedType} />
        </div>
        
        {/* Sticky Footer */}
        <div className="sticky bottom-0 left-0 right-0 p-4 bg-background border-t border-border flex justify-between items-center z-10 px-6 lg:px-8">
          <button 
            onClick={() => navigate("/ai-agents")}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2"
          >
            Cancel
          </button>
          <button 
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
          >
            Save agent
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIAgentCreate;
