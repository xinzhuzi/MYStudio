import {
  Coffee,
  HardDrive,
  Image as ImageIcon,
  Key,
  Layers,
  Mic2,
  Palette,
  Terminal,
  Upload,
} from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export const SETTINGS_TABS = [
  { value: "appearance", label: "外观" },
  { value: "api", label: "API 管理" },
  { value: "imageSize", label: "图片规格" },
  { value: "python", label: "Python 配置" },
  { value: "tts", label: "TTS 配置" },
  { value: "advanced", label: "高级选项" },
  { value: "imagehost", label: "图床配置" },
  { value: "storage", label: "存储" },
  { value: "development", label: "开发" },
  { value: "support", label: "请作者喝杯咖啡" },
] as const;

export const DEFAULT_SETTINGS_TAB = "appearance";
export type SettingsTabId = typeof SETTINGS_TABS[number]["value"];

function renderSettingsTabIcon(value: SettingsTabId) {
  switch (value) {
    case "appearance":
      return <Palette className="h-4 w-4 mr-2" />;
    case "api":
      return <Key className="h-4 w-4 mr-2" />;
    case "imageSize":
      return <ImageIcon className="h-4 w-4 mr-2" />;
    case "python":
      return <Terminal className="h-4 w-4 mr-2" />;
    case "tts":
      return <Mic2 className="h-4 w-4 mr-2" />;
    case "advanced":
      return <Layers className="h-4 w-4 mr-2" />;
    case "imagehost":
      return <Upload className="h-4 w-4 mr-2" />;
    case "storage":
      return <HardDrive className="h-4 w-4 mr-2" />;
    case "development":
      return <Terminal className="h-4 w-4 mr-2" />;
    case "support":
      return <Coffee className="h-4 w-4 mr-2" />;
  }
}

type SettingsTabsBarProps = {
  isImageHostConfigured: boolean;
};

export function SettingsTabsBar({ isImageHostConfigured }: SettingsTabsBarProps) {
  return (
    <div className="settings-tabs-bar border-b border-border px-6">
      <TabsList className="h-12 bg-transparent p-0 gap-4">
        {SETTINGS_TABS.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 h-12"
          >
            {renderSettingsTabIcon(tab.value)}
            {tab.label}
            {tab.value === "imagehost" && isImageHostConfigured && (
              <span className="ml-1 w-2 h-2 bg-green-500 rounded-full" />
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}
