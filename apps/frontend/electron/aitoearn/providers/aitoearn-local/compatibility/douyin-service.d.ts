declare const douyinService: {
  loginOrView: (mode: "login" | "view", cookies?: unknown) => Promise<{ success: boolean; data?: { cookie: string; userInfo: unknown; localStorage: string }; error?: string }>;
  checkLoginStatus: (cookies: string) => Promise<boolean>;
  publishImageWorkApi: (cookies: string, tokens: unknown, imagePaths: string[], settings: Record<string, unknown>) => Promise<unknown>;
  publishVideoWorkApi: (cookies: string, tokens: unknown, videoPath: string, settings: Record<string, unknown>, callback: (progress: number, message?: string) => void) => Promise<unknown>;
};
export { douyinService };
