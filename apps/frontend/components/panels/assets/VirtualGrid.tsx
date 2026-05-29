"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface VirtualGridProps<T> {
  items: readonly T[];
  minColumnWidth?: number;
  rowHeight?: number;
  gap?: number;
  overscanRows?: number;
  className?: string;
  empty?: ReactNode;
  footer?: ReactNode;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
}

export function VirtualGrid<T>({
  items,
  minColumnWidth = 150,
  rowHeight = 222,
  gap = 12,
  overscanRows = 3,
  className,
  empty,
  footer,
  getKey,
  renderItem,
}: VirtualGridProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateSize = () => {
      setViewport((current) => ({
        ...current,
        width: element.clientWidth,
        height: element.clientHeight,
        scrollTop: element.scrollTop,
      }));
    };

    updateSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
  }, []);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const nextElement = scrollRef.current;
      if (!nextElement) return;
      setViewport((current) => (
        current.scrollTop === nextElement.scrollTop
          ? current
          : { ...current, scrollTop: nextElement.scrollTop }
      ));
    });
  };

  const layout = useMemo(() => {
    const safeWidth = Math.max(0, viewport.width - 32);
    const columns = Math.max(1, Math.floor((safeWidth + gap) / (minColumnWidth + gap)));
    const columnWidth = columns > 0 ? Math.floor((safeWidth - gap * (columns - 1)) / columns) : minColumnWidth;
    const rowCount = Math.ceil(items.length / columns);
    const startRow = Math.max(0, Math.floor(viewport.scrollTop / (rowHeight + gap)) - overscanRows);
    const endRow = Math.min(
      rowCount,
      Math.ceil((viewport.scrollTop + viewport.height) / (rowHeight + gap)) + overscanRows,
    );
    return {
      columns,
      columnWidth,
      rowCount,
      startIndex: startRow * columns,
      endIndex: Math.min(items.length, endRow * columns),
      totalHeight: rowCount > 0 ? rowCount * rowHeight + Math.max(0, rowCount - 1) * gap + 32 : 0,
    };
  }, [gap, items.length, minColumnWidth, overscanRows, rowHeight, viewport.height, viewport.scrollTop, viewport.width]);

  const visibleItems = useMemo(() => {
    const nodes: ReactNode[] = [];
    for (let index = layout.startIndex; index < layout.endIndex; index += 1) {
      const item = items[index];
      if (!item) continue;
      const row = Math.floor(index / layout.columns);
      const column = index % layout.columns;
      nodes.push(
        <div
          key={getKey(item, index)}
          className="absolute"
          style={{
            top: 16 + row * (rowHeight + gap),
            left: 16 + column * (layout.columnWidth + gap),
            width: layout.columnWidth,
            height: rowHeight,
          }}
        >
          {renderItem(item, index)}
        </div>,
      );
    }
    return nodes;
  }, [gap, getKey, items, layout.columnWidth, layout.columns, layout.endIndex, layout.startIndex, renderItem, rowHeight]);

  return (
    <div
      ref={scrollRef}
      className={cn("h-full overflow-y-auto overflow-x-hidden scrollbar-thin", className)}
      onScroll={handleScroll}
    >
      {items.length === 0 ? (
        empty
      ) : (
        <div className="relative" style={{ height: layout.totalHeight }}>
          {visibleItems}
        </div>
      )}
      {footer}
    </div>
  );
}
