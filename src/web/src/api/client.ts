import type { HealthResponse, LoginRequest, SessionResponse } from "./contract";
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}
export const unauthorizedEvent = "fortnight:unauthorized";
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event(unauthorizedEvent));
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : null;
    const message =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : "The request could not be completed. Please try again.";
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "REQUEST_FAILED";
    throw new ApiError(response.status, code, message);
  }
  return payload as T;
}
export const api = {
  health: (signal?: AbortSignal) =>
    request<HealthResponse>("/health", { signal }),
  session: (signal?: AbortSignal) =>
    request<SessionResponse>("/session", { signal }),
  login: (body: LoginRequest) =>
    request<SessionResponse>("/session", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  logout: () =>
    request<Record<string, never>>("/session", { method: "DELETE" }),
};
