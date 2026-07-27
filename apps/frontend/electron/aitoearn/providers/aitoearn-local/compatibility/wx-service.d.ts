declare const shipinhaoService: {
  loginOrView: (mode: "login" | "view", cookies?: unknown) => Promise<{ success: boolean; data?: { cookie: string; userInfo: unknown }; error?: string }>;
  checkLoginStatus: (cookies: string) => Promise<boolean>;
  publishVideoWorkApi: (cookies: Electron.Cookie[], videoPath: string, settings: Record<string, unknown>, callback: (progress: number, message?: string) => void) => Promise<unknown>;
};
export { shipinhaoService };
