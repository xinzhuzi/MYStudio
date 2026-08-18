import path from "node:path";

/**
 * tar 归档成员穿越防御:解压来自网络的归档前,先 `tar -tzf` 列成员并逐条校验,
 * 拒绝绝对路径、`..` 段、反斜杠穿越与 Windows 盘符,防止恶意归档把可执行文件
 * 写到解压目录之外(如 ~/.bashrc、启动项)。
 */
export function isSafeTarMember(member: string): boolean {
  if (!member) return false;
  if (member.includes("\0")) return false;
  if (member.includes("\\")) return false;
  if (path.isAbsolute(member)) return false;
  if (/^[a-zA-Z]:/.test(member)) return false;
  const segments = member.split("/");
  return !segments.includes("..");
}

export function assertSafeTarMembers(members: readonly string[]): void {
  const unsafe = members.filter((member) => !isSafeTarMember(member));
  if (unsafe.length > 0) {
    throw new Error(`归档包含不安全成员，拒绝解压: ${unsafe.slice(0, 5).join(", ")}`);
  }
}
