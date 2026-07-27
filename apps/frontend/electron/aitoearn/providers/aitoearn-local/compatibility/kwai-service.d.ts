declare const kwaiPub: {
  login: () => Promise<{ cookies: Electron.Cookie[]; userInfo: unknown }>;
  getAccountInfo: (cookies: Electron.Cookie[]) => Promise<{ status: number; data?: { data?: { userInfo?: unknown } } }>;
  pubVideo: (params: { cookies: Electron.Cookie[]; topics: string[]; desc: string; videoPath: string; coverPath: string; callback: (progress: number, message?: string) => void; photoStatus: 1 | 2 | 4; proxy?: string }) => Promise<unknown>;
};
export { kwaiPub };
