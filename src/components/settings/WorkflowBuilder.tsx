import React, { useState } from "react";
import WorkflowList from "@/components/workflows/WorkflowList";
import WorkflowCanvas from "@/components/workflows/WorkflowCanvas";

type View = { mode: "list" } | { mode: "editor"; workflowId: string };

const WorkflowBuilder: React.FC = () => {
  const [view, setView] = useState<View>({ mode: "list" });

  if (view.mode === "editor") {
    return (
      <WorkflowCanvas
        workflowId={view.workflowId}
        onBack={() => setView({ mode: "list" })}
      />
    );
  }

  return (
    <WorkflowList
      onOpenWorkflow={(id) => setView({ mode: "editor", workflowId: id })}
    />
  );
};

export default WorkflowBuilder;
