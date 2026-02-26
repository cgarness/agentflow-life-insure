import React, { useState } from "react";
import { Phone, MessageSquare, Mail, Search, Play } from "lucide-react";

const conversations = [
  { name: "John Martinez", channel: "call", preview: "Outbound call - 4:12", time: "10 min ago", unread: 2 },
  { name: "Sarah Williams", channel: "sms", preview: "Thanks for the info! I'll review...", time: "25 min ago", unread: 1 },
  { name: "Mike Johnson", channel: "call", preview: "Inbound call - 1:34", time: "1 hr ago", unread: 0 },
  { name: "Lisa Park", channel: "email", preview: "Re: Policy Quote - Term Life", time: "2 hrs ago", unread: 0 },
  { name: "Tom Harris", channel: "sms", preview: "Can we schedule for Tuesday?", time: "3 hrs ago", unread: 3 },
  { name: "Amy Zhang", channel: "call", preview: "Outbound call - 8:45", time: "4 hrs ago", unread: 0 },
  { name: "David Brown", channel: "sms", preview: "Not interested at this time", time: "Yesterday", unread: 0 },
  { name: "Maria Lopez", channel: "call", preview: "Voicemail left", time: "Yesterday", unread: 0 },
];

const channelIcons: Record<string, React.ReactNode> = {
  call: <Phone className="w-3 h-3" />,
  sms: <MessageSquare className="w-3 h-3" />,
  email: <Mail className="w-3 h-3" />,
};

const thread = [
  { type: "call", direction: "outbound", duration: "4:12", date: "Today 10:15 AM", disposition: "Interested" },
  { type: "sms", direction: "outbound", text: "Hi John, thanks for your time today. I'll send over the Term Life quote we discussed.", date: "Today 10:30 AM" },
  { type: "sms", direction: "inbound", text: "Thanks! Looking forward to reviewing it.", date: "Today 10:45 AM" },
  { type: "call", direction: "outbound", duration: "2:30", date: "Yesterday 3:00 PM", disposition: "Follow Up" },
  { type: "sms", direction: "outbound", text: "Hi John, following up on our conversation about life insurance options.", date: "2 days ago 9:00 AM" },
];

const Conversations: React.FC = () => {
  const [active, setActive] = useState(0);
  const [filter, setFilter] = useState("All");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Conversations</h1>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-0 bg-card rounded-xl border overflow-hidden" style={{ height: "calc(100vh - 180px)" }}>
        {/* Left Panel */}
        <div className="lg:col-span-2 border-r flex flex-col">
          <div className="p-3 border-b space-y-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" placeholder="Search conversations..." className="w-full h-9 pl-9 pr-4 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div className="flex gap-1">
              {["All", "Calls", "SMS", "Email"].map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-medium sidebar-transition ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>{f}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.map((c, i) => (
              <button
                key={c.name}
                onClick={() => setActive(i)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b sidebar-transition ${active === i ? "bg-primary/5" : "hover:bg-accent/50"}`}
              >
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{c.name.split(" ").map(w => w[0]).join("")}</div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-accent flex items-center justify-center text-muted-foreground">{channelIcons[c.channel]}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-foreground truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{c.time}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{c.preview}</p>
                </div>
                {c.unread > 0 && <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">{c.unread}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Right Panel */}
        <div className="lg:col-span-3 flex flex-col">
          {/* Contact Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{conversations[active].name.split(" ").map(w => w[0]).join("")}</div>
              <div>
                <p className="font-semibold text-foreground">{conversations[active].name}</p>
                <p className="text-xs text-muted-foreground">(555) 123-4567</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 sidebar-transition"><Phone className="w-4 h-4" /></button>
              <button className="w-8 h-8 rounded-lg bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition"><MessageSquare className="w-4 h-4" /></button>
              <button className="w-8 h-8 rounded-lg bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition"><Mail className="w-4 h-4" /></button>
            </div>
          </div>

          {/* Thread */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {thread.map((m, i) => (
              <div key={i} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                {m.type === "call" ? (
                  <div className="bg-accent/50 rounded-xl px-4 py-3 max-w-[80%]">
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">{m.direction === "outbound" ? "Outbound" : "Inbound"} Call</span>
                      <span className="text-xs text-muted-foreground">{m.duration}</span>
                      {m.disposition && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{m.disposition}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{m.date}</p>
                    <button className="flex items-center gap-1 mt-2 text-xs text-primary hover:underline"><Play className="w-3 h-3" /> Play Recording</button>
                  </div>
                ) : (
                  <div className={`rounded-xl px-4 py-3 max-w-[80%] ${m.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-accent text-foreground"}`}>
                    <p className="text-sm">{m.text}</p>
                    <p className={`text-xs mt-1 ${m.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{m.date}</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Compose */}
          <div className="border-t p-3 shrink-0">
            <div className="flex gap-1 mb-2">
              {["SMS", "Email"].map((t) => (
                <button key={t} className={`px-3 py-1 rounded-md text-xs font-medium sidebar-transition ${t === "SMS" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>{t}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <input type="text" placeholder="Type a message..." className="flex-1 px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
              <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition">Send</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Conversations;
