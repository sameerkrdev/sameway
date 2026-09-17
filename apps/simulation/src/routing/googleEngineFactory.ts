import { GoogleRoutesEngine, type GoogleRoutesLibrary } from "./GoogleRoutesEngine";
import type { RoutingEngine } from "./types";

let routesLibrary: GoogleRoutesLibrary | null = null;
let loadFailureReason: string | null = null;
let loadPromise: Promise<void> | null = null;

export function hasApiKey(): boolean {
  return Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
}

/**
 * Loads the Routes library once, at startup.
 *
 * The engine choice has to be a synchronous decision at run time so that a
 * single run can never mix real and synthetic distances, so the async import
 * happens here and `createGoogleRoutesEngine` just reads the result.
 */
export async function preloadRoutesLibrary(): Promise<void> {
  if (routesLibrary || loadFailureReason) {
    return;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    if (!hasApiKey()) {
      loadFailureReason = "VITE_GOOGLE_MAPS_API_KEY is not set";
      return;
    }

    const maps = (globalThis as { google?: { maps?: Record<string, unknown> } }).google?.maps;
    const importLibrary = maps?.importLibrary as
      | ((name: string) => Promise<unknown>)
      | undefined;

    if (!importLibrary) {
      loadFailureReason = "Google Maps JavaScript API has not finished loading";
      return;
    }

    try {
      const library = (await importLibrary("routes")) as Partial<GoogleRoutesLibrary>;

      if (!library.Route || !library.RouteMatrix) {
        loadFailureReason =
          "Routes library loaded without Route/RouteMatrix — is the Routes API enabled on this key?";
        return;
      }

      routesLibrary = library as GoogleRoutesLibrary;
      loadFailureReason = null;
    } catch (error) {
      loadFailureReason =
        error instanceof Error ? error.message : "Failed to load the Google Routes library";
    }
  })();

  return loadPromise;
}

/**
 * Returns a Google-backed engine, or null with a recorded reason. Returning
 * null is what triggers the visible MOCK ROUTING banner rather than a silent
 * substitution of synthetic distances.
 */
export function createGoogleRoutesEngine(): RoutingEngine | null {
  if (routesLibrary) {
    return new GoogleRoutesEngine(routesLibrary);
  }

  if (loadFailureReason) {
    throw new Error(loadFailureReason);
  }

  throw new Error("Google Routes library has not been loaded yet");
}

export function routesLibraryStatus(): {
  loaded: boolean;
  reason: string | null;
} {
  return { loaded: routesLibrary !== null, reason: loadFailureReason };
}
