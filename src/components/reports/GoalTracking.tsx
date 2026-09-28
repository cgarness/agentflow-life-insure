import React from "react";
import { Target } from "lucide-react";
import ReportSection from "./ReportSection";

/**
 * Goal attainment is not available (plan D-7): the only stored source, agent_scorecards, has no
 * maintained writer for its goal flags and `goals` holds no targets. Rather than render a chart of
 * zeros, the section says so plainly.
 */
const GoalTracking: React.FC = () => (
  <ReportSection title="Goal Attainment" defaultOpen={false}>
    <div className="flex flex-col items-center text-center gap-2 py-8" data-report-state="unavailable">
      <Target className="w-6 h-6 text-muted-foreground" />
      <p className="text-sm font-semibold text-foreground">Goal tracking isn't available yet.</p>
      <p className="text-xs text-muted-foreground max-w-md">
        There is no maintained goal-attainment data source, so no attainment figures are shown.
      </p>
    </div>
  </ReportSection>
);

export default GoalTracking;
