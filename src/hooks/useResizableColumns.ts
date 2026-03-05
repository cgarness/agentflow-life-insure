import { useState, useEffect, useCallback, useRef } from "react";

interface UseResizableColumnsOptions {
  storageKey: string;
  defaultWidths: Record<string, number>;
}

export function useResizableColumns({ storageKey, defaultWidths }: UseResizableColumnsOptions) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults so new columns get a default width
        return { ...defaultWidths, ...parsed };
      }
    } catch {}
    return { ...defaultWidths };
  });

  const resizing = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const onMouseDown = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { key, startX: e.clientX, startWidth: widths[key] || defaultWidths[key] || 100 };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const diff = ev.clientX - resizing.current.startX;
      const newWidth = Math.max(60, resizing.current.startWidth + diff);
      setWidths(prev => ({ ...prev, [resizing.current!.key]: newWidth }));
    };

    const onMouseUp = () => {
      resizing.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [widths, defaultWidths]);

  // Persist to localStorage whenever widths change
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(widths));
  }, [widths, storageKey]);

  const getWidth = useCallback((key: string) => widths[key] || defaultWidths[key] || 100, [widths, defaultWidths]);

  return { getWidth, onMouseDown };
}
