import React from "react";
import { ACTION_METAS, LOGIC_METAS, type ActionType, type NodeKind } from "@/lib/workflow-types";

export type PaletteDragPayload =
  | { kind: "action"; action_type: ActionType }
  | { kind: NodeKind };

const NodePalette: React.FC = () => {
  const onDragStart = (e: React.DragEvent, payload: PaletteDragPayload) => {
    e.dataTransfer.setData("application/reactflow", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/50 bg-card/30 p-4 backdrop-blur-sm">
      <Section title="Actions">
        {ACTION_METAS.map((m) => {
          const Icon = m.icon;
          const disabled = !!m.comingSoon;
          return (
            <div
              key={m.type}
              draggable={!disabled}
              onDragStart={disabled ? undefined : (e) => onDragStart(e, { kind: "action", action_type: m.type })}
              className={`flex cursor-grab items-center gap-2 rounded-lg border border-border/40 bg-card/60 px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-accent/40 ${
                disabled ? "cursor-not-allowed opacity-60" : ""
              }`}
            >
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-foreground">{m.label}</span>
              {m.comingSoon && (
                <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[9px] font-medium text-yellow-500">
                  Soon
                </span>
              )}
            </div>
          );
        })}
      </Section>

      <Section title="Logic">
        {LOGIC_METAS.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.kind}
              draggable
              onDragStart={(e) => onDragStart(e, { kind: m.kind })}
              className="flex cursor-grab items-center gap-2 rounded-lg border border-border/40 bg-card/60 px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
            >
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-foreground">{m.label}</span>
            </div>
          );
        })}
      </Section>
    </aside>
  );
};

const Section: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <div className="space-y-2">
    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
    <div className="space-y-1.5">{children}</div>
  </div>
);

export default NodePalette;
