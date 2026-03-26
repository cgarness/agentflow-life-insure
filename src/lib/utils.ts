import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getStatusColorStyle(hex: string, opacity: number = 0.15) {
  if (!hex) return { backgroundColor: 'rgba(107, 114, 128, 0.15)', color: '#6B7280', borderColor: 'rgba(107, 114, 128, 0.3)' };
  
  // Handle hex colors
  if (hex.startsWith('#')) {
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return {
      backgroundColor: `rgba(${r}, ${g}, ${b}, ${opacity})`,
      color: hex,
      borderColor: `rgba(${r}, ${g}, ${b}, ${opacity * 2})`
    };
  }
  
  // Fallback for named colors or already rgba
  return { backgroundColor: `${hex}26`, color: hex, borderColor: `${hex}4D` };
}
