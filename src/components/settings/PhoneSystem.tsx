import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PhoneSettings from "./PhoneSettings";
import { Voicemail, PhoneIncoming, Settings } from "lucide-react";

const PhoneSystem: React.FC = () => {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">Phone System</h3>
      <Tabs defaultValue="phone" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="phone">Phone & Numbers</TabsTrigger>
          <TabsTrigger value="voicemail">Voicemail Drops</TabsTrigger>
          <TabsTrigger value="routing">Inbound Routing</TabsTrigger>
          <TabsTrigger value="dialer">Predictive Dialer</TabsTrigger>
        </TabsList>

        <TabsContent value="phone">
          <PhoneSettings />
        </TabsContent>

        <TabsContent value="voicemail">
          <div className="bg-accent/50 rounded-xl p-8 text-center">
            <Voicemail className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h4 className="font-semibold text-foreground mb-1">Voicemail Drop Manager</h4>
            <p className="text-sm text-muted-foreground">Upload and manage pre-recorded voicemail drops for your campaigns.</p>
          </div>
        </TabsContent>

        <TabsContent value="routing">
          <div className="bg-accent/50 rounded-xl p-8 text-center">
            <PhoneIncoming className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h4 className="font-semibold text-foreground mb-1">Inbound Call Routing</h4>
            <p className="text-sm text-muted-foreground">Configure how inbound calls are routed to agents and queues.</p>
          </div>
        </TabsContent>

        <TabsContent value="dialer">
          <div className="bg-accent/50 rounded-xl p-8 text-center">
            <Settings className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h4 className="font-semibold text-foreground mb-1">Predictive Dialer</h4>
            <p className="text-sm text-muted-foreground">Configure dialer speed, concurrency, and pacing settings.</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PhoneSystem;
