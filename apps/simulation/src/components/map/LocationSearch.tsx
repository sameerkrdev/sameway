import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import type { LatLng } from "@/domain/entities";
import { DELHI_PLACES } from "@/scenarios/builders";

interface Suggestion {
  id: string;
  label: string;
  resolve(): Promise<LatLng | null>;
}

/** Offline fallback so search still works without a Places-enabled key. */
const LOCAL_PLACES: Suggestion[] = Object.entries(DELHI_PLACES).map(([key, point]) => ({
  id: key,
  label: key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase()),
  resolve: () => Promise.resolve(point),
}));

/**
 * Place search built on the Places (New) autocomplete data API.
 *
 * Uses `AutocompleteSuggestion.fetchAutocompleteSuggestions` with a session
 * token rather than the legacy `AutocompleteService`, which Google moved to
 * Legacy status alongside the Directions and Distance Matrix services.
 */
export function LocationSearch({
  onSelect,
  placeholder = "Search a location…",
}: {
  onSelect: (point: LatLng, label: string) => void;
  placeholder?: string;
}) {
  const placesLibrary = useMapsLibrary("places");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const sessionToken = useRef<unknown>(null);

  const localMatches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return [];
    }
    return LOCAL_PLACES.filter((place) => place.label.toLowerCase().includes(needle)).slice(0, 6);
  }, [query]);

  useEffect(() => {
    const needle = query.trim();

    if (needle.length < 3) {
      setSuggestions([]);
      return;
    }

    if (!placesLibrary) {
      setSuggestions(localMatches);
      return;
    }

    let cancelled = false;
    // Debounced so a session is not billed per keystroke.
    const timer = setTimeout(() => {
      void fetchSuggestions({ placesLibrary, needle, sessionToken })
        .then((results) => {
          if (!cancelled) {
            setSuggestions(results.length > 0 ? results : localMatches);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions(localMatches);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, placesLibrary, localMatches]);

  const visible = open && suggestions.length > 0;

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]"
        aria-hidden
      />
      <Input
        value={query}
        placeholder={placeholder}
        className="pl-7"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {visible ? (
        <ul className="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--popover)] shadow-lg">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <button
                type="button"
                className="w-full px-2 py-1.5 text-left text-xs hover:bg-[var(--accent)]"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  void suggestion.resolve().then((point) => {
                    if (point) {
                      onSelect(point, suggestion.label);
                      setQuery(suggestion.label);
                      setOpen(false);
                      sessionToken.current = null;
                    }
                  });
                }}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface PlacesNamespace {
  AutocompleteSessionToken: new () => unknown;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: Record<string, unknown>): Promise<{
      suggestions?: {
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          toPlace(): {
            location?: { lat(): number; lng(): number } | null;
            fetchFields(request: { fields: string[] }): Promise<unknown>;
          };
        };
      }[];
    }>;
  };
}

async function fetchSuggestions(args: {
  placesLibrary: unknown;
  needle: string;
  sessionToken: { current: unknown };
}): Promise<Suggestion[]> {
  const places = args.placesLibrary as Partial<PlacesNamespace>;

  if (!places.AutocompleteSuggestion || !places.AutocompleteSessionToken) {
    return [];
  }

  args.sessionToken.current ??= new places.AutocompleteSessionToken();

  const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input: args.needle,
    sessionToken: args.sessionToken.current,
    // Bias toward Delhi NCR, which is where the demo scenarios live.
    locationBias: { north: 28.95, south: 28.3, east: 77.6, west: 76.8 },
  });

  return (suggestions ?? [])
    .map((entry, index): Suggestion | null => {
      const prediction = entry.placePrediction;
      if (!prediction) {
        return null;
      }

      return {
        id: prediction.placeId ?? `suggestion-${index}`,
        label: prediction.text?.text ?? "Unnamed place",
        resolve: async () => {
          const place = prediction.toPlace();
          await place.fetchFields({ fields: ["location", "displayName", "formattedAddress"] });
          const location = place.location;
          return location ? { lat: location.lat(), lng: location.lng() } : null;
        },
      };
    })
    .filter((entry): entry is Suggestion => entry !== null);
}
