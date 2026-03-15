import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CallScripts from "./CallScripts";
import { Mic, Headphones } from "lucide-react";

const CallManagement: React.FC = () => {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">Call Management</h3>
      <Tabs defaultValue="scripts" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="scripts">Call Scripts</TabsTrigger>
          <TabsTrigger value="recordings">Recording Library</TabsTrigger>
          <TabsTrigger value="monitoring">Call Monitoring</TabsTrigger>
        </TabsList>

        <TabsContent value="scripts">
          <CallScripts />
        </TabsContent>

        <TabsContent value="recordings">
          <div className="bg-accent/50 rounded-xl p-8 text-center">
            <Mic className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h4 className="font-semibold text-foreground mb-1">Call Recording Library</h4>
            <p className="text-sm text-muted-foreground">Browse, search, and manage recorded calls for training and compliance.</p>
          </div>
        </TabsContent>

        <TabsContent value="monitoring">
          <div className="space-y-4">
            <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
              Call Monitoring <span className="w-2.5 h-2.5 rounded-full bg-success animate-pulse" />
            </h4>
            <div className="space-y-3">
              {[
                { agent: "Sarah J.", contact: "John Martinez", duration: "3:24" },
                { agent: "Mike T.", contact: "Lisa Park", duration: "1:12" },
              ].map((c) => (
                <div key={c.agent} className="bg-card rounded-xl border p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                      {c.agent.split(" ").map(w => w[0]).join("")}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.agent} → {c.contact}</p>
                      <p className="text-xs text-muted-foreground font-mono">{c.duration}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {["Listen", "Whisper", "Barge"].map((a) => (
                      <button key={a} className="px-3 py-1.5 rounded-lg bg-accent text-foreground text-xs font-medium hover:bg-accent/80 sidebar-transition">{a}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CallManagement;
