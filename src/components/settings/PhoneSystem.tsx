import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PhoneSettings from "./PhoneSettings";
import PhoneNumbersPanel, { type PhoneNumbersSubTab } from "./PhoneNumbersPanel";
import InboundCallRouting from "./InboundCallRouting";
import CallRecordingSettings from "./CallRecordingSettings";
import CallRecordingLibrary from "./CallRecordingLibrary";
import CallMonitoring from "./CallMonitoring";
import { usePhoneSettingsController } from "./phone/usePhoneSettingsController";

export type PhoneSystemTab =
  | "phone"
  | "phone-numbers"
  | "inbound-routing"
  | "call-recording"
  | "recordings"
  | "monitoring";

export function settingsSlugToPhoneSystemTab(slug: string): PhoneSystemTab {
  if (slug === "phone-system") return "phone";
  if (slug === "number-reputation") return "phone-numbers";
  if (
    slug === "inbound-routing" ||
    slug === "call-recording" ||
    slug === "recordings" ||
    slug === "monitoring"
  ) {
    return slug;
  }
  return "phone";
}

export function settingsSlugToPhoneNumbersSubTab(slug: string): PhoneNumbersSubTab {
  return slug === "number-reputation" ? "reputation" : "purchase";
}

interface PhoneSystemProps {
  /** Inner tab shown when this screen first mounts (from `?section=` or default). */
  defaultTab?: PhoneSystemTab;
  /** When opening the Phone Numbers area, which nested tab to show first. */
  defaultPhoneNumbersSubTab?: PhoneNumbersSubTab;
}

const tabTriggerClass =
  "rounded-md px-3 py-2 text-sm font-medium transition-all " +
  "text-muted-foreground hover:bg-primary/15 hover:text-primary " +
  "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md " +
  "data-[state=active]:hover:bg-primary data-[state=active]:hover:text-primary-foreground " +
  "focus-visible:ring-primary/40";

const PhoneSystem: React.FC<PhoneSystemProps> = ({
  defaultTab = "phone",
  defaultPhoneNumbersSubTab = "purchase",
}) => {
  const phone = usePhoneSettingsController();

  if (phone.loading) {
    return (
      <div className="space-y-4">
        <h3 className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
          <span className="h-6 w-1 shrink-0 rounded-full bg-primary shadow-sm" aria-hidden />
          <span className="text-primary">Phone System</span>
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
        <span className="h-6 w-1 shrink-0 rounded-full bg-primary shadow-sm" aria-hidden />
        <span className="text-primary">Phone System</span>
      </h3>
      <Tabs
        key={`${defaultTab}-${defaultPhoneNumbersSubTab}`}
        defaultValue={defaultTab}
        className="w-full"
      >
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-primary/25 bg-primary/10 p-1.5 shadow-sm">
          <TabsTrigger value="phone" className={tabTriggerClass}>
            Phone & Numbers
          </TabsTrigger>
          <TabsTrigger value="phone-numbers" className={tabTriggerClass}>
            Phone Numbers
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

        <TabsContent value="phone-numbers" className="mt-4">
          <PhoneNumbersPanel
            phone={phone}
            defaultSubTab={defaultPhoneNumbersSubTab}
            tabTriggerClass={tabTriggerClass}
          />
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
      </Tabs>
    </div>
  );
};

export default PhoneSystem;
