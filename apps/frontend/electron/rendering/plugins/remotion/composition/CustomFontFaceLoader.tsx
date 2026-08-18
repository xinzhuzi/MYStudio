// 自定义字体面加载器：渲染端把主进程经 media bridge 提供的自定义字体
// （capability URL）挂进 document.fonts。delayRender 保证任何字幕帧栅格化
// 之前字体已就绪——否则首帧会以回退字体烧录。Player 预览与固定渲染
// bundle 共用本组件，两端口径一致。

import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import type { CompositionProps } from "./composition-props";

export function CustomFontFaceLoader(
  props: { fonts: NonNullable<CompositionProps["customFonts"]> },
): React.ReactElement | null {
  const [handle] = useState(() => delayRender("加载自定义字幕字体"));
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      props.fonts.map((face) =>
        new FontFace(face.family, `url(${face.url})`)
          .load()
          .then((loaded) => {
            document.fonts.add(loaded);
          })
          .catch((error) => {
            // 字体面加载失败不阻塞渲染——字幕按注册表回退链降级。
            console.warn(`[subtitle-fonts] 自定义字体面加载失败: ${face.family}`, error);
          }),
      ),
    ).finally(() => {
      if (!cancelled) continueRender(handle);
    });
    return () => {
      cancelled = true;
      continueRender(handle);
    };
  }, [handle, props.fonts]);
  return null;
}
