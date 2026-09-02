// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 画布节点输入框草稿态(09-02 光标跳末尾/输入法连环问题终局)。
 *
 * 结构性根因:画布输入每键往返「输入框→store→整图重建→React Flow 受控
 * 节点数组→受控值写回」六跳;受控值写回会让浏览器重置光标到末尾、打断
 * 输入法组合(此前 measured 携带/组合期不受控都是这条链上的局部补丁)。
 *
 * 草稿态=聚焦编辑期间本地持有值:受控 value 恒等于本地草稿(==DOM 文本),
 * 任何 store/图重建都不会写回输入框——光标/删除/输入法天然正常;store
 * 提交改为防抖(COMMIT_DEBOUNCE_MS)+失焦立即+卸载兜底。程序化插入
 * (@引用令牌)走 setValue 同管线。
 */
const COMMIT_DEBOUNCE_MS = 400;

export function useCanvasDraftValue(options: {
  committed: string;
  commit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const latestRef = useRef({ draft, commit: options.commit });
  latestRef.current = { draft, commit: options.commit };

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const commitNow = useCallback(
    (value: string) => {
      clearTimer();
      latestRef.current.commit(value);
    },
    [clearTimer],
  );

  const onChange = useCallback(
    (value: string) => {
      setDraft(value);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        latestRef.current.commit(value);
      }, COMMIT_DEBOUNCE_MS);
    },
    [clearTimer],
  );

  /** 程序化改值(@引用插入/外部同步):立即生效并立即提交,防抖窗口作废 */
  const setValue = useCallback(
    (next: string) => {
      setDraft(next);
      commitNow(next);
    },
    [commitNow],
  );

  const onBlur = useCallback(() => {
    setDraft((current) => {
      if (current !== null) commitNow(current);
      return null;
    });
  }, [commitNow]);

  // 卸载兜底:草稿未提交不丢字(节点删除/画布切换)
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (latestRef.current.draft !== null) latestRef.current.commit(latestRef.current.draft);
    },
    [],
  );

  return { value: draft ?? options.committed, onChange, onBlur, setValue };
}
