import { execFile } from "node:child_process";

export default {
  ffprobe(filePath: string, callback: (error: Error | null, metadata?: unknown) => void) {
    execFile("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", filePath], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        callback(error);
        return;
      }
      try {
        callback(null, JSON.parse(stdout));
      } catch (parseError) {
        callback(parseError instanceof Error ? parseError : new Error(String(parseError)));
      }
    });
  },
};
