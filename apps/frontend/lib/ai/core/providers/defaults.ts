// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { IProvider } from "./types";

/** Default provider templates used when migrating legacy API configuration. */

export const DEFAULT_PROVIDERS: Omit<IProvider, "id" | "apiKey">[] = [
  {
    platform: "openai-compatible",
    name: "OpenAI 兼容中转站",
    baseUrl: "https://api.example.com/v1",
    model: ["gpt-4o-mini"],
    capabilities: ["text", "vision", "image_generation", "video_generation", "tts"],
  },
  {
    platform: "runninghub",
    name: "RunningHub",
    baseUrl: "https://www.runninghub.cn/openapi/v2",
    model: ["2009613632530812930"],
    capabilities: ["image_generation", "vision"],
  },
];

