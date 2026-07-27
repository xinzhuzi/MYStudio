declare const xiaohongshuService: {
  loginOrView: (mode: "login" | "view", cookies?: unknown) => Promise<{ success: boolean; data?: { cookie: Electron.Cookie[]; userInfo: unknown }; error?: string }>;
  getUserInfo: (cookies: Electron.Cookie[]) => Promise<unknown>;
  publishImageWorkApi: (cookies: string, imagePaths: string[], settings: Record<string, unknown>) => Promise<unknown>;
  publishVideoWorkApi: (cookies: string, videoPath: string, settings: Record<string, unknown>, callback: (progress: number, message?: string) => void) => Promise<unknown>;
};
export { xiaohongshuService };
