import type { FreedomVideoParams, GenerationResult } from "./freedom-api";
import type { FreedomVideoRoute } from "./freedom-routing";

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
