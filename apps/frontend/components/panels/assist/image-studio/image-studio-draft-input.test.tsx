// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { useCanvasDraftValue } from "./image-studio-draft-input";

function Harness({ committed, commit }: { committed: string; commit: (v: string) => void }) {
  const input = useCanvasDraftValue({ committed, commit });
  return (
    <input
      data-testid="ta"
      value={input.value}
      onChange={(e) => input.onChange(e.target.value)}
      onBlur={input.onBlur}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useCanvasDraftValue 草稿态(09-02 光标跳末尾终局)", () => {
  it("编辑期间不提交 store(防抖前),显示值跟随草稿", () => {
    const commit = vi.fn();
    render(<Harness committed="旧值" commit={commit} />);
    const ta = screen.getByTestId("ta") as HTMLInputElement;
    fireEvent.change(ta, { target: { value: "新" } });
    expect(ta.value).toBe("新");
    expect(commit).not.toHaveBeenCalled();
  });

  it("防抖到期提交一次;失焦立即提交并回到跟随态", () => {
    vi.useFakeTimers();
    try {
      const commit = vi.fn();
      function FeedbackHarness() {
        const [committed, setCommitted] = useState("");
        const input = useCanvasDraftValue({
          committed,
          commit: (v) => {
            commit(v);
            setCommitted(v);
          },
        });
        return (
          <input
            data-testid="ta"
            value={input.value}
            onChange={(e) => input.onChange(e.target.value)}
            onBlur={input.onBlur}
          />
        );
      }
      render(<FeedbackHarness />);
      const ta = screen.getByTestId("ta") as HTMLInputElement;
      fireEvent.change(ta, { target: { value: "国风" } });
      fireEvent.change(ta, { target: { value: "国风美女" } });
      // 两次输入合并为一次防抖提交
      act(() => vi.advanceTimersByTime(500));
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith("国风美女");
      // 失焦路径:新草稿立即提交,跟随态显示回灌的提交值
      fireEvent.change(ta, { target: { value: "国风美女图" } });
      fireEvent.blur(ta);
      expect(commit).toHaveBeenLastCalledWith("国风美女图");
      expect(ta.value).toBe("国风美女图");
    } finally {
      vi.useRealTimers();
    }
  });

  it("外部提交值更新不打断草稿(编辑优先);提交值在无草稿时生效", () => {
    function ResyncHarness() {
      const [committed, setCommitted] = useState("a");
      const input = useCanvasDraftValue({ committed, commit: setCommitted });
      return (
        <div>
          <input data-testid="ta" value={input.value} onChange={(e) => input.onChange(e.target.value)} onBlur={input.onBlur} />
          <button data-testid="sync" onClick={() => setCommitted("外部新值")}>sync</button>
        </div>
      );
    }
    render(<ResyncHarness />);
    const ta = screen.getByTestId("ta") as HTMLInputElement;
    fireEvent.change(ta, { target: { value: "草稿中" } });
    fireEvent.click(screen.getByTestId("sync"));
    // 草稿未失焦,外部值不覆盖正在编辑的内容
    expect(ta.value).toBe("草稿中");
    fireEvent.blur(ta);
    expect(ta.value).toBe("草稿中");
  });
});
