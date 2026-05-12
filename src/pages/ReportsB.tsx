import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  BarChart3, TrendingUp, Users, Phone, DollarSign, Target, 
  Map, PieChart, Activity, Zap, Clock, Calendar, 
  ArrowUpRight, ArrowDownRight, Info, Filter, Download,
  Layers, Brain, Globe, CreditCard, HeartPulse, Sparkles,
  PhoneIncoming, PhoneOutgoing, MessageSquare, Voicemail,
  ShieldCheck, ZapOff, Timer, Gauge, ListFilter, MapPin,
  LayoutDashboard, UserCheck, Server, AlertCircle, RefreshCw,
  Search, Bell, MoreHorizontal, Trophy
} from "lucide-react";
import { 
  BarChart, Bar, LineChart, Line, AreaChart, Area, 
  PieChart as RePieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ComposedChart, Legend, ScatterChart, Scatter, ZAxis
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger as UITooltipTrigger } from "@/components/ui/tooltip";

// --- MOCK DATA ---
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8);

const KPI_DATA = [
  { label: "Total Revenue", value: "$428.5k", delta: "+12.5%", isPositive: true, icon: DollarSign, color: "from-emerald-500 to-teal-400" },
  { label: "Total Calls", value: "24,892", delta: "+8.2%", isPositive: true, icon: Phone, color: "from-blue-500 to-indigo-400" },
  { label: "Sales Conversion", value: "18.4%", delta: "-2.1%", isPositive: false, icon: Target, color: "from-purple-500 to-pink-400" },
  { label: "Avg Talk Time", value: "4m 12s", delta: "+14s", isPositive: true, icon: Clock, color: "from-amber-500 to-orange-400" },
];

const REVENUE_TREND = [
  { name: "Mon", revenue: 42000, calls: 2400, sold: 12 },
  { name: "Tue", revenue: 38000, calls: 2100, sold: 10 },
  { name: "Wed", revenue: 52000, calls: 2800, sold: 15 },
  { name: "Thu", revenue: 48000, calls: 2600, sold: 13 },
  { name: "Fri", revenue: 61000, calls: 3200, sold: 18 },
  { name: "Sat", revenue: 25000, calls: 1200, sold: 6 },
  { name: "Sun", revenue: 18000, calls: 800, sold: 4 },
];

const DISPOSITION_DATA = [
  { name: "Sold", value: 450, color: "hsl(var(--primary))" },
  { name: "Follow Up", value: 300, color: "#6366f1" },
  { name: "Not Interested", value: 200, color: "#94a3b8" },
  { name: "No Answer", value: 500, color: "#cbd5e1" },
  { name: "Wrong Number", value: 100, color: "#ef4444" },
];

const LIVE_AGENTS = [
  { name: "Sarah Jenkins", status: "In Call", duration: "12:45", leads: 42, sold: 8, mood: "😊" },
  { name: "Mike Ross", status: "Idle", duration: "02:12", leads: 38, sold: 5, mood: "😐" },
  { name: "Alex Karev", status: "In Call", duration: "05:30", leads: 51, sold: 12, mood: "🔥" },
  { name: "David West", status: "Away", duration: "24:00", leads: 22, sold: 2, mood: "😴" },
];

const HEATMAP_DATA = Array.from({ length: 7 }, () => 
  Array.from({ length: 13 }, () => Math.floor(Math.random() * 100))
);

const SYSTEM_LOGS = [
  { id: 1, event: "Call Gateway Optimized", time: "2m ago", type: "success" },
  { id: 2, event: "High Traffic Alert: Texas", time: "15m ago", type: "warning" },
  { id: 3, event: "New Lead Batch Ingested", time: "24m ago", type: "info" },
  { id: 4, event: "Carrier Timeout: AT&T", time: "1h ago", type: "error" },
];

// --- COMPONENTS ---

const SectionHeader: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <div className="mb-8">
    <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
      <div className="w-2 h-8 bg-primary rounded-full shadow-[0_0_15px_rgba(var(--primary),0.5)]" />
      {title}
    </h2>
    {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 ml-5">{subtitle}</p>}
  </div>
);

const PremiumCard: React.FC<{ children: React.ReactNode; className?: string; title?: string; badge?: string; icon?: any }> = ({ children, className, title, badge, icon: Icon }) => (
  <Card className={`group relative overflow-hidden border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-950/60 backdrop-blur-2xl shadow-sm transition-all duration-300 hover:shadow-2xl hover:border-primary/30 ${className}`}>
    {title && (
      <div className="px-6 py-5 border-b border-slate-200/40 dark:border-slate-800/40 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {Icon && <Icon className="w-4 h-4 text-primary" />}
          <h3 className="font-bold text-slate-800 dark:text-slate-200 tracking-tight">{title}</h3>
          {badge && <Badge variant="secondary" className="text-[10px] uppercase font-black px-2 py-0.5">{badge}</Badge>}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-primary transition-colors">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </div>
    )}
    <div className="p-6">
      {children}
    </div>
  </Card>
);

const ReportsB: React.FC = () => {
  const [tab, setTab] = useState("overview");

  return (
    <div className="min-h-screen bg-slate-50/30 dark:bg-[#020617] p-8 space-y-10 selection:bg-primary/20">
      
      {/* 1. Header & Quick Actions */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-8 pb-4 border-b border-slate-200/60 dark:border-slate-800/60">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 px-2 py-0">v2.0 Beta</Badge>
            <span className="text-[10px] uppercase font-black tracking-widest text-slate-400">NextGen Reporting</span>
          </div>
          <h1 className="text-4xl font-black tracking-tighter text-slate-900 dark:text-white lg:text-5xl">
            Command <span className="text-primary italic">Center</span>
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium">Holistic intelligence dashboard for the modern agency.</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-1 shadow-inner">
            {["overview", "performance", "system"].map((t) => (
              <button 
                key={t}
                onClick={() => setTab(t)}
                className={`px-6 py-2.5 rounded-xl text-xs font-bold transition-all ${tab === t ? "bg-primary text-white shadow-lg" : "text-slate-500 hover:text-slate-900 dark:hover:text-white"}`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <Button variant="outline" className="rounded-2xl border-slate-200 dark:border-slate-800 h-12 px-6 font-bold">
            <Filter className="w-4 h-4 mr-2" /> 20+ Filters
          </Button>
          <Button className="rounded-2xl h-12 px-8 font-bold shadow-xl shadow-primary/20">
            <Download className="w-4 h-4 mr-2" /> Export
          </Button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          className="space-y-10"
        >
          {tab === "overview" && (
            <>
              {/* KPI Ribbon */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {KPI_DATA.map((kpi, i) => (
                  <motion.div key={kpi.label} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}>
                    <PremiumCard className="h-full border-none shadow-none bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-950">
                      <div className="flex justify-between items-start mb-6">
                        <div className={`p-4 rounded-[2rem] bg-gradient-to-br ${kpi.color} shadow-2xl shadow-primary/20 text-white`}>
                          <kpi.icon className="w-7 h-7" />
                        </div>
                        <Badge variant={kpi.isPositive ? "success" : "destructive"} className="px-3 py-1 font-black">
                          {kpi.isPositive ? "+" : ""}{kpi.delta}
                        </Badge>
                      </div>
                      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{kpi.label}</p>
                      <h3 className="text-4xl font-black text-slate-900 dark:text-white mt-1 tracking-tight">{kpi.value}</h3>
                    </PremiumCard>
                  </motion.div>
                ))}
              </div>

              {/* Main Trends & Heatmap */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2">
                  <PremiumCard title="Sales Velocity & Connection Flow" badge="Live" icon={Activity}>
                    <div className="h-[400px] w-full mt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={REVENUE_TREND}>
                          <defs>
                            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.3} />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12, fontWeight: 600 }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12, fontWeight: 600 }} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'rgba(2, 6, 23, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1.5rem', color: '#fff', padding: '1rem' }}
                          />
                          <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={4} fillOpacity={1} fill="url(#colorRevenue)" />
                          <Line type="monotone" dataKey="calls" stroke="#6366f1" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </PremiumCard>
                </div>

                <div className="space-y-8">
                  <PremiumCard title="Calling Density (Heatmap)" badge="Efficiency" icon={Clock}>
                    <div className="grid grid-cols-14 gap-1 mt-4">
                      <div className="col-span-1" />
                      {HOURS.filter((_, i) => i % 2 === 0).map(h => (
                        <div key={h} className="col-span-2 text-[8px] font-black text-slate-400 text-center">{h > 12 ? h - 12 : h}{h >= 12 ? "p" : "a"}</div>
                      ))}
                      {DAYS.map((day, di) => (
                        <React.Fragment key={day}>
                          <div className="col-span-1 text-[9px] font-black text-slate-500 py-1">{day[0]}</div>
                          {HOURS.map((h, hi) => {
                            const val = HEATMAP_DATA[di][hi];
                            const opacity = val / 100;
                            return (
                              <div 
                                key={hi} 
                                className="aspect-square rounded-[3px] bg-primary transition-all hover:scale-125 hover:z-10 cursor-pointer shadow-sm" 
                                style={{ opacity: opacity < 0.1 ? 0.1 : opacity }}
                              />
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </div>
                    <div className="mt-6 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-2 rounded-full bg-gradient-to-r from-primary/10 to-primary" />
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Density Scale</span>
                      </div>
                      <Badge variant="success" className="text-[9px] font-black">Best Time: 2PM Mon</Badge>
                    </div>
                  </PremiumCard>

                  <PremiumCard title="Top Performing Agents" icon={Trophy}>
                    <div className="space-y-4">
                      {LIVE_AGENTS.slice(0, 3).map((agent, i) => (
                        <div key={agent.name} className="flex items-center justify-between group">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${i === 0 ? "bg-amber-500 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>
                              {i + 1}
                            </div>
                            <div>
                              <p className="text-xs font-black">{agent.name}</p>
                              <p className="text-[10px] text-slate-500">${(agent.sold * 850).toLocaleString()} Prem.</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-black text-primary">{agent.sold} Sales</p>
                            <Progress value={(agent.sold / 15) * 100} className="h-1 w-16 mt-1" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </PremiumCard>
                </div>
              </div>

              {/* Monitoring & Infrastructure */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <PremiumCard title="Live Agent Monitor" badge="Real-time" icon={UserCheck} className="lg:col-span-2">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent border-slate-200/50 dark:border-slate-800/50">
                          <TableHead className="text-[10px] font-black uppercase tracking-widest">Agent</TableHead>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest">Status</TableHead>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest">Duration</TableHead>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest">Leads</TableHead>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest">Sales</TableHead>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest text-right">Mood</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {LIVE_AGENTS.map((agent) => (
                          <TableRow key={agent.name} className="border-slate-200/50 dark:border-slate-800/50 hover:bg-primary/5 transition-colors">
                            <TableCell className="font-bold text-xs py-4">{agent.name}</TableCell>
                            <TableCell>
                              <Badge variant={agent.status === "In Call" ? "success" : agent.status === "Idle" ? "warning" : "secondary"} className="text-[9px] font-black px-2">
                                {agent.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-mono">{agent.duration}</TableCell>
                            <TableCell className="text-xs font-bold">{agent.leads}</TableCell>
                            <TableCell className="text-xs font-bold text-primary">{agent.sold}</TableCell>
                            <TableCell className="text-right text-lg">{agent.mood}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </PremiumCard>

                <PremiumCard title="System Health & Event Log" icon={Server}>
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Latency</p>
                        <p className="text-xl font-black text-primary">24ms</p>
                      </div>
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Uptime</p>
                        <p className="text-xl font-black text-emerald-500">99.9%</p>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      {SYSTEM_LOGS.map(log => (
                        <div key={log.id} className="flex gap-3 items-start group">
                          <div className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                            log.type === 'success' ? 'bg-emerald-500' :
                            log.type === 'warning' ? 'bg-amber-500' :
                            log.type === 'error' ? 'bg-rose-500' : 'bg-blue-500'
                          }`} />
                          <div className="flex-1">
                            <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">{log.event}</p>
                            <p className="text-[9px] text-slate-500">{log.time}</p>
                          </div>
                          <RefreshCw className="w-3 h-3 text-slate-300 group-hover:text-primary transition-colors cursor-pointer" />
                        </div>
                      ))}
                    </div>

                    <Button variant="ghost" className="w-full text-[10px] font-black uppercase tracking-[0.2em] hover:bg-primary/5">View Stack Trace <ArrowUpRight className="w-3 h-3 ml-2" /></Button>
                  </div>
                </PremiumCard>
              </div>
            </>
          )}

          {tab === "performance" && (
            <div className="flex items-center justify-center h-[500px] border-2 border-dashed rounded-[3rem] border-slate-200 dark:border-slate-800">
               <div className="text-center">
                 <Sparkles className="w-12 h-12 text-primary mx-auto mb-4 opacity-50" />
                 <h3 className="text-xl font-bold">Performance Deep-Dive</h3>
                 <p className="text-slate-500 text-sm mt-2">Extended agent analytics and campaign attribution coming in next iteration.</p>
               </div>
            </div>
          )}

          {tab === "system" && (
            <div className="flex items-center justify-center h-[500px] border-2 border-dashed rounded-[3rem] border-slate-200 dark:border-slate-800">
               <div className="text-center">
                 <Server className="w-12 h-12 text-primary mx-auto mb-4 opacity-50" />
                 <h3 className="text-xl font-bold">Infrastructure Monitoring</h3>
                 <p className="text-slate-500 text-sm mt-2">Real-time gateway logs and carrier reliability metrics coming soon.</p>
               </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Footer / Smart Insights */}
      <div className="pt-10 border-t border-slate-200/60 dark:border-slate-800/60">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-primary rounded-xl text-white"><Brain className="w-5 h-5" /></div>
          <div>
            <h3 className="text-lg font-black tracking-tight">AgentFlow AI Insights</h3>
            <p className="text-xs text-slate-500 font-medium">Predictive modeling based on current agency throughput.</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { title: "Lead Ingestion Spike", detail: "Inbound leads are up 214% this hour. Auto-scaling agent queues suggested.", type: "primary" },
            { title: "Burnout Alert", detail: "Mike Ross has been 'In Call' for 6 consecutive hours. Consider a forced break.", type: "warning" },
            { title: "Regional Optimization", detail: "Texas conversion is peaking. Recommended to reallocate 15% budget from Florida.", type: "success" },
          ].map((insight, i) => (
            <motion.div key={insight.title} whileHover={{ y: -5 }} className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <Badge className={insight.type === 'primary' ? "bg-primary" : insight.type === 'warning' ? "bg-amber-500" : "bg-emerald-500"}>
                  {insight.type.toUpperCase()}
                </Badge>
                <Sparkles className="w-4 h-4 text-primary opacity-50" />
              </div>
              <h4 className="font-black text-sm mb-1.5">{insight.title}</h4>
              <p className="text-xs text-slate-500 leading-relaxed font-medium">{insight.detail}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ReportsB;
