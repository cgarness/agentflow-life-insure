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

const PhoneSystem: React.FC<PhoneSystemProps> = ({ defaultTab = "phone" }) => {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">Phone System</h3>
      <Tabs key={defaultTab} defaultValue={defaultTab} className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="phone">Phone & Numbers</TabsTrigger>
          <TabsTrigger value="inbound-routing">Inbound Routing</TabsTrigger>
          <TabsTrigger value="call-recording">Recording Settings</TabsTrigger>
          <TabsTrigger value="recordings">Recording Library</TabsTrigger>
          <TabsTrigger value="monitoring">Call Monitoring</TabsTrigger>
          <TabsTrigger value="number-reputation">Number Reputation</TabsTrigger>
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
