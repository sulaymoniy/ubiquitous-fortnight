import {
  ApiError as ApiErrorSchema,
  HealthResponse,
  LoginRequest,
  LogoutResponse,
  SessionResponse,
} from "@fortnight/shared";

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const unauthorizedEvent = "fortnight:unauthorized";
interface ResponseSchema<T> {
  parse: (input: unknown) => T;
}

export async function request<T>(
  path: string,
  schema: ResponseSchema<T>,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (typeof options.body === "string" && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      ...options,
      headers,
      credentials: "same-origin",
    });
  } catch (error) {
    if (error instanceof TypeError)
      throw new ApiError(
        0,
        "network_error",
        "Could not connect to your workspace. Check your connection and try again.",
      );
    throw error;
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event(unauthorizedEvent));
    const parsed = ApiErrorSchema.safeParse(payload);
    if (parsed.success)
      throw new ApiError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
      );
    throw new ApiError(
      response.status,
      "request_failed",
      "The request could not be completed. Please try again.",
    );
  }
  try {
    return schema.parse(payload);
  } catch {
    throw new ApiError(
      502,
      "invalid_response",
      "The workspace sent an unexpected response. Refresh and try again.",
    );
  }
}
export const api = {
  health: (signal?: AbortSignal) =>
    request("/health", HealthResponse, { signal }),
  session: (signal?: AbortSignal) =>
    request("/session", SessionResponse, { signal }),
  login: (body: LoginRequest) =>
    request("/session", SessionResponse, {
      method: "POST",
      body: JSON.stringify(LoginRequest.parse(body)),
    }),
  logout: () => request("/session", LogoutResponse, { method: "DELETE" }),
};
