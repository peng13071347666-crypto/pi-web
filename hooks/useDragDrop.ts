"use client";

import { useState, useCallback, useRef } from "react";

export function useDragDrop(onDrop: (files: File[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const hasDraggedFiles = useCallback((dataTransfer: DataTransfer) => {
    if (Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file")) return true;
    return Array.from(dataTransfer.types ?? []).includes("Files");
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    counterRef.current += 1;
    setIsDragOver(true);
  }, [hasDraggedFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
  }, [hasDraggedFiles]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (hasDraggedFiles(e.dataTransfer)) e.stopPropagation();
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, [hasDraggedFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    counterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onDrop(files);
  }, [hasDraggedFiles, onDrop]);

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
