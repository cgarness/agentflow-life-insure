export const metalConfig = (rank: number) => {
    if (rank === 1) {
      return {
        trophyColor: "text-yellow-400",
        border: "border-yellow-500/40",
        trophyBorder: "border-yellow-500/45",
        trophyShadow: "shadow-[0_0_28px_-2px_rgba(234,179,8,0.55)]",
        cardShadow:
          "shadow-[0_16px_48px_-16px_rgba(0,0,0,0.65),0_0_56px_-14px_rgba(234,179,8,0.38)]",
        cardRing: "ring-1 ring-yellow-500/35",
        ambientClass: "bg-gradient-to-t from-yellow-500/15 to-transparent",
        rankBadge: "bg-yellow-500 border-yellow-400 text-black",
      };
    }
    if (rank === 2) {
      return {
        trophyColor: "text-slate-300",
        border: "border-slate-400/35",
        trophyBorder: "border-slate-300/40",
        trophyShadow: "shadow-[0_0_22px_-2px_rgba(148,163,184,0.45)]",
        cardShadow:
          "shadow-[0_14px_40px_-16px_rgba(0,0,0,0.6),0_0_44px_-14px_rgba(148,163,184,0.28)]",
        cardRing: "ring-1 ring-slate-400/25",
        ambientClass: "bg-gradient-to-t from-slate-500/15 to-transparent",
        rankBadge: "bg-slate-400 border-slate-300 text-black",
      };
    }
    return {
      trophyColor: "text-orange-400",
      border: "border-orange-500/35",
      trophyBorder: "border-orange-500/40",
      trophyShadow: "shadow-[0_0_22px_-2px_rgba(251,146,60,0.45)]",
      cardShadow:
        "shadow-[0_14px_40px_-16px_rgba(0,0,0,0.6),0_0_44px_-14px_rgba(251,146,60,0.28)]",
      cardRing: "ring-1 ring-orange-500/25",
      ambientClass: "bg-gradient-to-t from-orange-500/15 to-transparent",
      rankBadge: "bg-orange-600 border-orange-500 text-white",
    };
  };

