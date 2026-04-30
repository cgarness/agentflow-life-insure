import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PhoneSettings from "./PhoneSettings";
import { NumberManagementSection } from "./phone/NumberManagementSection";
import { InboundRoutingSection } from "./phone/InboundRoutingSection";
import { LocalPresenceSection } from "./phone/LocalPresenceSection";
import NumberReputation from "./NumberReputation";
import InboundCallRouting from "./InboundCallRouting";
import CallRecordingSettings from "./CallRecordingSettings";
import CallRecordingLibrary from "./CallRecordingLibrary";
import CallMonitoring from "./CallMonitoring";
import { usePhoneSettingsController } from "./phone/usePhoneSettingsController";

export type PhoneSystemTab =
  | "phone"
  | "phone-numbers"
  | "number-reputation"
  | "inbound-routing"
  | "call-recording"
  | "recordings"
  | "monitoring";

export function settingsSlugToPhoneSystemTab(slug: string): PhoneSystemTab {
  if (slug === "phone-system") return "phone";
  if (
    slug === "phone-numbers" ||
    slug === "number-reputation" ||
    slug === "inbound-routing" ||
    slug === "call-recording" ||
    slug === "recordings" ||
    slug === "monitoring"
  ) {
    return slug as PhoneSystemTab;
  }
  return "phone";
}

interface PhoneSystemProps {
  /** Tab shown when this screen first mounts (from `?section=` or default). */
  defaultTab?: PhoneSystemTab;
}

const tabTriggerClass =
  "rounded-md px-3 py-2 text-sm font-medium transition-all " +
  "text-muted-foreground hover:bg-background hover:text-foreground " +
  "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm " +
  "data-[state=active]:ring-1 data-[state=active]:ring-border/60 " +
  "focus-visible:ring-primary/30";

const PhoneSystem: React.FC<PhoneSystemProps> = ({ defaultTab = "phone" }) => {
  const phone = usePhoneSettingsController();

  if (phone.loading) {
    return (
      <div className="space-y-4">
        <h3 className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
          <span className="h-6 w-1 shrink-0 rounded-full bg-border" aria-hidden />
          <span className="text-foreground">Phone System</span>
        </h3>
        <div className="space-y-6">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
        <span className="h-6 w-1 shrink-0 rounded-full bg-border" aria-hidden />
        <span className="text-foreground">Phone System</span>
      </h3>
      <Tabs key={defaultTab} defaultValue={defaultTab} className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-border bg-muted/50 p-1.5">
          <TabsTrigger value="phone" className={tabTriggerClass}>
            Trust Hub
          </TabsTrigger>
          <TabsTrigger value="phone-numbers" className={tabTriggerClass}>
            Phone Numbers
          </TabsTrigger>
          <TabsTrigger value="number-reputation" className={tabTriggerClass}>
            Number reputation
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
        </TabsList>

        <TabsContent value="phone" className="mt-4">
          <PhoneSettings phone={phone} />
        </TabsContent>

        <TabsContent value="phone-numbers" className="mt-4 space-y-6">
          <NumberManagementSection
            organizationId={phone.organizationId ?? null}
            numbers={phone.numbers}
            setNumbers={phone.setNumbers}
            agents={phone.agents}
            onRefresh={phone.fetchData}
          />
          <LocalPresenceSection
            localPresenceEnabled={phone.secretBundle.local_presence_enabled !== false}
            onToggle={(v) => void phone.handleLocalPresenceToggle(v)}
            uniqueAreaCodes={phone.uniqueAreaCodes}
          />
        </TabsContent>

        <TabsContent value="number-reputation" className="mt-4">
          <NumberReputation />
        </TabsContent>

        <TabsContent value="inbound-routing" className="mt-4 space-y-6">
          <InboundRoutingSection
            inboundRouting={phone.inboundRouting}
            onInboundRoutingChange={(v) => void phone.handleInboundRoutingChange(v)}
            voicemailEnabled={phone.secretBundle.voicemail_enabled !== false}
            onVoicemailEnabledChange={(v) => void phone.handleVoicemailToggle(v)}
          />
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
      </Tabs>
    </div>
  );
};

export default PhoneSystem;
