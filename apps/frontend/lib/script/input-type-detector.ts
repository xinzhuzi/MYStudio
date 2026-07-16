/** Classify creative input without any parser or API side effects. */
export function detectInputType(input: string): string {
  const trimmed = input.trim();
  const lineCount = trimmed.split('\n').filter((line) => line.trim()).length;
  if (/[【\[]\s*镜头\s*\d+/i.test(trimmed) || /\*\*.*镜头.*\*\*/i.test(trimmed)) return '详细分镜脚本';
  if (/MV|[音乐][视音][频像]|music\s*video/i.test(trimmed)) return 'MV概念';
  if (/广告|宣传[片视频]|commercial|ad\s*brief|品牌/i.test(trimmed)) return '广告简报';
  if (/预告[片视频]|trailer|宣传片/i.test(trimmed)) return '预告片脚本';
  if (/短视频|抹音|tiktok|快手|reels/i.test(trimmed)) return '短视频创意';
  if (lineCount <= 3 && trimmed.length < 100) return '一句话创意';
  if (lineCount <= 10) return '故事大纲';
  return '详细故事描述';
}
