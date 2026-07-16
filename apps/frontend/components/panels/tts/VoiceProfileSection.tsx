import type { ChangeEvent, ComponentType, ReactNode, RefObject } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getPresetVoiceOptions } from "@/lib/tts/voice-profile-capabilities";
import type { TtsEngine, VoiceProfile } from "@/types/tts";

type SelectProps = { value: string; onValueChange: (value: string) => void; children: ReactNode; className?: string };

export interface VoiceProfileSectionProps {
  profiles: VoiceProfile[]; name: string; language: string; mode: "preset" | "clone"; engine: TtsEngine; modelSize: string;
  voiceId: string; referencePath: string; referenceText: string; instruct: string; uploading: boolean;
  voices: Array<{ id: string; name: string; gender: string; engineLabel: string }>;
  presetSelection: { engine: TtsEngine } | null; supportsInstruction: boolean; referenceInputRef: RefObject<HTMLInputElement | null>;
  Select: ComponentType<SelectProps>; onName: (v: string) => void; onLanguage: (v: string) => void; onMode: (v: "preset" | "clone") => void;
  onEngine: (v: TtsEngine) => void; onModelSize: (v: string) => void; onVoice: (v: string) => void; onReferencePath: (v: string) => void;
  onReferenceText: (v: string) => void; onInstruct: (v: string) => void; onUpload: (e: ChangeEvent<HTMLInputElement>) => void; onCreate: () => void;
}

export function VoiceProfileSection(props: VoiceProfileSectionProps) {
  const { Select, profiles, voices, referenceInputRef } = props;
  return <section className="tts-glass-card rounded-2xl border border-border bg-card/50 backdrop-blur-xl p-5">
    <div className="mb-4 flex items-center justify-between gap-3"><div><h4 className="text-sm font-semibold text-foreground">声线库</h4><p className="mt-1 text-xs text-muted-foreground">全局 VoiceProfile；分镜内再把旁白或角色绑定到具体 profile。</p></div><span className="text-xs text-muted-foreground">{profiles.length} 个 profile</span></div>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_150px_160px]"><div><Label className="text-xs text-muted-foreground">名称</Label><Input value={props.name} onChange={e => props.onName(e.target.value)} className="mt-1" /></div>
      <div><Label className="text-xs text-muted-foreground">语言</Label><Select value={props.language} onValueChange={props.onLanguage} className="mt-1"><option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option><option value="es">Español</option><option value="fr">Français</option></Select></div>
      <div><Label className="text-xs text-muted-foreground">音色来源</Label><Select value={props.mode} onValueChange={v => props.onMode(v as "preset" | "clone")} className="mt-1"><option value="preset">从音色库选</option><option value="clone">上传参考音频克隆</option></Select></div>
      {props.mode === "preset" ? <div className="md:col-span-3"><Label className="text-xs text-muted-foreground">音色</Label><Select value={props.voiceId} onValueChange={props.onVoice} className="mt-1"><option value="" disabled>{voices.length ? "选择音色（引擎自动确定）" : "当前语言下没有可用音色"}</option>{voices.map(v => <option key={v.id} value={v.id}>{v.name} · {v.gender === "female" ? "女" : "男"} · {v.engineLabel}</option>)}</Select></div> : <>
        <div className="md:col-span-3"><Label className="text-xs text-muted-foreground">克隆引擎</Label><Select value={props.engine} onValueChange={v => props.onEngine(v as TtsEngine)} className="mt-1"><option value="qwen">Qwen（中文最佳）</option><option value="chatterbox">Chatterbox（多语种）</option><option value="chatterbox_turbo">Chatterbox 极速版（英文）</option><option value="luxtts">LuxTTS（高速英文）</option><option value="tada">TADA 1B（英文长文本）</option></Select></div>
        <div className="md:col-span-3"><Label className="text-xs text-muted-foreground">参考音频路径</Label><div className="mt-1 flex gap-2"><Input value={props.referencePath} onChange={e => props.onReferencePath(e.target.value)} /><input ref={referenceInputRef as RefObject<HTMLInputElement>} type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg" className="hidden" onChange={props.onUpload} /><Button type="button" variant="outline" onClick={() => referenceInputRef.current?.click()} disabled={props.uploading}>{props.uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}上传</Button></div></div>
        <div className="md:col-span-3"><Label className="text-xs text-muted-foreground">参考文本</Label><Textarea value={props.referenceText} onChange={e => props.onReferenceText(e.target.value)} rows={3} className="mt-1 resize-none" /></div>
      </>}
      {props.supportsInstruction && <div className="md:col-span-3"><Label className="text-xs text-muted-foreground">风格指令</Label><Textarea value={props.instruct} onChange={e => props.onInstruct(e.target.value)} rows={2} className="mt-1" /></div>}
    </div><div className="mt-4 flex justify-end"><Button onClick={props.onCreate}>创建声线</Button></div>
    {profiles.length > 0 && <div className="mt-4 divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-white/[0.02]">{profiles.map(profile => { const options = profile.presetVoiceId ? getPresetVoiceOptions(profile.defaultEngine, profile.language) : []; const voiceLabel = profile.presetVoiceId ? (options.find(v => v.id === profile.presetVoiceId)?.name || profile.presetVoiceId) : profile.referenceAudioPath ? "克隆音色" : "—"; return <div key={profile.id} className="grid grid-cols-[1fr_120px_140px] gap-3 px-3 py-2 text-sm"><span className="truncate text-foreground">{profile.name}</span><span className="text-xs text-muted-foreground">{profile.type === "preset" ? "预设" : "克隆"}</span><span className="truncate text-xs text-muted-foreground">{voiceLabel}</span></div>; })}</div>}
  </section>;
}
