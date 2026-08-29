import type { FreedomVideoParams, GenerationResult } from "./generation-types";
import type { FreedomVideoRoute } from "./video-routing";

export type FreedomVideoRouteHandler = (
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
) => Promise<GenerationResult>;

export type FreedomVideoRouteHandlers = Record<FreedomVideoRoute, FreedomVideoRouteHandler>;

export function runFreedomVideoRoute(
  route: FreedomVideoRoute,
  handlers: FreedomVideoRouteHandlers,
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
) {
  return handlers[route](params, model, apiKey, baseUrl);
}
