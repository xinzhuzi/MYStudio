// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 媒体预览模态组件 (Media Preview Modals)
 * 用于全屏预览图片和视频
 * 支持: HTTP URL / data URI / local-image:// 协议
 */

import React, { useEffect, useCallback } from "react";
import { X } from "lucide-react";

interface ImagePreviewModalProps {
  imageUrl: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ImagePreviewModal({ 
  imageUrl, 
  isOpen, 
  onClose 
}: ImagePreviewModalProps) {
  // Escape 键关闭
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    // 阻止背景滚动
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;
  
  return (
    <div 
      className="fixed inset-0 z-[999] bg-black/80 flex items-center justify-center cursor-zoom-out"
      onClick={onClose}
    >
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img 
          src={imageUrl} 
          alt="Preview" 
          className="max-w-[90vw] max-h-[90vh] object-contain rounded"
        />
        <button
          onClick={onClose}
          className="absolute top-2 right-2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/60 text-xs bg-black/40 px-3 py-1 rounded-full pointer-events-none">
          点击空白处或按 Esc 关闭
        </div>
      </div>
    </div>
  );
}

interface VideoPreviewModalProps {
  videoUrl: string;
  isOpen: boolean;
  onClose: () => void;
}

export function VideoPreviewModal({ 
  videoUrl, 
  isOpen, 
  onClose 
}: VideoPreviewModalProps) {
  if (!isOpen) return null;
  
  return (
    <div 
      className="fixed inset-0 z-[999] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="relative max-w-[90vw] max-h-[90vh]">
        <video 
          src={videoUrl} 
          controls
          autoPlay
          className="max-w-full max-h-[90vh] object-contain"
        />
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="absolute top-2 right-2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
