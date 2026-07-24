"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFreedomStore, type StudioMode } from '@/stores/freedom-store';
import { ImageStudio } from './ImageStudio';
import { VideoStudio } from './VideoStudio';
import { CinemaStudio } from './CinemaStudio';
import { TtsStudio } from './TtsStudio';

export const FREEDOM_STUDIO_MODES = ['image', 'video', 'cinema', 'tts'] as const;

export function isFreedomStudioMode(value: string): value is StudioMode {
  return FREEDOM_STUDIO_MODES.includes(value as StudioMode);
}

export function FreedomView() {
  const { activeStudio, setActiveStudio } = useFreedomStore();

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <Tabs
        value={activeStudio}
        onValueChange={(v) => {
          if (isFreedomStudioMode(v)) setActiveStudio(v);
        }}
        className="flex flex-col h-full"
      >
        <div className="h-12 border-b flex items-center px-4 shrink-0">
          <TabsList className="h-9">
            <TabsTrigger value="image" className="text-sm px-4">
              🖼️ 图片工作室
            </TabsTrigger>
            <TabsTrigger value="video" className="text-sm px-4">
              🎥 视频工作室
            </TabsTrigger>
            <TabsTrigger value="cinema" className="text-sm px-4">
              🎬 电影工作室
            </TabsTrigger>
            <TabsTrigger value="tts" className="text-sm px-4">
              🎙️ TTS
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="image" className="flex-1 m-0 overflow-hidden">
          <ImageStudio />
        </TabsContent>
        <TabsContent value="video" className="flex-1 m-0 overflow-hidden">
          <VideoStudio />
        </TabsContent>
        <TabsContent value="cinema" className="flex-1 m-0 overflow-hidden">
          <CinemaStudio />
        </TabsContent>
        <TabsContent value="tts" className="flex-1 m-0 overflow-hidden">
          <TtsStudio />
        </TabsContent>
      </Tabs>
    </div>
  );
}
