import React, { useEffect, useRef, useState } from "react";
import { ConversationHistory } from "@/components/dialer/ConversationHistory";

// ConversationHistory reverses ascending input in its flex-col-reverse feed.
const INITIAL = [
  { id: "demo-message-1", type: "sms", direction: "outbound" as const, description: "Hi Casey! Following up on your coverage request. When is a good time to talk?", created_at: "2026-10-29T21:00:00Z" },
  { id: "demo-message-2", type: "sms", direction: "inbound" as const, description: "Tomorrow morning works for me.", created_at: "2026-10-29T21:01:00Z" },
];
const REPLY = "Perfect. I will follow up tomorrow morning!";

export default function MessagingScene({ epoch }: { epoch: number }) {
  const [rows, setRows] = useState(INITIAL), [text, setText] = useState("");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const end = useRef<HTMLDivElement>(null);
  const send = () => { if (text.trim()) { setRows(old => [...old, { id: "demo-reply", type: "sms", direction: "outbound", description: text, created_at: "2026-10-29T21:02:00Z" }]); setText(""); } };
  useEffect(() => {
    setRows(INITIAL); setText(""); if (!epoch) return;
    let count = 0;
    const typing = setInterval(() => { count++; setText(REPLY.slice(0, count)); if (count >= REPLY.length) clearInterval(typing); }, 65);
    const sent = setTimeout(() => { setRows([...INITIAL, { id: "demo-reply", type: "sms", direction: "outbound", description: REPLY, created_at: "2026-10-29T21:02:00Z" }]); setText(""); }, 3650);
    return () => { clearInterval(typing); clearTimeout(sent); };
  }, [epoch]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [rows]);
  return <div className="h-full p-5">
    <ConversationHistory history={rows} loadingHistory={false} formatDateTime={date => date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
      smsTab={channel} onSmsTabChange={setChannel} messageText={text} onMessageChange={setText} subjectText="" onSubjectChange={() => {}}
      onSendMessage={send} onOpenTemplates={() => {}} selectedCallerNumber="2025550142" onCallerNumberChange={() => {}}
      availableNumbers={[]} currentUserId="demo-agent" emailConnections={[]} selectedEmailConnectionId="" onEmailConnectionChange={() => {}} historyEndRef={end} />
  </div>;
}
