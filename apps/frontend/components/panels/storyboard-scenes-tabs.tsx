import { Clapperboard, Film } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type StoryboardScenesTab = "editing" | "trailer";

interface StoryboardScenesTabsProps {
  activeTab: StoryboardScenesTab;
  trailerCount: number;
  onActiveTabChange: (tab: StoryboardScenesTab) => void;
}

export function StoryboardScenesTabs({
  activeTab,
  trailerCount,
  onActiveTabChange,
}: StoryboardScenesTabsProps) {
  return (
    <div className="border-b -mx-4 px-4 -mt-4 pt-4">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value === "editing" || value === "trailer") {
            onActiveTabChange(value);
          }
        }}
        className="w-full"
      >
        <TabsList className="w-full justify-start h-9 rounded-none bg-transparent border-b-0 p-0">
          <TabsTrigger
            value="editing"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-9 px-4"
          >
            <Film className="h-3 w-3 mr-1" />
            分镜编辑
          </TabsTrigger>
          <TabsTrigger
            value="trailer"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-9 px-4"
          >
            <Clapperboard className="h-3 w-3 mr-1" />
            预告片 {trailerCount > 0 ? `(${trailerCount})` : ""}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
