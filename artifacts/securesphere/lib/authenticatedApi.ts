import { useAuth } from "@clerk/expo";
import { useCallback, useRef } from "react";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

export function useAuthenticatedApi() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  // @clerk/expo's useAuth returns a new getToken on every render. Depending on
  // it directly made `request` (and every API object memoised on it) change
  // each render, re-running consumers' effects in a loop.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const request = useCallback(async (
    path: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    if (!isLoaded || !isSignedIn) {
      throw new Error("User is not signed in.");
    }

    const token = await getTokenRef.current();
    if (!token) {
      throw new Error("Clerk session token is unavailable.");
    }

    const headers = new Headers(init.headers ?? {});
    headers.set("Authorization", `Bearer ${token}`);

    if (
      !headers.has("Content-Type") &&
      init.body !== undefined &&
      !(init.body instanceof FormData)
    ) {
      headers.set("Content-Type", "application/json");
    }

    const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

    return fetch(url, {
      ...init,
      headers,
    });
  }, [isLoaded, isSignedIn]);

  return { request };
}
