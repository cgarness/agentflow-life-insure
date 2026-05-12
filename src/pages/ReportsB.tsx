import React, { useState } from "react";
import { motion } from "framer-motion";
import { 
  BarChart3, TrendingUp, Users, Phone, DollarSign, Target, 
  Map, PieChart, Activity, Zap, Clock, Calendar, 
  ArrowUpRight, ArrowDownRight, Info, Filter, Download,
  Layers, Brain, Globe, CreditCard, HeartPulse, Sparkles,
  PhoneIncoming, PhoneOutgoing, MessageSquare, Voicemail,
  ShieldCheck, ZapOff, Timer, Gauge, ListFilter, MapPin
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

// --- MOCK DATA ---
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

const COMM_STATS = [
  { label: "Inbound", value: "4,210", icon: PhoneIncoming, color: "text-blue-500", bg: "bg-blue-500/10" },
  { label: "Outbound", value: "18,450", icon: PhoneOutgoing, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { label: "SMS", value: "12,100", icon: MessageSquare, color: "text-purple-500", bg: "bg-purple-500/10" },
  { label: "Voicemails", value: "3,840", icon: Voicemail, color: "text-amber-500", bg: "bg-amber-500/10" },
];

const FUNNEL_DATA = [
  { step: "Total Leads", count: 12000, color: "bg-primary/20" },
  { step: "Attempts", count: 8500, color: "bg-primary/40" },
  { step: "Connections", count: 3200, color: "bg-primary/60" },
  { step: "Appointments", count: 850, color: "bg-primary/80" },
  { step: "Sales", count: 450, color: "bg-primary" },
];

const HEATMAP_DATA = [
  { hour: '8am', mon: 10, tue: 12, wed: 15, thu: 11, fri: 14 },
  { hour: '10am', mon: 45, tue: 52, wed: 60, thu: 48, fri: 55 },
  { hour: '12pm', mon: 30, tue: 35, wed: 40, thu: 32, fri: 38 },
  { hour: '2pm', mon: 65, tue: 72, wed: 80, thu: 70, fri: 75 },
  { hour: '4pm', mon: 50, tue: 55, wed: 62, thu: 52, fri: 58 },
  { hour: '6pm', mon: 20, tue: 22, wed: 25, thu: 21, fri: 24 },
];

const LEAD_SOURCES = [
  { source: "Facebook Ads", leads: 4500, cost: "$12.5k", cpl: "$2.77", revenue: "$142k", roi: "11.3x" },
  { source: "Google Search", leads: 2100, cost: "$8.4k", cpl: "$4.00", revenue: "$98k", roi: "11.6x" },
  { source: "Direct Mail", leads: 850, cost: "$15.0k", cpl: "$17.65", revenue: "$55k", roi: "3.6x" },
  { source: "TikTok Inbound", leads: 3200, cost: "$4.2k", cpl: "$1.31", revenue: "$84k", roi: "20.0x" },
];

const DURATION_DATA = [
  { name: '0-1m', value: 4500 },
  { name: '1-3m', value: 3200 },
  { name: '3-7m', value: 1800 },
  { name: '7-15m', value: 950 },
  { name: '15m+', value: 400 },
];

const EFFICIENCY_DATA = [
  { agent: "Sarah J.", talk: 72, idle: 28 },
  { agent: "Mike R.", talk: 65, idle: 35 },
  { agent: "Alex K.", talk: 81, idle: 19 },
  { agent: "David W.", talk: 58, idle: 42 },
];

// --- COMPONENTS ---

const SectionHeader: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <div className="mb-6">
    <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
      <div className="w-1.5 h-6 bg-primary rounded-full" />
      {title}
    </h2>
    {subtitle && <p className="text-sm text-muted-foreground ml-3.5">{subtitle}</p>}
  </div>
);

const PremiumCard: React.FC<{ children: React.ReactNode; className?: string; title?: string; badge?: string }> = ({ children, className, title, badge }) => (
  <Card className={`relative overflow-hidden border-slate-200/50 dark:border-slate-800/50 bg-white/40 dark:bg-slate-950/40 backdrop-blur-xl shadow-xl transition-all hover:shadow-2xl hover:border-primary/20 ${className}`}>
    {title && (
      <div className="px-6 py-4 border-b border-slate-200/50 dark:border-slate-800/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
          {badge && <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{badge}</Badge>}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400">
          <Info className="w-4 h-4" />
        </Button>
      </div>
    )}
    <div className="p-6">
      {children}
    </div>
  </Card>
);

const ReportsB: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 p-6 space-y-8 animate-in fade-in duration-700">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <motion.h1 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-500 dark:from-white dark:to-slate-400"
          >
            Omni-Analytics <span className="text-primary">B</span>
          </motion.h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Holistic agency performance engine with premium visualization.</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Select defaultValue="30d">
            <SelectTrigger className="w-[180px] bg-white/50 dark:bg-slate-900/50 backdrop-blur-md border-slate-200/50 dark:border-slate-800/50">
              <Calendar className="w-4 h-4 mr-2 text-primary" />
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="ytd">Year to Date</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-md">
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </Button>

          <Button className="shadow-lg shadow-primary/20">
            <Download className="w-4 h-4 mr-2" />
            Full Export
          </Button>
        </div>
      </div>

      {/* 1. KPI Ribbon (Original Reports Section: Agent Performance Overview) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {KPI_DATA.map((kpi, i) => (
          <motion.div key={kpi.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <PremiumCard className="group h-full">
              <div className="flex justify-between items-start mb-4">
                <div className={`p-3 rounded-2xl bg-gradient-to-br ${kpi.color} shadow-lg shadow-primary/10 text-white`}>
                  <kpi.icon className="w-6 h-6" />
                </div>
                <Badge variant={kpi.isPositive ? "success" : "destructive"} className="px-2 py-1 flex items-center gap-1">
                  {kpi.isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {kpi.delta}
                </Badge>
              </div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{kpi.label}</p>
              <h3 className="text-3xl font-bold text-slate-900 dark:text-slate-50 mt-1">{kpi.value}</h3>
              <div className="mt-4 w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: "65%" }} transition={{ duration: 1, delay: i * 0.2 }} className={`h-full bg-gradient-to-r ${kpi.color}`} />
              </div>
            </PremiumCard>
          </motion.div>
        ))}
      </div>

      {/* 2. Primary Volume & Communication (Original Reports: Call Volume Chart & Communications Stats) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <PremiumCard title="Activity & Sales Trends" badge="Live Trend">
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={REVENUE_TREND}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <Tooltip contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', border: 'none', borderRadius: '12px', color: '#fff' }} />
                  <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
                  <Bar yAxisId="right" dataKey="sold" barSize={30} fill="hsl(var(--primary)/0.2)" radius={[6, 6, 0, 0]} />
                  <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-6 mt-4 justify-center">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-primary" /><span className="text-xs text-slate-500 font-medium">Revenue</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-primary/20" /><span className="text-xs text-slate-500 font-medium">Policies Sold</span></div>
            </div>
          </PremiumCard>
        </div>

        <div className="space-y-6">
          <SectionHeader title="Channels" subtitle="Communication volume breakdown" />
          <div className="grid grid-cols-2 gap-4">
            {COMM_STATS.map((stat) => (
              <PremiumCard key={stat.label} className="p-4">
                <div className={`w-10 h-10 rounded-xl ${stat.bg} ${stat.color} flex items-center justify-center mb-3`}>
                  <stat.icon className="w-5 h-5" />
                </div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400">{stat.label}</p>
                <p className="text-xl font-extrabold text-slate-800 dark:text-slate-100">{stat.value}</p>
              </PremiumCard>
            ))}
          </div>
          <PremiumCard className="p-4 bg-primary text-primary-foreground">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-widest opacity-80">Answer Rate</p>
              <Gauge className="w-4 h-4 opacity-80" />
            </div>
            <p className="text-3xl font-black">68.4%</p>
            <div className="mt-3 h-1.5 w-full bg-white/20 rounded-full overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: "68.4%" }} className="h-full bg-white" />
            </div>
          </PremiumCard>
        </div>
      </div>

      {/* 3. Funnel & Dispositions (Original Reports: Call Flow Analysis & Dispositions Pie) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <PremiumCard title="Conversion Funnel" badge="Lead to Sale">
          <div className="space-y-4 py-4">
            {FUNNEL_DATA.map((item, i) => (
              <div key={item.step} className="relative">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{item.step}</span>
                  <span className="text-xs font-black">{item.count.toLocaleString()}</span>
                </div>
                <div className="h-8 w-full bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }} 
                    animate={{ width: `${(item.count / 12000) * 100}%` }} 
                    transition={{ delay: i * 0.1 }}
                    className={`h-full ${item.color} flex items-center px-3`}
                  >
                    {i > 0 && (
                      <span className="text-[10px] font-bold text-white/80">
                        {Math.round((item.count / FUNNEL_DATA[i-1].count) * 100)}% conversion
                      </span>
                    )}
                  </motion.div>
                </div>
              </div>
            ))}
          </div>
        </PremiumCard>

        <PremiumCard title="Disposition Deep-Dive">
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie data={DISPOSITION_DATA} innerRadius={60} outerRadius={85} paddingAngle={5} dataKey="value">
                  {DISPOSITION_DATA.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </RePieChart>
            </ResponsiveContainer>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
              <p className="text-2xl font-black">450</p>
              <p className="text-[10px] text-slate-400 uppercase font-bold">Total Sales</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {DISPOSITION_DATA.map(d => (
              <div key={d.name} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="text-[10px] font-medium text-slate-500 truncate">{d.name}</span>
              </div>
            ))}
          </div>
        </PremiumCard>

        <PremiumCard title="AI Intelligence Matrix" badge="Predictive">
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={FUNNEL_DATA.map(f => ({ subject: f.step, A: f.count / 100, fullMark: 150 }))}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Radar name="Performance" dataKey="A" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.6} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 p-3 rounded-xl bg-primary/5 border border-primary/10">
            <div className="flex items-center gap-2 mb-1">
              <Brain className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold">AI Insight</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">Appointments are trending 14% higher when follow-up occurs within 3 minutes of initial lead ingestion.</p>
          </div>
        </PremiumCard>
      </div>

      {/* 4. Geographic & Heatmaps (Original Reports: Geographic Heatmap & Calling Heatmap) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <PremiumCard title="Regional Revenue Matrix" badge="Map View">
          <div className="h-[350px] flex items-center justify-center relative">
            {/* Mock Map Visual */}
            <div className="absolute inset-0 flex items-center justify-center opacity-10">
              <Globe className="w-64 h-64" />
            </div>
            <div className="w-full space-y-4 relative z-10">
              {[
                { state: "Texas", rev: "$85,400", leads: 1200, color: "bg-emerald-500" },
                { state: "Florida", rev: "$72,100", leads: 1050, color: "bg-blue-500" },
                { state: "California", rev: "$68,900", leads: 980, color: "bg-purple-500" },
                { state: "Georgia", rev: "$42,300", leads: 550, color: "bg-amber-500" },
              ].map(s => (
                <div key={s.state} className="flex items-center gap-4">
                  <div className={`w-3 h-3 rounded-full ${s.color}`} />
                  <span className="text-sm font-bold w-24">{s.state}</span>
                  <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${(parseInt(s.rev.replace(/\$|,/g, '')) / 85400) * 100}%` }} className={`h-full ${s.color}`} />
                  </div>
                  <span className="text-sm font-black w-20 text-right">{s.rev}</span>
                </div>
              ))}
            </div>
          </div>
        </PremiumCard>

        <PremiumCard title="Calling Density Map" badge="Time of Day">
          <div className="h-[350px]">
             <ResponsiveContainer width="100%" height="100%">
               <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                 <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                 <XAxis dataKey="hour" name="Hour" />
                 <YAxis dataKey="mon" name="Activity" hide />
                 <ZAxis dataKey="mon" range={[20, 1000]} name="Volume" />
                 <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                 <Scatter name="Monday" data={HEATMAP_DATA} fill="hsl(var(--primary))" />
               </ScatterChart>
             </ResponsiveContainer>
          </div>
          <div className="mt-2 flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            <span>Early Morning</span>
            <span>Peak Activity (2PM - 4PM)</span>
            <span>Late Evening</span>
          </div>
        </PremiumCard>
      </div>

      {/* 5. Efficiency & Duration (Original Reports: Agent Efficiency & Call Duration Analysis) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <PremiumCard title="Talk Time Spectrum" badge="Distribution">
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={DURATION_DATA}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none' }} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-center text-slate-500 mt-2">Majority of high-converting calls last between 7-15 minutes.</p>
        </PremiumCard>

        <PremiumCard title="Agent Efficiency Benchmark" badge="Talk vs Idle">
          <div className="space-y-6 py-2">
            {EFFICIENCY_DATA.map(a => (
              <div key={a.agent}>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-sm font-bold">{a.agent}</span>
                  <span className="text-xs font-bold text-primary">{a.talk}% Talk Time</span>
                </div>
                <div className="flex h-4 w-full rounded-full overflow-hidden">
                  <div className="bg-primary h-full transition-all" style={{ width: `${a.talk}%` }} />
                  <div className="bg-slate-100 dark:bg-slate-800 h-full flex-1" />
                </div>
              </div>
            ))}
          </div>
        </PremiumCard>
      </div>

      {/* 6. Lead Source ROI (Original Reports: Lead Source Table) */}
      <PremiumCard title="Lead Source Profitability" badge="Financial Analysis">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-slate-200/50 dark:border-slate-800/50">
              <TableHead className="text-[10px] uppercase font-black">Source</TableHead>
              <TableHead className="text-[10px] uppercase font-black">Volume</TableHead>
              <TableHead className="text-[10px] uppercase font-black">Investment</TableHead>
              <TableHead className="text-[10px] uppercase font-black text-primary">CPL</TableHead>
              <TableHead className="text-[10px] uppercase font-black">Revenue</TableHead>
              <TableHead className="text-[10px] uppercase font-black text-right">ROI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {LEAD_SOURCES.map((source) => (
              <TableRow key={source.source} className="border-slate-200/50 dark:border-slate-800/50 hover:bg-primary/5 transition-colors">
                <TableCell className="font-bold">{source.source}</TableCell>
                <TableCell className="text-slate-500">{source.leads.toLocaleString()}</TableCell>
                <TableCell className="text-slate-500">{source.cost}</TableCell>
                <TableCell className="font-bold text-primary">{source.cpl}</TableCell>
                <TableCell className="font-bold">{source.revenue}</TableCell>
                <TableCell className="text-right">
                   <Badge variant="success" className="font-black">{source.roi}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PremiumCard>

      {/* 7. Footer Analytics (Original Reports: Goal Tracking) */}
      <div className="pt-8 border-t border-slate-200/50 dark:border-slate-800/50">
        <SectionHeader title="Drill-Down Analytics" subtitle="Granular data exploration across all dimensions" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <PremiumCard className="hover:scale-[1.02] cursor-pointer" title="Monthly Goal Progress">
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-bold mb-1"><span>Sales Target</span><span>$450k / $500k</span></div>
                <Progress value={90} className="h-2" />
              </div>
              <div>
                <div className="flex justify-between text-xs font-bold mb-1"><span>Call Target</span><span>24k / 30k</span></div>
                <Progress value={80} className="h-2" />
              </div>
            </div>
          </PremiumCard>
          <PremiumCard className="hover:scale-[1.02] cursor-pointer" title="Retention Analysis">
             <div className="flex items-center gap-4">
               <div className="p-3 bg-purple-500/10 text-purple-500 rounded-xl"><ShieldCheck className="w-6 h-6" /></div>
               <div>
                 <p className="text-3xl font-black">94%</p>
                 <p className="text-xs text-slate-500">Policy Persistence Rate</p>
               </div>
             </div>
          </PremiumCard>
          <PremiumCard className="hover:scale-[1.02] cursor-pointer" title="System Latency">
             <div className="flex items-center gap-4">
               <div className="p-3 bg-amber-500/10 text-amber-500 rounded-xl"><Timer className="w-6 h-6" /></div>
               <div>
                 <p className="text-3xl font-black">240ms</p>
                 <p className="text-xs text-slate-500">Average Dialer Latency</p>
               </div>
             </div>
          </PremiumCard>
        </div>
      </div>
    </div>
  );
};

export default ReportsB;
