import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import NumberManagementSection from "./phone/NumberManagementSection";
import NumberReputation from "./NumberReputation";
import type { PhoneSettingsController } from "./phone/usePhoneSettingsController";

export type PhoneNumbersSubTab = "purchase" | "reputation";

interface PhoneNumbersPanelProps {
  phone: PhoneSettingsController;
  defaultSubTab: PhoneNumbersSubTab;
  tabTriggerClass: string;
}

/**
 * Inventory, purchase, and reputation tools for agency phone numbers.
 * Nested tabs under Phone System → Phone Numbers.
 */
const PhoneNumbersPanel: React.FC<PhoneNumbersPanelProps> = ({
  phone,
  defaultSubTab,
  tabTriggerClass,
}) => {
  return (
    <Tabs key={defaultSubTab} defaultValue={defaultSubTab} className="w-full">
      <TabsList className="mb-1 flex h-auto w-full max-w-md flex-wrap justify-start gap-1 rounded-lg border border-primary/20 bg-primary/5 p-1">
        <TabsTrigger value="purchase" className={`${tabTriggerClass} text-xs sm:text-sm`}>
          Phone number purchase
        </TabsTrigger>
        <TabsTrigger value="reputation" className={`${tabTriggerClass} text-xs sm:text-sm`}>
          Number reputation
        </TabsTrigger>
      </TabsList>

      <TabsContent value="purchase" className="mt-4">
        <NumberManagementSection
          organizationId={phone.organizationId ?? null}
          numbers={phone.numbers}
          setNumbers={phone.setNumbers}
          agents={phone.agents}
          onRefresh={phone.fetchData}
        />
      </TabsContent>

      <TabsContent value="reputation" className="mt-4">
        <NumberReputation />
      </TabsContent>
    </Tabs>
  );
};

export default PhoneNumbersPanel;
