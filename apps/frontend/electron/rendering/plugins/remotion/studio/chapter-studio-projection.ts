import { createHash } from "node:crypto";
import ts from "typescript";

export const CHAPTER_STUDIO_PROJECTION_SCHEMA_VERSION = 1 as const;

export interface ChapterStudioProjectionCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChapterStudioProjectionTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}

export type ChapterStudioProjectionTransition =
  | { type: "cut"; durationInFrames: 0 }
  | { type: "fade"; durationInFrames: number };

export interface ChapterStudioProjectionClip {
  shotId: string;
  src: string;
  durationInFrames: number;
  trimBeforeFrames: number;
  crop: ChapterStudioProjectionCrop;
  transform: ChapterStudioProjectionTransform;
  volume: number;
  subtitle: string;
  transitionAfter?: ChapterStudioProjectionTransition;
}

export interface ChapterStudioProjectionInput {
  schemaVersion: typeof CHAPTER_STUDIO_PROJECTION_SCHEMA_VERSION;
  projectId: string;
  chapterId: string;
  editingProjectId: string;
  editingRevision: number;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  clips: ChapterStudioProjectionClip[];
}

export type ChapterStudioProjectionParseResult =
  | { success: true; value: ChapterStudioProjectionInput }
  | { success: false; issues: Array<{ path: string; message: string }> };

interface ProjectionIdentity {
  schemaVersion: 1;
  projectId: string;
  chapterId: string;
  editingProjectId: string;
  editingRevision: number;
  clips: Array<{ shotId: string; src: string }>;
}

export type ChapterStudioProjectionIdentityExpectation = Omit<ProjectionIdentity, "schemaVersion">;

const IDENTITY_MARKER = "@mystudio-chapter-projection ";
const CAPABILITY_URL = /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/[A-Za-z0-9._~-]+$/;
const ALLOWED_IMPORTS = new Set(["remotion"]);
const ALLOWED_JSX = new Set([
  "AbsoluteFill",
  "Composition",
  "Interactive.Div",
  "Sequence",
  "Video",
]);
const ALLOWED_CALLS = new Set(["interpolate", "registerRoot", "useCurrentFrame"]);
const ALLOWED_VARIABLES = new Set(["ChapterStudioProjection", "RemotionRoot"]);
const ALLOWED_IMPORT_BINDINGS = new Map([
  ["remotion", new Set(["AbsoluteFill", "Composition", "Interactive", "interpolate", "registerRoot", "Sequence", "useCurrentFrame", "Video"])],
]);
const ALLOWED_JSX_ATTRIBUTES = new Map([
  ["AbsoluteFill", new Set(["style"])],
  ["Composition", new Set(["id", "component", "durationInFrames", "fps", "width", "height", "defaultProps"])],
  ["Interactive.Div", new Set(["name", "style"])],
  ["Sequence", new Set(["name", "from", "durationInFrames", "layout"])],
  ["Video", new Set(["name", "src", "trimBefore", "volume"])],
]);
const ALLOWED_STYLE_PROPERTIES = new Set([
  "backgroundColor", "bottom", "color", "fontSize", "height", "left", "opacity", "overflow",
  "position", "right", "rotate", "scale", "textAlign", "top", "translate", "width",
]);

export function generateChapterStudioProjection(input: ChapterStudioProjectionInput): {
  source: string;
  sourceHash: string;
} {
  assertProjectionInput(input);
  const identity: ProjectionIdentity = {
    schemaVersion: 1,
    projectId: input.projectId,
    chapterId: input.chapterId,
    editingProjectId: input.editingProjectId,
    editingRevision: input.editingRevision,
    clips: input.clips.map(({ shotId, src }) => ({ shotId, src })),
  };
  const authoredNodes: string[] = [];
  let from = 0;
  input.clips.forEach((clip, index) => {
    if (index === input.clips.length - 1 && clip.transitionAfter) {
      throw new Error(`clips[${index}].transitionAfter: 最后一镜不能定义转场`);
    }
    const previousTransition = index > 0 ? input.clips[index - 1]?.transitionAfter : undefined;
    const fadeInFrames = previousTransition?.type === "fade"
      ? previousTransition.durationInFrames
      : 0;
    const fadeOutFrames = clip.transitionAfter?.type === "fade"
      ? clip.transitionAfter.durationInFrames
      : 0;
    authoredNodes.push(renderSequence(clip, from, fadeInFrames, fadeOutFrames));
    from += clip.durationInFrames - fadeOutFrames;
  });
  const source = `/* ${IDENTITY_MARKER}${encodeIdentity(identity)} */
import { AbsoluteFill, Composition, Interactive, interpolate, registerRoot, Sequence, useCurrentFrame, Video } from "remotion";

export const ChapterStudioProjection = () => (
  <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
    <Sequence name="Chapter timeline" from={0} durationInFrames={${input.durationInFrames}} layout="none">
${authoredNodes.join("\n")}
    </Sequence>
  </AbsoluteFill>
);

export const RemotionRoot = () => (
  <Composition
    id="ChapterVideo"
    component={ChapterStudioProjection}
    durationInFrames={${input.durationInFrames}}
    fps={${input.fps}}
    width={${input.width}}
    height={${input.height}}
    defaultProps={{}}
  />
);

registerRoot(RemotionRoot);
`;
  return { source, sourceHash: sha256(source) };
}

export function parseChapterStudioProjection(
  source: string,
  expectedIdentity?: ChapterStudioProjectionIdentityExpectation,
): ChapterStudioProjectionParseResult {
  const issues: Array<{ path: string; message: string }> = [];
  const identity = decodeIdentity(source, issues);
  if (identity && expectedIdentity && !identityMatches(identity, expectedIdentity)) {
    issues.push({ path: "identity", message: "projection identity 与当前 Studio session 不一致" });
  }
  const sourceFile = ts.createSourceFile(
    "chapter-projection.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const parseDiagnostics = (sourceFile as ts.SourceFile & {
    parseDiagnostics: readonly ts.Diagnostic[];
  }).parseDiagnostics;
  if (parseDiagnostics.length > 0) {
    issues.push({ path: "$", message: "Studio projection TSX 语法无效" });
  }
  validateSourceWhitelist(sourceFile, issues);
  const composition = findJsxElement(sourceFile, "Composition");
  const timeline = findNamedJsxElement(sourceFile, "Sequence", "Chapter timeline");
  if (!composition) issues.push({ path: "Composition", message: "缺少 ChapterVideo Composition" });
  if (!timeline || !ts.isJsxElement(timeline)) {
    issues.push({ path: "Sequence", message: "缺少 Chapter timeline" });
  }
  if (!identity || !composition || !timeline || !ts.isJsxElement(timeline) || issues.length > 0) {
    return { success: false, issues };
  }

  const compositionOpening = jsxOpening(composition);
  const width = numberAttribute(compositionOpening, "width", issues);
  const height = numberAttribute(compositionOpening, "height", issues);
  const fps = numberAttribute(compositionOpening, "fps", issues);
  const durationInFrames = numberAttribute(compositionOpening, "durationInFrames", issues);
  const timelineDurationInFrames = numberAttribute(jsxOpening(timeline), "durationInFrames", issues);
  const clips: ChapterStudioProjectionClip[] = [];
  const sequenceFroms: number[] = [];

  for (const child of timeline.children) {
    if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) continue;
    const opening = jsxOpening(child);
    const tag = opening.tagName.getText(sourceFile);
    if (tag === "Sequence" && ts.isJsxElement(child)) {
      const clip = parseSequence(child, identity, clips.length, sourceFile, issues);
      if (clip) {
        clips.push(clip);
        sequenceFroms.push(numberAttribute(opening, "from", issues) ?? 0);
      }
    } else {
      issues.push({ path: "Sequence", message: "Chapter timeline 只允许显式 Sequence 镜头节点" });
    }
  }

  if (clips.length !== identity.clips.length) {
    issues.push({ path: "clips", message: "镜头结构与 projection identity 不一致" });
  }
  if (sequenceFroms[0] !== 0) {
    issues.push({ path: "clips[0].from", message: "第一镜必须从第 0 帧开始" });
  }
  clips.forEach((clip, index) => {
    if (index === clips.length - 1) return;
    const currentEnd = sequenceFroms[index] + clip.durationInFrames;
    const nextFrom = sequenceFroms[index + 1];
    const overlap = currentEnd - nextFrom;
    if (overlap < 0) {
      issues.push({ path: `clips[${index}].from`, message: "镜头之间不允许出现时间空洞" });
    } else if (overlap === 0) {
      clip.transitionAfter = { type: "cut", durationInFrames: 0 };
    } else {
      clip.transitionAfter = { type: "fade", durationInFrames: overlap };
      if (overlap >= clip.durationInFrames || overlap >= clips[index + 1].durationInFrames) {
        issues.push({ path: `clips[${index}].transitionAfter`, message: "fade 重叠不得覆盖整镜" });
      }
    }
  });

  const computedDuration = calculateProjectionDuration(clips);
  if (timelineDurationInFrames !== durationInFrames) {
    issues.push({ path: "Sequence.durationInFrames", message: "Chapter timeline 时长与 Composition 不一致" });
  }
  if (durationInFrames !== computedDuration) {
    issues.push({ path: "durationInFrames", message: "Composition 时长与 authored sequences 不一致" });
  }
  const value: ChapterStudioProjectionInput = {
    schemaVersion: 1,
    projectId: identity.projectId,
    chapterId: identity.chapterId,
    editingProjectId: identity.editingProjectId,
    editingRevision: identity.editingRevision,
    width: width!,
    height: height!,
    fps: fps!,
    durationInFrames: durationInFrames!,
    clips,
  };
  try {
    assertProjectionInput(value);
  } catch (error) {
    issues.push({
      path: "$",
      message: error instanceof Error ? error.message : "Studio projection 值无效",
    });
  }
  if (issues.length > 0) return { success: false, issues };
  return { success: true, value };
}

function renderSequence(
  clip: ChapterStudioProjectionClip,
  from: number,
  fadeInFrames: number,
  fadeOutFrames: number,
): string {
  const crop = clip.crop;
  const transform = clip.transform;
  const content = `        <Interactive.Div
          name=${quoted(`crop:${clip.shotId}`)}
          style={{ position: "absolute", left: ${crop.x}, top: ${crop.y}, width: ${crop.width}, height: ${crop.height}, overflow: "hidden" }}
        >
          <Interactive.Div
            name=${quoted(`transform:${clip.shotId}`)}
            style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", translate: ${quoted(`${transform.x}px ${transform.y}px`)}, scale: ${quoted(`${transform.scaleX} ${transform.scaleY}`)}, rotate: ${quoted(`${transform.rotation}deg`)}, opacity: ${transform.opacity} }}
          >
            <Video name=${quoted(`media:${clip.shotId}`)} src=${quoted(clip.src)} trimBefore={${clip.trimBeforeFrames}} volume={${clip.volume}} />
          </Interactive.Div>
        </Interactive.Div>
        <Interactive.Div name=${quoted(`subtitle:${clip.shotId}`)} style={{ position: "absolute", left: 48, right: 48, bottom: 96, textAlign: "center", color: "#fff", fontSize: 48 }}>
          {${JSON.stringify(clip.subtitle)}}
        </Interactive.Div>`;
  const wrapped = wrapFadeOpacity(content, clip.durationInFrames, fadeInFrames, fadeOutFrames);
  return `      <Sequence name=${quoted(`shot:${clip.shotId}`)} from={${from}} durationInFrames={${clip.durationInFrames}} layout="none">
${wrapped}
      </Sequence>`;
}

function wrapFadeOpacity(
  content: string,
  durationInFrames: number,
  fadeInFrames: number,
  fadeOutFrames: number,
): string {
  let wrapped = content;
  if (fadeOutFrames > 0) {
    wrapped = `        <AbsoluteFill style={{ opacity: interpolate(useCurrentFrame(), [${durationInFrames - fadeOutFrames}, ${durationInFrames}], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
${wrapped}
        </AbsoluteFill>`;
  }
  if (fadeInFrames > 0) {
    wrapped = `        <AbsoluteFill style={{ opacity: interpolate(useCurrentFrame(), [0, ${fadeInFrames}], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
${wrapped}
        </AbsoluteFill>`;
  }
  return wrapped;
}

function parseSequence(
  sequence: ts.JsxElement,
  identity: ProjectionIdentity,
  index: number,
  sourceFile: ts.SourceFile,
  issues: Array<{ path: string; message: string }>,
): ChapterStudioProjectionClip | null {
  const expected = identity.clips[index];
  const path = `clips[${index}]`;
  const shotName = stringAttribute(sequence.openingElement, "name", issues);
  const shotId = shotName?.startsWith("shot:") ? shotName.slice(5) : "";
  if (!expected || shotId !== expected.shotId) {
    issues.push({ path: `${path}.shotId`, message: "shot ID 或顺序与 projection identity 不一致" });
  }
  const mediaElements = findJsxElementsByTag(sequence, "Video");
  const divElements = findJsxElementsByTag(sequence, "Interactive.Div");
  const nestedSequences = findJsxElementsByTag(sequence, "Sequence");
  const media = mediaElements.length === 1 ? mediaElements[0] : null;
  const crop = divElements.find((element) => rawStringAttribute(jsxOpening(element), "name") === `crop:${shotId}`) ?? null;
  const transform = divElements.find((element) => rawStringAttribute(jsxOpening(element), "name") === `transform:${shotId}`) ?? null;
  const subtitle = divElements.find((element) => rawStringAttribute(jsxOpening(element), "name") === `subtitle:${shotId}`) ?? null;
  if (mediaElements.length !== 1 || divElements.length !== 3 || nestedSequences.length !== 0) {
    issues.push({ path, message: "镜头 authored JSX 节点数量或嵌套结构无效" });
  }
  if (!media || !crop || !transform || !subtitle) {
    issues.push({ path, message: "镜头 authored JSX 结构不完整" });
    return null;
  }
  const mediaOpening = jsxOpening(media);
  const cropOpening = jsxOpening(crop);
  const transformOpening = jsxOpening(transform);
  const src = stringAttribute(mediaOpening, "src", issues) ?? "";
  if (!expected || src !== expected.src) {
    issues.push({ path: `${path}.src`, message: "媒体引用与 projection identity 不一致" });
  }
  const cropStyle = objectAttribute(cropOpening, "style", sourceFile, issues);
  const transformStyle = objectAttribute(transformOpening, "style", sourceFile, issues);
  return {
    shotId,
    src,
    durationInFrames: numberAttribute(sequence.openingElement, "durationInFrames", issues) ?? 0,
    trimBeforeFrames: numberAttribute(mediaOpening, "trimBefore", issues) ?? 0,
    crop: {
      x: numberProperty(cropStyle, "left", sourceFile, issues),
      y: numberProperty(cropStyle, "top", sourceFile, issues),
      width: numberProperty(cropStyle, "width", sourceFile, issues),
      height: numberProperty(cropStyle, "height", sourceFile, issues),
    },
    transform: parseTransform(transformStyle, sourceFile, issues),
    volume: numberAttribute(mediaOpening, "volume", issues) ?? 0,
    subtitle: jsxTextValue(subtitle, issues),
  };
}

function parseTransform(
  style: ts.ObjectLiteralExpression | null,
  sourceFile: ts.SourceFile,
  issues: Array<{ path: string; message: string }>,
): ChapterStudioProjectionTransform {
  const translate = stringProperty(style, "translate", sourceFile, issues).match(/^(-?\d+(?:\.\d+)?)px (-?\d+(?:\.\d+)?)px$/);
  const scale = stringProperty(style, "scale", sourceFile, issues).match(/^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)$/);
  const rotate = stringProperty(style, "rotate", sourceFile, issues).match(/^(-?\d+(?:\.\d+)?)deg$/);
  if (!translate) issues.push({ path: "transform.translate", message: "translate 必须是内联像素值" });
  if (!scale) issues.push({ path: "transform.scale", message: "scale 必须是内联双轴值" });
  if (!rotate) issues.push({ path: "transform.rotate", message: "rotate 必须是内联角度值" });
  return {
    x: Number(translate?.[1] ?? 0),
    y: Number(translate?.[2] ?? 0),
    scaleX: Number(scale?.[1] ?? 0),
    scaleY: Number(scale?.[2] ?? 0),
    rotation: Number(rotate?.[1] ?? 0),
    opacity: numberProperty(style, "opacity", sourceFile, issues),
  };
}

function validateSourceWhitelist(
  sourceFile: ts.SourceFile,
  issues: Array<{ path: string; message: string }>,
): void {
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : "";
      if (!ALLOWED_IMPORTS.has(specifier)) {
        issues.push({ path: "imports", message: `未知 import: ${specifier}` });
      } else {
        validateImportBindings(statement, specifier, issues);
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      if (statement.declarationList.declarations.length !== 1
        || !ts.isIdentifier(statement.declarationList.declarations[0].name)
        || !ALLOWED_VARIABLES.has(statement.declarationList.declarations[0].name.text)) {
        issues.push({ path: "$", message: "未知顶层变量" });
      }
      continue;
    }
    if (!ts.isExpressionStatement(statement)
      || !isRootRegistrationStatement(statement, sourceFile)) {
      issues.push({ path: "$", message: "未知顶层 TSX 结构" });
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = ts.isJsxElement(node)
        ? node.openingElement.tagName.getText(sourceFile)
        : node.tagName.getText(sourceFile);
      if (!ALLOWED_JSX.has(tag)) issues.push({ path: "JSX", message: `未知 JSX 节点: ${tag}` });
      else validateJsxAttributes(jsxOpening(node), tag, sourceFile, issues);
    }
    if (ts.isCallExpression(node)) {
      const callName = node.expression.getText(sourceFile);
      if (!ALLOWED_CALLS.has(callName)) issues.push({ path: "call", message: `未知调用: ${callName}` });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function isRootRegistrationStatement(
  statement: ts.ExpressionStatement,
  sourceFile: ts.SourceFile,
): boolean {
  const expression = statement.expression;
  return ts.isCallExpression(expression)
    && expression.expression.getText(sourceFile) === "registerRoot"
    && expression.arguments.length === 1
    && ts.isIdentifier(expression.arguments[0])
    && expression.arguments[0].text === "RemotionRoot";
}

function validateImportBindings(
  statement: ts.ImportDeclaration,
  specifier: string,
  issues: Array<{ path: string; message: string }>,
): void {
  const clause = statement.importClause;
  const bindings = clause?.namedBindings;
  if (!clause || clause.name || !bindings || !ts.isNamedImports(bindings)) {
    issues.push({ path: `imports.${specifier}`, message: "只允许显式 named import" });
    return;
  }
  const allowed = ALLOWED_IMPORT_BINDINGS.get(specifier) ?? new Set<string>();
  for (const element of bindings.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    if (element.propertyName || !allowed.has(imported)) {
      issues.push({ path: `imports.${specifier}`, message: `未知 import binding: ${imported}` });
    }
  }
}

function validateJsxAttributes(
  opening: ts.JsxOpeningLikeElement,
  tag: string,
  sourceFile: ts.SourceFile,
  issues: Array<{ path: string; message: string }>,
): void {
  const allowed = ALLOWED_JSX_ATTRIBUTES.get(tag) ?? new Set<string>();
  for (const property of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      issues.push({ path: `JSX.${tag}`, message: "不允许 JSX spread attribute" });
      continue;
    }
    const name = ts.isIdentifier(property.name) ? property.name.text : property.name.getText(sourceFile);
    if (!allowed.has(name)) {
      issues.push({ path: `JSX.${tag}`, message: `未知 JSX 属性: ${name}` });
      continue;
    }
    if (name !== "style") continue;
    const expression = property.initializer && ts.isJsxExpression(property.initializer)
      ? property.initializer.expression
      : null;
    if (!expression || !ts.isObjectLiteralExpression(expression)) continue;
    for (const styleProperty of expression.properties) {
      if (!ts.isPropertyAssignment(styleProperty)) {
        issues.push({ path: `JSX.${tag}.style`, message: "style 不允许展开或计算属性" });
        continue;
      }
      const styleName = styleProperty.name.getText(sourceFile).replace(/[\'\"]/g, "");
      if (!ALLOWED_STYLE_PROPERTIES.has(styleName)) {
        issues.push({ path: `JSX.${tag}.style`, message: `未知 style 属性: ${styleName}` });
      }
    }
  }
}

function assertProjectionInput(input: ChapterStudioProjectionInput): void {
  const issues: string[] = [];
  if (input.schemaVersion !== 1) issues.push("schemaVersion");
  for (const key of ["projectId", "chapterId", "editingProjectId"] as const) {
    if (!input[key]?.trim()) issues.push(key);
  }
  for (const key of ["editingRevision", "width", "height", "fps", "durationInFrames"] as const) {
    if (!Number.isInteger(input[key]) || input[key] <= 0) issues.push(key);
  }
  if (!Array.isArray(input.clips) || input.clips.length === 0) issues.push("clips");
  const shotIds = new Set<string>();
  input.clips.forEach((clip, index) => {
    if (!clip.shotId.trim() || shotIds.has(clip.shotId)) issues.push(`clips[${index}].shotId`);
    shotIds.add(clip.shotId);
    if (!CAPABILITY_URL.test(clip.src)) issues.push(`clips[${index}].src`);
    if (!Number.isInteger(clip.durationInFrames) || clip.durationInFrames <= 0) issues.push(`clips[${index}].durationInFrames`);
    if (!Number.isInteger(clip.trimBeforeFrames) || clip.trimBeforeFrames < 0) issues.push(`clips[${index}].trimBeforeFrames`);
    if (!finiteCrop(clip.crop)) issues.push(`clips[${index}].crop`);
    if (!finiteTransform(clip.transform)) issues.push(`clips[${index}].transform`);
    if (!Number.isFinite(clip.volume) || clip.volume < 0) issues.push(`clips[${index}].volume`);
    const transition = clip.transitionAfter;
    if (index < input.clips.length - 1 && !transition) issues.push(`clips[${index}].transitionAfter`);
    if (transition?.type === "cut" && transition.durationInFrames !== 0) issues.push(`clips[${index}].transitionAfter`);
    if (transition?.type === "fade") {
      if (!Number.isInteger(transition.durationInFrames) || transition.durationInFrames <= 0) {
        issues.push(`clips[${index}].transitionAfter`);
      }
      const nextClip = input.clips[index + 1];
      if (nextClip && (transition.durationInFrames >= clip.durationInFrames
        || transition.durationInFrames >= nextClip.durationInFrames)) {
        issues.push(`clips[${index}].transitionAfter`);
      }
    }
    if (index === input.clips.length - 1 && transition) issues.push(`clips[${index}].transitionAfter`);
  });
  if (input.durationInFrames !== calculateProjectionDuration(input.clips)) issues.push("durationInFrames");
  if (issues.length > 0) throw new Error(`Studio projection 输入无效: ${issues.join(", ")}`);
}

function calculateProjectionDuration(clips: ChapterStudioProjectionClip[]): number {
  return clips.reduce((total, clip) => total + clip.durationInFrames
    - (clip.transitionAfter?.type === "fade" ? clip.transitionAfter.durationInFrames : 0), 0);
}

function finiteCrop(value: ChapterStudioProjectionCrop): boolean {
  return [value.x, value.y, value.width, value.height].every(Number.isFinite)
    && value.width > 0 && value.height > 0;
}

function finiteTransform(value: ChapterStudioProjectionTransform): boolean {
  return [value.x, value.y, value.scaleX, value.scaleY, value.rotation, value.opacity].every(Number.isFinite)
    && value.scaleX > 0 && value.scaleY > 0 && value.opacity >= 0 && value.opacity <= 1;
}

function findJsxElement(root: ts.Node, tagName: string): ts.JsxElement | ts.JsxSelfClosingElement | null {
  let found: ts.JsxElement | ts.JsxSelfClosingElement | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === tagName) found = node;
    else if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === tagName) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function findNamedJsxElement(
  root: ts.Node,
  tagName: string,
  name: string,
): ts.JsxElement | ts.JsxSelfClosingElement | null {
  let found: ts.JsxElement | ts.JsxSelfClosingElement | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = jsxOpening(node);
      if (opening.tagName.getText() === tagName && rawStringAttribute(opening, "name") === name) {
        found = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function findJsxElementsByTag(
  root: ts.Node,
  tagName: string,
): Array<ts.JsxElement | ts.JsxSelfClosingElement> {
  const found: Array<ts.JsxElement | ts.JsxSelfClosingElement> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      if (node.openingElement.tagName.getText() === tagName) found.push(node);
    } else if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === tagName) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return found;
}

function jsxOpening(
  element: ts.JsxElement | ts.JsxSelfClosingElement,
): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(element) ? element.openingElement : element;
}

function rawStringAttribute(opening: ts.JsxOpeningLikeElement, name: string): string | null {
  const attribute = opening.attributes.properties.find(
    (item): item is ts.JsxAttribute => ts.isJsxAttribute(item)
      && ts.isIdentifier(item.name)
      && item.name.text === name,
  );
  return attribute?.initializer && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : null;
}

function stringAttribute(
  opening: ts.JsxOpeningLikeElement,
  name: string,
  issues: Array<{ path: string; message: string }>,
): string | null {
  const value = rawStringAttribute(opening, name);
  if (value === null) issues.push({ path: name, message: `${name} 必须是内联字符串` });
  return value;
}

function numberAttribute(
  opening: ts.JsxOpeningLikeElement,
  name: string,
  issues: Array<{ path: string; message: string }>,
): number | null {
  const expression = expressionAttribute(opening, name);
  const value = numericExpression(expression);
  if (value === null) issues.push({ path: name, message: `${name} 必须是内联数值` });
  return value;
}

function expressionAttribute(opening: ts.JsxOpeningLikeElement, name: string): ts.Expression | null {
  const attribute = opening.attributes.properties.find(
    (item): item is ts.JsxAttribute => ts.isJsxAttribute(item)
      && ts.isIdentifier(item.name)
      && item.name.text === name,
  );
  return attribute?.initializer
    && ts.isJsxExpression(attribute.initializer)
    && attribute.initializer.expression
    ? attribute.initializer.expression
    : null;
}

function objectAttribute(
  opening: ts.JsxOpeningLikeElement,
  name: string,
  sourceFile: ts.SourceFile,
  issues: Array<{ path: string; message: string }>,
): ts.ObjectLiteralExpression | null {
  const expression = expressionAttribute(opening, name);
  if (!expression || !ts.isObjectLiteralExpression(expression)) {
    issues.push({ path: name, message: `${name} 必须是内联对象` });
    return null;
  }
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) {
      issues.push({ path: name, message: `${name} 不允许展开或计算属性` });
    }
  }
  void sourceFile;
  return expression;
}

function numberProperty(
  object: ts.ObjectLiteralExpression | null,
  name: string,
  sourceFile: ts.SourceFile,
  issues: Array<{ path: string; message: string }>,
): number {
  const expression = propertyExpression(object, name, sourceFile);
  const value = numericExpression(expression);
  if (value === null) issues.push({ path: name, message: `${name} 必须是内联数值` });
  return value ?? 0;
}

function stringProperty(
  object: ts.ObjectLiteralExpression | null,
  name: string,
  sourceFile: ts.SourceFile,
  issues: Array<{ path: string; message: string }>,
): string {
  const expression = propertyExpression(object, name, sourceFile);
  if (!expression || !ts.isStringLiteral(expression)) {
    issues.push({ path: name, message: `${name} 必须是内联字符串` });
    return "";
  }
  return expression.text;
}

function propertyExpression(
  object: ts.ObjectLiteralExpression | null,
  name: string,
  sourceFile: ts.SourceFile,
): ts.Expression | null {
  if (!object) return null;
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item)
      && item.name.getText(sourceFile).replace(/"/g, "") === name,
  );
  return property?.initializer ?? null;
}

function numericExpression(expression: ts.Expression | null): number | null {
  if (!expression) return null;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(expression.operand)) {
    return -Number(expression.operand.text);
  }
  return null;
}

function jsxTextValue(
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  issues: Array<{ path: string; message: string }>,
): string {
  if (!ts.isJsxElement(element)) return "";
  const values = element.children.filter(ts.isJsxExpression).map((child) => child.expression);
  if (values.length !== 1 || !values[0] || !ts.isStringLiteral(values[0])) {
    issues.push({ path: "subtitle", message: "subtitle 必须是单个内联字符串" });
    return "";
  }
  return values[0].text;
}

function encodeIdentity(identity: ProjectionIdentity): string {
  return Buffer.from(JSON.stringify(identity), "utf8").toString("base64url");
}

function decodeIdentity(
  source: string,
  issues: Array<{ path: string; message: string }>,
): ProjectionIdentity | null {
  const match = source.match(new RegExp(`/\\* ${IDENTITY_MARKER}([A-Za-z0-9_-]+) \\*/`));
  if (!match) {
    issues.push({ path: "identity", message: "缺少 projection identity" });
    return null;
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    if (!isIdentity(value)) throw new Error();
    return value;
  } catch {
    issues.push({ path: "identity", message: "projection identity 无效" });
    return null;
  }
}

function isIdentity(value: unknown): value is ProjectionIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && [record.projectId, record.chapterId, record.editingProjectId].every(
      (item) => typeof item === "string" && item.length > 0,
    )
    && Number.isInteger(record.editingRevision) && Number(record.editingRevision) > 0
    && Array.isArray(record.clips)
    && record.clips.every((clip) => Boolean(clip)
      && typeof clip === "object"
      && typeof (clip as Record<string, unknown>).shotId === "string"
      && CAPABILITY_URL.test(String((clip as Record<string, unknown>).src)));
}

function identityMatches(
  actual: ProjectionIdentity,
  expected: ChapterStudioProjectionIdentityExpectation,
): boolean {
  return actual.projectId === expected.projectId
    && actual.chapterId === expected.chapterId
    && actual.editingProjectId === expected.editingProjectId
    && actual.editingRevision === expected.editingRevision
    && actual.clips.length === expected.clips.length
    && actual.clips.every((clip, index) => {
      const expectedClip = expected.clips[index];
      return expectedClip?.shotId === clip.shotId && expectedClip.src === clip.src;
    });
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
