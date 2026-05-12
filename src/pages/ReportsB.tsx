import React, { useState } from "react";
import { motion } from "framer-motion";
import { 
  BarChart3, TrendingUp, Users, Phone, DollarSign, Target, 
  Map, PieChart, Activity, Zap, Clock, Calendar, 
  ArrowUpRight, ArrowDownRight, Info, Filter, Download,
  Layers, Brain, Globe, CreditCard, HeartPulse, Sparkles
} from "lucide-react";
import { 
  BarChart, Bar, LineChart, Line, AreaChart, Area, 
  PieChart as RePieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ComposedChart, Scatter
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";

// --- MOCK DATA ---
const KPI_DATA = [
  { label: "Total Revenue", value: "$428.5k", delta: "+12.5%", isPositive: true, icon: DollarSign, color: "from-emerald-500 to-teal-400" },
  { label: "Total Calls", value: "24,892", delta: "+8.2%", isPositive: true, icon: Phone, color: "from-blue-500 to-indigo-400" },
  { label: "Sales Conversion", value: "18.4%", delta: "-2.1%", isPositive: false, icon: Target, color: "from-purple-500 to-pink-400" },
  { label: "Avg Talk Time", value: "4m 12s", delta: "+14s", isPositive: true, icon: Clock, color: "from-amber-500 to-orange-400" },
];

const REVENUE_TREND = [
  { name: "Mon", revenue: 42000, calls: 2400 },
  { name: "Tue", revenue: 38000, calls: 2100 },
  { name: "Wed", revenue: 52000, calls: 2800 },
  { name: "Thu", revenue: 48000, calls: 2600 },
  { name: "Fri", revenue: 61000, calls: 3200 },
  { name: "Sat", revenue: 25000, calls: 1200 },
  { name: "Sun", revenue: 18000, calls: 800 },
];

const DISPOSITION_DATA = [
  { name: "Sold", value: 450, color: "hsl(var(--primary))" },
  { name: "Follow Up", value: 300, color: "#6366f1" },
  { name: "Not Interested", value: 200, color: "#94a3b8" },
  { name: "No Answer", value: 500, color: "#cbd5e1" },
  { name: "Wrong Number", value: 100, color: "#ef4444" },
];

const AGENT_SKILLS = [
  { subject: 'Closing', A: 120, B: 110, fullMark: 150 },
  { subject: 'Empathy', A: 98, B: 130, fullMark: 150 },
  { subject: 'Product Knowledge', A: 86, B: 130, fullMark: 150 },
  { subject: 'Rebuttal', A: 99, B: 100, fullMark: 150 },
  { subject: 'Pace', A: 85, B: 90, fullMark: 150 },
  { subject: 'Compliance', A: 65, B: 85, fullMark: 150 },
];

const STATE_PERFORMANCE = [
  { state: "TX", revenue: 85000, leads: 1200, cpa: 24.5 },
  { state: "FL", revenue: 72000, leads: 1050, cpa: 28.2 },
  { state: "CA", revenue: 68000, leads: 980, cpa: 31.0 },
  { state: "OH", revenue: 42000, leads: 600, cpa: 22.8 },
  { state: "GA", revenue: 39000, leads: 550, cpa: 25.4 },
];

const CAMPAIGN_ROI = [
  { name: "Final Expense Pro", spend: 12000, revenue: 48000, roi: 4.0 },
  { name: "Term Life Alpha", spend: 8500, revenue: 22000, roi: 2.6 },
  { name: "Medicare Flex", spend: 15000, revenue: 55000, roi: 3.7 },
  { name: "Legacy Builder", spend: 5000, revenue: 18000, roi: 3.6 },
];

const INSIGHTS = [
  { title: "Peak Performance Hour", detail: "Calls between 2 PM and 4 PM EST have a 24% higher connection rate.", icon: Zap, type: "success" },
  { title: "Lead Source Fatigue", detail: "Facebook Lead Gen source in Texas shows a 15% drop in ROI over 7 days.", icon: HeartPulse, type: "warning" },
  { title: "New Top Agent", detail: "Sarah Jenkins closed 12 policies today, setting a new agency record.", icon: Sparkles, type: "primary" },
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

const PremiumCard: React.FC<{ children: React.ReactNode; className?: string; title?: string }> = ({ children, className, title }) => (
  <Card className={`relative overflow-hidden border-slate-200/50 dark:border-slate-800/50 bg-white/40 dark:bg-slate-950/40 backdrop-blur-xl shadow-xl transition-all hover:shadow-2xl hover:border-primary/20 ${className}`}>
    {title && (
      <div className="px-6 py-4 border-b border-slate-200/50 dark:border-slate-800/50 flex items-center justify-between">
        <h3 className="font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
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
  const [activeTab, setActiveTab] = useState("overview");

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
            Executive Insights <span className="text-primary">B</span>
          </motion.h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Real-time intelligence and advanced business analytics.</p>
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
            Advanced
          </Button>

          <Button className="shadow-lg shadow-primary/20">
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {/* KPI Ribbon */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {KPI_DATA.map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
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
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: "65%" }}
                  transition={{ duration: 1, delay: i * 0.2 }}
                  className={`h-full bg-gradient-to-r ${kpi.color}`}
                />
              </div>
            </PremiumCard>
          </motion.div>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column - Main Trends */}
        <div className="lg:col-span-2 space-y-8">
          
          <PremiumCard title="Revenue & Activity Over Time">
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
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(15, 23, 42, 0.9)', 
                      border: 'none', 
                      borderRadius: '12px',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                      color: '#fff'
                    }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
                  <Bar dataKey="calls" barSize={40} fill="hsl(var(--primary)/0.2)" radius={[6, 6, 0, 0]} />
                  <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-6 mt-4 justify-center">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <span className="text-xs text-slate-500 font-medium">Revenue</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-primary/20" />
                <span className="text-xs text-slate-500 font-medium">Call Volume</span>
              </div>
            </div>
          </PremiumCard>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <PremiumCard title="Geographic Revenue (Top 5 States)">
              <div className="space-y-4">
                {STATE_PERFORMANCE.map((item, idx) => (
                  <div key={item.state} className="group cursor-pointer">
                    <div className="flex justify-between items-center mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold w-6">{item.state}</span>
                        <span className="text-xs text-slate-500">${(item.revenue/1000).toFixed(1)}k</span>
                      </div>
                      <span className="text-xs font-semibold text-primary">ROI: {(item.revenue / (item.leads * 15)).toFixed(1)}x</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${(item.revenue / 85000) * 100}%` }}
                        transition={{ duration: 1, delay: idx * 0.1 }}
                        className="h-full bg-primary group-hover:bg-primary/80 transition-colors"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </PremiumCard>

            <PremiumCard title="Campaign Performance (ROI)">
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={CAMPAIGN_ROI} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" hide />
                    <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '12px', border: 'none' }} />
                    <Bar dataKey="roi" radius={[0, 4, 4, 0]}>
                      {CAMPAIGN_ROI.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index % 2 === 0 ? 'hsl(var(--primary))' : 'hsl(var(--primary)/0.6)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 text-xs text-center text-slate-500 italic">ROI based on lead spend vs closed premium</div>
            </PremiumCard>
          </div>
        </div>

        {/* Right Column - Secondary Stats */}
        <div className="space-y-8">
          
          <PremiumCard title="Disposition Velocity">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={DISPOSITION_DATA}
                    innerRadius={70}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {DISPOSITION_DATA.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </RePieChart>
              </ResponsiveContainer>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                <p className="text-3xl font-bold">1,550</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Total Leads</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 mt-2">
              {DISPOSITION_DATA.map(d => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 truncate">{d.name}</span>
                  <span className="text-[11px] font-bold ml-auto">{Math.round((d.value/1550)*100)}%</span>
                </div>
              ))}
            </div>
          </PremiumCard>

          <PremiumCard title="AI Intelligence Hub">
            <div className="space-y-5">
              {INSIGHTS.map((insight, i) => (
                <div key={insight.title} className="flex gap-4 group">
                  <div className={`p-2.5 rounded-xl shrink-0 ${
                    insight.type === 'success' ? 'bg-emerald-500/10 text-emerald-500' :
                    insight.type === 'warning' ? 'bg-amber-500/10 text-amber-500' : 'bg-primary/10 text-primary'
                  }`}>
                    <insight.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-primary transition-colors">{insight.title}</h4>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{insight.detail}</p>
                  </div>
                </div>
              ))}
              <Button variant="ghost" className="w-full text-xs text-primary font-bold hover:bg-primary/5">
                Generate Weekly Summary <ArrowUpRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </PremiumCard>

          <PremiumCard title="Team Skill Matrix">
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={AGENT_SKILLS}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Radar name="Team Avg" dataKey="A" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.6} />
                  <Radar name="Target" dataKey="B" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </PremiumCard>
        </div>

      </div>

      {/* Footer / Detailed Tables Placeholder */}
      <div className="pt-8 border-t border-slate-200/50 dark:border-slate-800/50">
        <SectionHeader title="Drill-Down Analytics" subtitle="Granular data exploration across all dimensions" />
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <PremiumCard className="hover:scale-[1.02] cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl"><Users className="w-6 h-6" /></div>
              <div>
                <p className="text-sm font-bold">Agent Scorecards</p>
                <p className="text-xs text-slate-500">Individual performance metrics</p>
              </div>
            </div>
          </PremiumCard>
          <PremiumCard className="hover:scale-[1.02] cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-500/10 text-purple-500 rounded-xl"><Layers className="w-6 h-6" /></div>
              <div>
                <p className="text-sm font-bold">Lead Attribution</p>
                <p className="text-xs text-slate-500">Multichannel tracking analysis</p>
              </div>
            </div>
          </PremiumCard>
          <PremiumCard className="hover:scale-[1.02] cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-xl"><CreditCard className="w-6 h-6" /></div>
              <div>
                <p className="text-sm font-bold">Commissions Log</p>
                <p className="text-xs text-slate-500">Earnings and payout forecasts</p>
              </div>
            </div>
          </PremiumCard>
        </div>
      </div>
    </div>
  );
};

export default ReportsB;
