import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  CharacterIdentityAnchors,
  CharacterNegativePrompt,
  PromptLanguage,
} from "@/types/script";

type CharacterCalibrationSectionProps = {
  hasCalibrationData: boolean;
  identityAnchors: CharacterIdentityAnchors | undefined;
  setIdentityAnchors: Dispatch<SetStateAction<CharacterIdentityAnchors | undefined>>;
  charNegativePrompt: CharacterNegativePrompt | undefined;
  setCharNegativePrompt: Dispatch<SetStateAction<CharacterNegativePrompt | undefined>>;
  visualPromptEn: string;
  setVisualPromptEn: Dispatch<SetStateAction<string>>;
  visualPromptZh: string;
  setVisualPromptZh: Dispatch<SetStateAction<string>>;
  promptLanguage: PromptLanguage;
  scriptProject?: { promptLanguage?: PromptLanguage } | null;
  calibrationExpanded: boolean;
  setCalibrationExpanded: Dispatch<SetStateAction<boolean>>;
  isManuallyModified: boolean;
  setIsManuallyModified: Dispatch<SetStateAction<boolean>>;
  isGenerating: boolean;
};

export function CharacterCalibrationSection(props: CharacterCalibrationSectionProps) {
  const {
    hasCalibrationData,
    identityAnchors,
    setIdentityAnchors,
    charNegativePrompt,
    setCharNegativePrompt,
    visualPromptEn,
    setVisualPromptEn,
    visualPromptZh,
    setVisualPromptZh,
    promptLanguage,
    scriptProject,
    calibrationExpanded,
    setCalibrationExpanded,
    isManuallyModified,
    setIsManuallyModified,
    isGenerating,
  } = props;

  return (
    <>
      {/* AI 校准信息折叠区 */}
                {hasCalibrationData && (
                  <div className="border rounded-lg overflow-hidden">
                    {/* 折叠区头部 */}
                    <button
                      type="button"
                      className="w-full flex items-center justify-between p-2 hover:bg-muted/50 transition-colors"
                      onClick={() => setCalibrationExpanded(!calibrationExpanded)}
                      disabled={isGenerating}
                    >
                      <div className="flex items-center gap-2">
                        {calibrationExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-xs font-medium">AI 校准信息</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {isManuallyModified ? (
                          <>
                            <AlertTriangle className="h-3 w-3 text-amber-500" />
                            <span className="text-[10px] text-amber-500">已修改</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                            <span className="text-[10px] text-green-500">已校准</span>
                          </>
                        )}
                      </div>
                    </button>
                    
                    {/* 折叠区内容 */}
                    {calibrationExpanded && (
                      <div className="border-t p-2 space-y-3 bg-muted/20">
                        {/* 6层身份锚点 */}
                        {identityAnchors && (
                          <div className="space-y-2">
                            <Label className="text-[10px] text-muted-foreground">① 骨相层</Label>
                            <div className="grid grid-cols-3 gap-1">
                              <Input
                                value={identityAnchors.faceShape || ''}
                                onChange={(e) => {
                                  setIdentityAnchors({ ...identityAnchors, faceShape: e.target.value || undefined });
                                  setIsManuallyModified(true);
                                }}
                                placeholder="脸型"
                                className="h-7 text-[10px]"
                                disabled={isGenerating}
                              />
                              <Input
                                value={identityAnchors.jawline || ''}
                                onChange={(e) => {
                                  setIdentityAnchors({ ...identityAnchors, jawline: e.target.value || undefined });
                                  setIsManuallyModified(true);
                                }}
                                placeholder="下颂"
                                className="h-7 text-[10px]"
                                disabled={isGenerating}
                              />
                              <Input
                                value={identityAnchors.cheekbones || ''}
                                onChange={(e) => {
                                  setIdentityAnchors({ ...identityAnchors, cheekbones: e.target.value || undefined });
                                  setIsManuallyModified(true);
                                }}
                                placeholder="颚骨"
                                className="h-7 text-[10px]"
                                disabled={isGenerating}
                              />
                            </div>
                            
                            <Label className="text-[10px] text-muted-foreground">② 五官层</Label>
                            <div className="grid grid-cols-2 gap-1">
                              <Input
                                value={identityAnchors.eyeShape || ''}
                                onChange={(e) => {
                                  setIdentityAnchors({ ...identityAnchors, eyeShape: e.target.value || undefined });
                                  setIsManuallyModified(true);
                                }}
                                placeholder="眼型"
                                className="h-7 text-[10px]"
                                disabled={isGenerating}
                              />
                              <Input
                                value={identityAnchors.noseShape || ''}
                                onChange={(e) => {
                                  setIdentityAnchors({ ...identityAnchors, noseShape: e.target.value || undefined });
                                  setIsManuallyModified(true);
                                }}
                                placeholder="鼻型"
                                className="h-7 text-[10px]"
                                disabled={isGenerating}
                              />
                              <Input
                                value={identityAnchors.lipShape || ''}
                                onChange={(e) => {
                                  setIdentityAnchors({ ...identityAnchors, lipShape: e.target.value || undefined });
                                  setIsManuallyModified(true);
                                }}
                                placeholder="唇型"
                                className="h-7 text-[10px]"
                                disabled={isGenerating}
                              />
                              <Input
                                value={identityAnchors.eyeDetails || ''}
                                onChange={(e) => {
                                  setIdentityAnchors({ ...identityAnchors, eyeDetails: e.target.value || undefined });
                                  setIsManuallyModified(true);
                                }}
                                placeholder="眼部细节"
                                className="h-7 text-[10px]"
                                disabled={isGenerating}
                              />
                            </div>
                            
                            <Label className="text-[10px] text-muted-foreground">③ 辨识标记层（最强锚点）</Label>
                            <Input
                              value={identityAnchors.uniqueMarks?.join(', ') || ''}
                              onChange={(e) => {
                                const marks = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                setIdentityAnchors({ ...identityAnchors, uniqueMarks: marks.length > 0 ? marks : [] });
                                setIsManuallyModified(true);
                              }}
                              placeholder="特征标记，用逗号分隔"
                              className="h-7 text-[10px]"
                              disabled={isGenerating}
                            />
                            
                            <Label className="text-[10px] text-muted-foreground">④ 色彩锚点层（Hex色值）</Label>
                            <div className="grid grid-cols-4 gap-1">
                              <div className="flex items-center gap-1">
                                <input
                                  type="color"
                                  value={identityAnchors.colorAnchors?.iris || '#000000'}
                                  onChange={(e) => {
                                    setIdentityAnchors({
                                      ...identityAnchors,
                                      colorAnchors: { ...identityAnchors.colorAnchors, iris: e.target.value }
                                    });
                                    setIsManuallyModified(true);
                                  }}
                                  className="w-6 h-6 rounded cursor-pointer"
                                  disabled={isGenerating}
                                />
                                <span className="text-[9px] text-muted-foreground">瞳</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="color"
                                  value={identityAnchors.colorAnchors?.hair || '#000000'}
                                  onChange={(e) => {
                                    setIdentityAnchors({
                                      ...identityAnchors,
                                      colorAnchors: { ...identityAnchors.colorAnchors, hair: e.target.value }
                                    });
                                    setIsManuallyModified(true);
                                  }}
                                  className="w-6 h-6 rounded cursor-pointer"
                                  disabled={isGenerating}
                                />
                                <span className="text-[9px] text-muted-foreground">发</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="color"
                                  value={identityAnchors.colorAnchors?.skin || '#000000'}
                                  onChange={(e) => {
                                    setIdentityAnchors({
                                      ...identityAnchors,
                                      colorAnchors: { ...identityAnchors.colorAnchors, skin: e.target.value }
                                    });
                                    setIsManuallyModified(true);
                                  }}
                                  className="w-6 h-6 rounded cursor-pointer"
                                  disabled={isGenerating}
                                />
                                <span className="text-[9px] text-muted-foreground">肤</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="color"
                                  value={identityAnchors.colorAnchors?.lips || '#000000'}
                                  onChange={(e) => {
                                    setIdentityAnchors({
                                      ...identityAnchors,
                                      colorAnchors: { ...identityAnchors.colorAnchors, lips: e.target.value }
                                    });
                                    setIsManuallyModified(true);
                                  }}
                                  className="w-6 h-6 rounded cursor-pointer"
                                  disabled={isGenerating}
                                />
                                <span className="text-[9px] text-muted-foreground">唇</span>
                              </div>
                            </div>
                            
                            <Label className="text-[10px] text-muted-foreground">⑤ 皮肤纹理层</Label>
                            <Input
                              value={identityAnchors.skinTexture || ''}
                              onChange={(e) => {
                                setIdentityAnchors({ ...identityAnchors, skinTexture: e.target.value || undefined });
                                setIsManuallyModified(true);
                              }}
                              placeholder="皮肤纹理描述"
                              className="h-7 text-[10px]"
                              disabled={isGenerating}
                            />
                            
                            <Label className="text-[10px] text-muted-foreground">⑥ 发型锚点层</Label>
                            <div className="grid grid-cols-2 gap-1">
                              <Input
                                value={identityAnchors.hairStyle || ''}
                                onChange={(e) => {
                                  setIdentityAnchors({ ...identityAnchors, hairStyle: e.target.value || undefined });
                                  setIsManuallyModified(true);
                                }}
                                placeholder="发型"
                                className="h-7 text-[10px]"
                                disabled={isGenerating}
                              />
                              <Input
                                value={identityAnchors.hairlineDetails || ''}
                                onChange={(e) => {
                                  setIdentityAnchors({ ...identityAnchors, hairlineDetails: e.target.value || undefined });
                                  setIsManuallyModified(true);
                                }}
                                placeholder="发际线细节"
                                className="h-7 text-[10px]"
                                disabled={isGenerating}
                              />
                            </div>
                          </div>
                        )}
                        
                        {/* 负面提示词 */}
                        {charNegativePrompt && (
                          <div className="space-y-2 pt-2 border-t">
                            <Label className="text-[10px] text-muted-foreground">负面提示词</Label>
                            <Input
                              value={charNegativePrompt.avoid?.join(', ') || ''}
                              onChange={(e) => {
                                const avoidList = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                setCharNegativePrompt({ ...charNegativePrompt, avoid: avoidList });
                                setIsManuallyModified(true);
                              }}
                              placeholder="避免元素，用逗号分隔"
                              className="h-7 text-[10px]"
                              disabled={isGenerating}
                            />
                            <Input
                              value={charNegativePrompt.styleExclusions?.join(', ') || ''}
                              onChange={(e) => {
                                const exclusions = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                setCharNegativePrompt({ ...charNegativePrompt, styleExclusions: exclusions.length > 0 ? exclusions : undefined });
                                setIsManuallyModified(true);
                              }}
                              placeholder="风格排除，用逗号分隔"
                              className="h-7 text-[10px]"
                              disabled={isGenerating}
                            />
                          </div>
                        )}
                        
                        {/* 专业视觉提示词：根据语言偏好只展示一种，编辑后直接用于生成 */}
                        {(() => {
                          const effectiveLang = promptLanguage || scriptProject?.promptLanguage || 'zh';
                          const showZh = effectiveLang === 'zh' || effectiveLang === 'zh+en';
                          const activePrompt = showZh ? visualPromptZh : visualPromptEn;
                          const setActivePrompt = showZh ? setVisualPromptZh : setVisualPromptEn;
                          const langLabel = showZh ? '中文' : '英文';
                          if (!activePrompt) return null;
                          return (
                            <div className="space-y-2 pt-2 border-t">
                              <Label className="text-[10px] text-muted-foreground">
                                视觉提示词（{langLabel}，修改后直接用于生成）
                              </Label>
                              <Textarea
                                value={activePrompt}
                                onChange={(e) => {
                                  setActivePrompt(e.target.value);
                                  setIsManuallyModified(true);
                                }}
                                placeholder={`${langLabel}提示词`}
                                className="min-h-[120px] text-xs resize-y"
                                disabled={isGenerating}
                              />
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
    </>
  );
}

