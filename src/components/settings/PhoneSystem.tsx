import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PhoneSettings from "./PhoneSettings";
import InboundCallRouting from "./InboundCallRouting";
import CallRecordingSettings from "./CallRecordingSettings";
import CallRecordingLibrary from "./CallRecordingLibrary";
import CallMonitoring from "./CallMonitoring";
import NumberReputation from "./NumberReputation";

export type PhoneSystemTab =
  | "phone"
  | "inbound-routing"
  | "call-recording"
  | "recordings"
  | "monitoring"
  | "number-reputation";

export function settingsSlugToPhoneSystemTab(slug: string): PhoneSystemTab {
  if (slug === "phone-system") return "phone";
  if (
    slug === "inbound-routing" ||
    slug === "call-recording" ||
    slug === "recordings" ||
    slug === "monitoring" ||
    slug === "number-reputation"
  ) {
    return slug;
  }
  return "phone";
}

interface PhoneSystemProps {
  /** Inner tab shown when this screen first mounts (from `?section=` or default). */
  defaultTab?: PhoneSystemTab;
}

const tabTriggerClass =
  "rounded-md px-3 py-2 text-sm font-medium transition-all " +
  "text-muted-foreground hover:bg-primary/15 hover:text-primary " +
  "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md " +
  "data-[state=active]:hover:bg-primary data-[state=active]:hover:text-primary-foreground " +
  "focus-visible:ring-primary/40";

const PhoneSystem: React.FC<PhoneSystemProps> = ({ defaultTab = "phone" }) => {
  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
        <span className="h-6 w-1 shrink-0 rounded-full bg-primary shadow-sm" aria-hidden />
        <span className="text-primary">Phone System</span>
      </h3>
      <Tabs key={defaultTab} defaultValue={defaultTab} className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-primary/25 bg-primary/10 p-1.5 shadow-sm">
          <TabsTrigger value="phone" className={tabTriggerClass}>
            Phone & Numbers
          </TabsTrigger>
          <TabsTrigger value="inbound-routing" className={tabTriggerClass}>
            Inbound Routing
          </TabsTrigger>
          <TabsTrigger value="call-recording" className={tabTriggerClass}>
            Recording Settings
          </TabsTrigger>
          <TabsTrigger value="recordings" className={tabTriggerClass}>
            Recording Library
          </TabsTrigger>
          <TabsTrigger value="monitoring" className={tabTriggerClass}>
            Call Monitoring
          </TabsTrigger>
          <TabsTrigger value="number-reputation" className={tabTriggerClass}>
            Number Reputation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="phone" className="mt-4">
          <PhoneSettings />
        </TabsContent>

        <TabsContent value="inbound-routing" className="mt-4">
          <InboundCallRouting />
        </TabsContent>

        <TabsContent value="call-recording" className="mt-4">
          <CallRecordingSettings />
        </TabsContent>

        <TabsContent value="recordings" className="mt-4">
          <CallRecordingLibrary />
        </TabsContent>

        <TabsContent value="monitoring" className="mt-4">
          <CallMonitoring />
        </TabsContent>

        <TabsContent value="number-reputation" className="mt-4">
          <NumberReputation />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PhoneSystem;
