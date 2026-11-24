/**
 * 资产详情·基础信息区(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):
 * 可折叠壳+名字/设定/说话内容+音色卡+提示词区(图像规范清单/源提示词/真源 JSON/
 * 实发终稿动作组、双卡目录与主体句编辑)。props 与宿主变量同名,块内零改动。
 */
import type { Dispatch, SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AssetImageKind, StudioAssetSummary } from "@/types/studio-assets";
import type { CharacterJsonInfo, CharacterPromptCatalog } from "@/lib/studio/asset-character-json";
import type { ParsedAssetNames } from "@/lib/studio/asset-names";
import type { ProjectVoiceBinding, VoiceProfile } from "@/types/tts";
import { RoleVoicePreviewButton } from "./RoleVoicePreviewButton";
import { StudioAssetCharacterPrompts } from "./studio-asset-character-prompts";
import { ChevronDown, ChevronRight, FileJson, FileText, Loader2, Volume2 } from "lucide-react";
import {
  FINAL_DRAFT_NOTE_BY_STATUS,
  TYPE_LABEL,
  displayAudioPath,
  subjectDowngradeNote,
  type FinalDraftProbe,
} from "./studio-asset-detail-helpers";

export function StudioAssetMetaRegion({
  asset,
  displayName,
  draftName,
  setDraftName,
  parsedDraftName,
  metaCollapsed,
  setMetaCollapsed,
  spokenText,
  draftSetting,
  subjectExpanded,
  setDraftDescription,
  setRecognizedText,
  setSettingEditorOpen,
  setVoiceAssignOpen,
  roleVoiceBinding,
  roleVoiceProfile,
  imageRuleRows,
  finalDraftProbe,
  handleOpenFinalDraft,
  setSourcePromptOpen,
  characterJsonInfo,
  storePromptHit,
  setCharacterJsonOpen,
  unifiedPromptCatalog,
  subjectCardEditable,
  setSubjectExpanded,
  setSubjectEditorOpen,
  subjectEditorOpen,
  focusIsI2iFamily,
  focusKind,
  subjectValue,
  handleSubjectChange,
  kindSlotActive,
  subjectMirrorActive,
}: {
  asset: StudioAssetSummary;
  displayName: string;
  draftName: string;
  setDraftName: Dispatch<SetStateAction<string>>;
  parsedDraftName: ParsedAssetNames;
  metaCollapsed: boolean;
  setMetaCollapsed: Dispatch<SetStateAction<boolean>>;
  spokenText: string;
  draftSetting: string;
  subjectExpanded: boolean;
  setDraftDescription: Dispatch<SetStateAction<string>>;
  setRecognizedText: Dispatch<SetStateAction<string | null>>;
  setSettingEditorOpen: Dispatch<SetStateAction<boolean>>;
  setVoiceAssignOpen: Dispatch<SetStateAction<boolean>>;
  roleVoiceBinding: ProjectVoiceBinding | undefined;
  roleVoiceProfile: VoiceProfile | undefined;
  imageRuleRows: Array<{ kind: AssetImageKind; aspect: string; core: boolean; count: number }>;
  finalDraftProbe: FinalDraftProbe;
  handleOpenFinalDraft: () => void;
  setSourcePromptOpen: Dispatch<SetStateAction<boolean>>;
  characterJsonInfo: CharacterJsonInfo | null;
  storePromptHit: boolean;
  setCharacterJsonOpen: Dispatch<SetStateAction<boolean>>;
  unifiedPromptCatalog: CharacterPromptCatalog | null;
  subjectCardEditable: boolean;
  setSubjectExpanded: Dispatch<SetStateAction<boolean>>;
  setSubjectEditorOpen: Dispatch<SetStateAction<boolean>>;
  subjectEditorOpen: boolean;
  focusIsI2iFamily: boolean;
  focusKind: AssetImageKind | null;
  subjectValue: string;
  handleSubjectChange: (value: string) => void;
  kindSlotActive: boolean;
  subjectMirrorActive: boolean;
}) {
  return (
    <>
              {/* ① 基础信息区(1120 三令1 更名;紧凑四行网格+可折叠,
                  折叠留摘要;保存/删除=页头常驻单真源,折叠摘要不再重复) */}
              <section className="studio-asset-meta-region rounded-lg border border-border bg-muted/30" aria-label="资产基础信息">
                <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-4 py-2">
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setMetaCollapsed((collapsed) => !collapsed)}
                    aria-expanded={!metaCollapsed}
                    aria-controls="studio-asset-meta-body"
                  >
                    {metaCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    基础信息
                  </button>
                  {metaCollapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={draftName || displayName}>
                        {displayName}
                      </span>
                      {parsedDraftName.secondaryNames.length > 0 && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          别名 {parsedDraftName.secondaryNames.length}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {!metaCollapsed && (
                  <div id="studio-asset-meta-body" className="grid grid-cols-2 gap-3 p-4">
                    {/* 1120 用户令·版式重构③:名字|设定按钮同行 → 音频配置(音色) →
                     出图提示词;设定点击弹 MD 编辑(描述+设定同框编辑+预览)。 */}
                    <section className={`min-w-0 space-y-1.5 ${asset.type === "audio" ? "col-span-2" : ""}`}>
                      <div className="text-xs font-medium text-muted-foreground">名字</div>
                      <input
                        className="w-full rounded-md border border-border bg-muted/90 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        placeholder="主名字;副名字1;副名字2"
                      />
                      {/* 1120 用户令·清理:主名字提示/英文分号提示砍除(提示文案),
                          只留副名字徽章(数据) */}
                      {parsedDraftName.secondaryNames.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          {parsedDraftName.secondaryNames.map((name) => (
                            <Badge key={name} variant="outline" className="px-1.5 py-0 text-[10px] font-medium">
                              {name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </section>
                    {/* 设定入口(1120 用户令③:与名字同行,按钮弹 MD 编辑) */}
                    {asset.type !== "audio" && (
                      <section className="flex min-w-0 flex-col gap-1.5">
                        <div className="shrink-0 text-xs font-medium text-muted-foreground">设定</div>
                        <button
                          type="button"
                          onClick={() => setSettingEditorOpen(true)}
                          className="flex h-[38px] w-full items-center gap-2 rounded-md border border-border bg-muted/90 px-3 text-left text-sm transition-colors outline-none hover:border-primary/50 focus-visible:border-primary"
                          title="打开设定 Markdown 编辑(描述+设定,源码与预览同框)"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="truncate">{(draftSetting || asset.setting || "").trim() ? "编辑设定(Markdown)" : "编写设定(Markdown)"}</span>
                        </button>
                      </section>
                    )}
                    {/* audio 型:无音色/提示词/设定卡,说话内容独占全宽 */}
                    {asset.type === "audio" && (
                      <section className="col-span-2 flex min-w-0 flex-col gap-1.5">
                        <div className="shrink-0 text-xs font-medium text-muted-foreground">说话内容</div>
                        <Textarea
                          value={spokenText}
                          onChange={(event) => {
                            setDraftDescription(event.target.value);
                            setRecognizedText(null);
                          }}
                          placeholder="暂无口播词句"
                          className="min-h-[96px] flex-1 resize-none bg-muted/90 text-xs leading-5"
                        />
                      </section>
                    )}
                    {/* 行2: 音色(仅 role,恒全宽)——1120 用户令:人物属性卡撤除,
                     与「设定」合一(属性卡本就是设定文本的只读解析视图,信息本体在
                     设定框,双框展示属冗余);音色不再钉右列,col-span-2 恒全宽 */}
                    {asset.type === "role" && (
                      <div className="col-span-2 min-w-0 h-full">
                        {(() => {
                          if (!roleVoiceBinding || !roleVoiceProfile) {
                            return (
                              <button
                                type="button"
                                onClick={() => setVoiceAssignOpen(true)}
                                className="group flex h-full w-full flex-col justify-center gap-2.5 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-left transition-colors hover:border-primary/50"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                    <Volume2 className="h-3.5 w-3.5" />
                                  </span>
                                  <span className="text-xs font-semibold text-foreground">音色</span>
                                </div>
                                <p className="text-xs leading-5 text-muted-foreground">
                                  尚未分配音色。<span className="text-primary/80 group-hover:text-primary">点击选择资产库音频</span>，用于试听与成片配音。
                                </p>
                              </button>
                            );
                          }
                          return (
                            <section className="flex h-full min-w-0 flex-col gap-2 rounded-lg border border-border bg-muted/90 p-3">
                              <button
                                type="button"
                                onClick={() => setVoiceAssignOpen(true)}
                                className="space-y-2 rounded-md p-2 text-left transition-colors hover:bg-primary/10"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                      <Volume2 className="h-3.5 w-3.5" />
                                    </span>
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-foreground">音色</div>
                                      <div className="truncate text-[11px] text-muted-foreground">点击更换资产库音频</div>
                                    </div>
                                  </div>
                                  <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] text-primary">
                                    更换音色
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 overflow-hidden text-xs">
                                  <div className="truncate" title={roleVoiceProfile.type === "preset" ? "预设音色" : "克隆音色"}><span className="text-muted-foreground">类型：</span>{roleVoiceProfile.type === "preset" ? "预设音色" : "克隆音色"}</div>
                                  <div className="truncate" title={roleVoiceProfile.defaultEngine}><span className="text-muted-foreground">引擎：</span>{roleVoiceProfile.defaultEngine}</div>
                                  {roleVoiceProfile.presetVoiceId && <div className="truncate" title={roleVoiceProfile.presetVoiceId}><span className="text-muted-foreground">预设：</span>{roleVoiceProfile.presetVoiceId}</div>}
                                  {roleVoiceProfile.referenceAudioPath && <div className="col-span-2 truncate" title={displayAudioPath(roleVoiceProfile.referenceAudioPath)}><span className="text-muted-foreground">参考音频：</span>{displayAudioPath(roleVoiceProfile.referenceAudioPath)}</div>}
                                  <div className="truncate" title={roleVoiceProfile.id}><span className="text-muted-foreground">Profile：</span>{roleVoiceProfile.id}</div>
                                </div>
                              </button>
                              <RoleVoicePreviewButton
                                profileId={roleVoiceProfile.id}
                                characterName={parsedDraftName.primaryName}
                                defaultEngine={roleVoiceBinding.defaultEngine}
                                defaultModelSize={roleVoiceBinding.defaultModelSize}
                              />
                            </section>
                          );
                        })()}
                      </div>
                    )}
                    {/* 10-27 用户令「技能之类的确实不应该展示」:技能卡整块撤
                     (数据仍在 DB skills 列,仅弹窗不渲染) */}
                    {/* 出图提示词(1120 用户令:设定收进按钮+MD 弹窗后,提示词紧随
                     音色;10-25 分层面板役 A-2:①主体句+②「提示词构成」折叠组
                     +③实发终稿桩,三轨 role/scene/tool 通用) */}
                    {asset.type !== "audio" ? (
                      <section className="studio-asset-prompt-region col-span-2 min-w-0 space-y-1.5" aria-label="提示词">
                        {/* R1/R3(10-26 用户令):「查看源提示词/查看实发终稿」收敛到首行紧凑
                            动作组;R2 复制钮砍除(文本框全选即复制);R4 idle 态提示行砍除
                            (非 idle 旁注仍随 probe 态展示) */}
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <div className="text-xs font-medium text-muted-foreground">提示词</div>
                          <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                            {/* ② 源提示词 JSON 弹窗(10-26 用户令:砍旧构成四层卡,一钮直出) */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 text-[11px]"
                              onClick={() => setSourcePromptOpen(true)}
                              title="弹窗展示该型在 qi21_bases.json 中的原始提示词数据(JSON 格式)"
                            >
                              <FileText className="h-3 w-3" />
                              查看源提示词
                            </Button>
                            {/* 提示词真源 JSON(10-26 用户令;10-27 接线放宽):repo 手工
                                真源(art_skills/<包>/json/<角色名>.json,如 晏燎.json)或
                                项目库 store 位(store/assets/files/prompts/<名>.json)任一
                                命中即出钮;弹窗=完整展示+CodeMirror 可编辑,存 store 位。
                                scene/tool 同轨复用 */}
                            {characterJsonInfo || storePromptHit ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 gap-1 text-[11px]"
                                onClick={() => setCharacterJsonOpen(true)}
                                title={`查看/编辑该${TYPE_LABEL[asset.type]}的提示词真源 JSON(${characterJsonInfo?.relativePath ?? "store/assets/files/prompts"})`}
                              >
                                <FileJson className="h-3 w-3" />
                                提示词真源JSON
                              </Button>
                            ) : null}
                            {/* ③ 查看实发终稿(A-2③):探针 ready 才可点(focusKind 组末位
                                回溯读 tEXt);无聚焦/无产物/全无 tEXt 置灰注明(§4.4);
                                弹层=正向终稿+注入层全文(共用查词壳) */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 text-[11px]"
                              disabled={finalDraftProbe.status !== "ready"}
                              onClick={handleOpenFinalDraft}
                              title={
                                finalDraftProbe.status === "ready"
                                  ? "查看该型最近产物的引擎实收终稿"
                                  : finalDraftProbe.status === "idle"
                                    ? "聚焦某型后可查看该型最近产物的实发终稿"
                                    : FINAL_DRAFT_NOTE_BY_STATUS[finalDraftProbe.status]
                              }
                            >
                              {finalDraftProbe.status === "probing" ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <FileText className="h-3 w-3" />
                              )}
                              查看实发终稿
                            </Button>
                            {FINAL_DRAFT_NOTE_BY_STATUS[finalDraftProbe.status] ? (
                              <span
                                className="studio-asset-final-draft-note min-w-0 truncate text-[10px] text-muted-foreground/80"
                                title={FINAL_DRAFT_NOTE_BY_STATUS[finalDraftProbe.status]}
                              >
                                {FINAL_DRAFT_NOTE_BY_STATUS[finalDraftProbe.status]}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {/* 1120 用户令·图像规范清单:一表答「该有哪些类型/各几张/
                            现有几张」;加粗=核心必备,红数字=核心缺失,灰=扩展可选。
                            1120 独立页顺手修(§5.4):列沟 gap-x-6 加宽,计数与下一列
                            名拉开(vision 实测显挤,速读易错配) */}
                        {imageRuleRows.length > 0 && (
                          <div className="grid grid-cols-3 gap-x-6 gap-y-1 rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-[11px]" aria-label="图像规范清单">
                            {imageRuleRows.map((row) => (
                              <div key={row.kind} className="flex min-w-0 items-baseline gap-1.5">
                                <span
                                  className={`min-w-0 truncate ${row.core ? "font-medium text-foreground" : "text-muted-foreground"}`}
                                  title={`${row.kind}(${row.aspect}${row.core ? ",核心必备" : ",扩展可选"})`}
                                >
                                  {row.kind}
                                </span>
                                <span className="shrink-0 text-[10px] text-muted-foreground/70">{row.aspect}</span>
                                <span className={`ml-auto shrink-0 tabular-nums ${row.core && row.count === 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                                  {row.count}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* ① 主体句(主位可编辑;Phase C:聚焦型可开「本型专用」槽)。
                            头部行旁=T3「阶段」选择器(10-25 阶段矩阵,PRD §3.3):选项=
                            已聚类阶段集+「无」(默认);守卫同子区(<2 阶段不渲染);
                            选中后按型出图命名带阶段段+i2i 参考图锚该阶段最新图。
                            10-26 真源接线:有真源目录的角色,本区=「人物提示词」结构化
                            面板(JSON 数据化呈现+文生图/图生图标注,随阶段联动),
                            主体句文本框退场(派发仍吃真源派生句)。
                            10-26 控件精简令:真源角色区头整行不渲染(标签/「阶段」
                            选择器/专用句钮全退场,卡片直接排;面板恒显 activeStage
                            =聚类最高境界,阶段职能退由派发默认承担) */}
                        {/* 10-27 用户令「这些控件不需要展示」:区头行整行不渲染(主体句标签/阶段
                            选择器/本型专用句钮,真源与非真源一律零区头;槽机制转地下,派发照吃槽值) */}
                        {unifiedPromptCatalog ? (
                          /* 10-26 用户令「展示基础相关的提示词,而不是阶段相关的」+
                             「不要重复」:面板只显基础两卡(人脸基准/主体句+无衣物定妆
                             (素体基底)),阶段指令不展示(仍住真源JSON,「角色真源JSON」
                             弹窗可查)。1121 布局统一:真源∨store∨DB 回退全员同构双卡;
                             主体句卡来自 DB 时卡头带「编辑」(展开原 Textarea,编辑口不丢) */
                          <>
                            <StudioAssetCharacterPrompts
                              catalog={unifiedPromptCatalog}
                              onEditFace={subjectCardEditable ? () => { setSubjectExpanded(true); setSubjectEditorOpen(true); } : undefined}
                            />
                            {subjectEditorOpen && subjectCardEditable && (
                              <>
                                {focusIsI2iFamily && focusKind && (
                                  <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] leading-4 text-muted-foreground">
                                    <span className="min-w-0 truncate" title={subjectDowngradeNote(focusKind)}>
                                      {subjectDowngradeNote(focusKind)}
                                    </span>
                                    <button
                                      type="button"
                                      className="shrink-0 rounded-md transition-colors hover:text-foreground"
                                      onClick={() => setSubjectExpanded(false)}
                                    >
                                      收起
                                    </button>
                                  </div>
                                )}
                                <Textarea
                                  value={subjectValue}
                                  onChange={(event) => handleSubjectChange(event.target.value)}
                                  placeholder={kindSlotActive && focusKind ? `本型专用句(仅${focusKind}生成路生效;保存入库)` : "暂无出图提示词"}
                                  className={`min-h-[96px] resize-none bg-muted/90 text-xs leading-5 ${focusIsI2iFamily ? "opacity-70" : ""}`}
                                />
                              </>
                            )}
                          </>
                        ) : focusIsI2iFamily && focusKind && !subjectExpanded ? (
                          <button
                            type="button"
                            className="w-full rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-left text-[11px] leading-4 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                            onClick={() => setSubjectExpanded(true)}
                            title="点开仍可编辑"
                          >
                            {subjectDowngradeNote(focusKind)}(点开仍可编辑)
                          </button>
                        ) : (
                          <>
                            {focusIsI2iFamily && focusKind && (
                              <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] leading-4 text-muted-foreground">
                                <span className="min-w-0 truncate" title={subjectDowngradeNote(focusKind)}>
                                  {subjectDowngradeNote(focusKind)}
                                </span>
                                <button
                                  type="button"
                                  className="shrink-0 rounded-md transition-colors hover:text-foreground"
                                  onClick={() => setSubjectExpanded(false)}
                                >
                                  收起
                                </button>
                              </div>
                            )}
                            {subjectMirrorActive ? (
                              <div
                                className="text-[10px] leading-3 text-muted-foreground/80"
                                title={`主体句随「阶段」选择取自角色真源 JSON(${characterJsonInfo?.relativePath ?? ""});要改内容请点「角色真源JSON」编辑保存`}
                              >
                                主体句随阶段取自真源JSON(只读镜像,编辑走「角色真源JSON」)
                              </div>
                            ) : null}
                            <Textarea
                              value={subjectValue}
                              onChange={(event) => handleSubjectChange(event.target.value)}
                              placeholder={kindSlotActive && focusKind ? `本型专用句(仅${focusKind}生成路生效;保存入库)` : "暂无出图提示词"}
                              className={`min-h-[96px] resize-none bg-muted/90 text-xs leading-5 ${focusIsI2iFamily ? "opacity-70" : ""}`}
                              readOnly={subjectMirrorActive}
                            />
                          </>
                        )}
                      </section>
                    ) : null}
                    {/* 底部保存/删除行已撤(1120 详情独立页:保存/删除上移页头常驻,
                        一处真源——折叠任意区也不用再留按钮副本;留痕见 git 历史) */}
                  </div>
                )}
              </section>
    </>
  );
}
