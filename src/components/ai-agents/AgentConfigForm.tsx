import React, { useState } from "react";
import { AgentType } from "./AgentTypePicker";
import { MessageSquare, Mail, PhoneOutgoing, PhoneIncoming } from "lucide-react";

interface AgentConfigFormProps {
  selectedType: AgentType;
}

const NAME_SUGGESTIONS = ['Maya','Jordan','Alex','Casey','Riley','Morgan','Taylor','Sage','Reese','Drew'];

const TONE_OPTIONS = [
  "Warm & conversational",
  "Professional & direct",
  "Energetic & upbeat",
  "Calm & reassuring"
];

const TRIGGER_CHIPS = [
  "No Answer", "Voicemail", "Callback", "Not Interested", "Interested", "DNC"
];

export const AgentConfigForm: React.FC<AgentConfigFormProps> = ({ selectedType }) => {
  const [name, setName] = useState("Maya");
  const [nameIndex, setNameIndex] = useState(0);
  const [selectedTone, setSelectedTone] = useState(TONE_OPTIONS[0]);
  const [selectedTriggers, setSelectedTriggers] = useState<string[]>(["No Answer", "Voicemail"]);

  const handleSuggestName = () => {
    const nextIndex = (nameIndex + 1) % NAME_SUGGESTIONS.length;
    setNameIndex(nextIndex);
    setName(NAME_SUGGESTIONS[nextIndex]);
  };

  const toggleTrigger = (trigger: string) => {
    setSelectedTriggers(prev => 
      prev.includes(trigger) 
        ? prev.filter(t => t !== trigger)
        : [...prev, trigger]
    );
  };

  // Determine icon for the pill
  let Icon = MessageSquare;
  if (selectedType === "Email agent") Icon = Mail;
  else if (selectedType === "Voice outbound") Icon = PhoneOutgoing;
  else if (selectedType === "Voice inbound") Icon = PhoneIncoming;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 mb-8">
        <h2 className="text-xl font-semibold text-foreground">Configure your agent</h2>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium">
          <Icon className="w-3.5 h-3.5" />
          {selectedType}
        </div>
      </div>

      <div className="space-y-8 pb-20">
        {/* Agent Name */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Agent name</label>
          <input 
            type="text" 
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-muted-foreground">This is the name leads will see in messages.</p>
            <button 
              onClick={handleSuggestName}
              className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
            >
              ✦ Suggest a name
            </button>
          </div>
        </div>

        {/* Persona */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Persona</label>
          <textarea 
            rows={3}
            defaultValue="Friendly, professional insurance advisor who genuinely cares about protecting families. Never pushy. Always helpful."
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {/* Tone */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Tone</label>
          <div className="grid grid-cols-2 gap-2">
            {TONE_OPTIONS.map(tone => (
              <button
                key={tone}
                onClick={() => setSelectedTone(tone)}
                className={`px-3 py-2 text-sm font-medium rounded-md border transition-colors ${
                  selectedTone === tone
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                {tone}
              </button>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Instructions</label>
          <textarea 
            rows={4}
            placeholder="What should this agent do and say?"
            defaultValue="After a missed call, text the lead within 5 minutes. Introduce yourself, mention you tried calling about life insurance, and ask if there's a better time to connect. If they respond with interest, send a calendar link."
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
          />
        </div>

        {/* Triggers */}
        <div className="space-y-4">
          <div className="border-b border-border pb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Triggers</h3>
            <p className="text-sm text-muted-foreground mt-1">Fire this agent when a lead is dispositioned as:</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TRIGGER_CHIPS.map(chip => {
              const isSelected = selectedTriggers.includes(chip);
              return (
                <button
                  key={chip}
                  onClick={() => toggleTrigger(chip)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                    isSelected 
                      ? "border-primary bg-primary/10 text-primary" 
                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {chip}
                </button>
              );
            })}
          </div>
        </div>

        {/* Delay after trigger */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Delay after trigger</label>
          <select 
            defaultValue="5 minutes"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="Immediately">Immediately</option>
            <option value="5 minutes">5 minutes</option>
            <option value="15 minutes">15 minutes</option>
            <option value="1 hour">1 hour</option>
            <option value="Next business day">Next business day</option>
          </select>
        </div>
      </div>
    </div>
  );
};
