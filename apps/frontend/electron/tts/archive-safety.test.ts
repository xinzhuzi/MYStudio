import { describe, expect, it } from "vitest";
import { assertSafeTarMembers, isSafeTarMember } from "./archive-safety";

describe("isSafeTarMember", () => {
  it.each([
    ["python/bin/python3"],
    ["./python/share/doc/README"],
    ["python/"],
  ])("accepts %s", (member) => {
    expect(isSafeTarMember(member)).toBe(true);
  });

  it.each([
    ["../escape.sh"],
    ["python/../../escape.sh"],
    ["python/lib/../lib/os.py"],
    ["/etc/cron.d/evil"],
    ["C:\\Windows\\evil.cmd"],
    ["python\\evil.sh"],
    [""],
  ])("rejects %s", (member) => {
    expect(isSafeTarMember(member)).toBe(false);
  });
});

describe("assertSafeTarMembers", () => {
  it("passes for a clean listing", () => {
    expect(() => assertSafeTarMembers(["python/bin/python3", "python/lib/os.py"])).not.toThrow();
  });

  it("throws and reports the first unsafe members", () => {
    expect(() => assertSafeTarMembers(["python/bin/python3", "../escape.sh", "/etc/evil"])).toThrow(
      /不安全成员.*\.\.\/escape\.sh/,
    );
  });
});
