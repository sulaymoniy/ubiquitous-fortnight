import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/web/src/App";
import { api, unauthorizedEvent } from "../../src/web/src/api/client";
import { useShell } from "../../src/web/src/store";
const user = {
  id: "demo-jamie",
  name: "Jamie",
  initials: "J",
  color: "#687b59",
};
const health = {
  ok: true,
  contractVersion: "1.0.0",
  agentKeyConfigured: false,
};
let signedIn = false;
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  signedIn = false;
  useShell.setState({ assistantOpen: true, sidebarOpen: false });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit = {}) => {
      if (url === "/api/health") return response(health);
      if (options.method === "POST") {
        signedIn = true;
        return response({ user });
      }
      if (options.method === "DELETE") {
        signedIn = false;
        return response({});
      }
      return signedIn
        ? response({ user })
        : response(
            { error: { code: "UNAUTHORIZED", message: "Sign in first" } },
            401,
          );
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("workspace session", () => {
  it("labels demo login and completes login and logout with same-origin cookies", async () => {
    const actor = userEvent.setup();
    mount();
    await actor.type(await screen.findByLabelText("Your name"), "Jamie");
    await actor.type(screen.getByLabelText(/Password/), "anything");
    await actor.click(screen.getByRole("button", { name: /Enter workspace/ }));
    expect(
      await screen.findByRole("heading", { name: "A fresh beginning." }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Workspace API connected"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Jamie", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/session",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ name: "Jamie", password: "anything" }),
      }),
    );
    await actor.click(screen.getByRole("button", { name: /Log out/ }));
    expect(
      await screen.findByRole("heading", { name: "Welcome to your space." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No account or real password needed/),
    ).toBeInTheDocument();
  });
  it("restores a session and toggles the assistant slot", async () => {
    signedIn = true;
    const actor = userEvent.setup();
    mount();
    expect(await screen.findByLabelText("Assistant")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByLabelText("Assistant")).not.toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Assistant" }));
    expect(screen.getByLabelText("Assistant")).toBeInTheDocument();
  });
  it("returns to login when an API request reports an expired session", async () => {
    signedIn = true;
    mount();
    await screen.findByRole("heading", { name: "A fresh beginning." });
    signedIn = false;
    await expect(api.session()).rejects.toMatchObject({ status: 401 });
    expect(await screen.findByLabelText("Your name")).toBeInTheDocument();
  });
  it("shows a retry screen for an unavailable API rather than pretending to log out", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Network unavailable"));
    mount();
    expect(
      await screen.findByRole("heading", { name: /reach your workspace/ }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
  });
  it("retains a failed login and allows retry", async () => {
    const actor = userEvent.setup();
    mount();
    await actor.type(await screen.findByLabelText("Your name"), "Jamie");
    vi.mocked(fetch).mockResolvedValueOnce(
      response(
        { error: { code: "FAIL", message: "Please try again later" } },
        500,
      ),
    );
    await actor.click(screen.getByRole("button", { name: /Enter workspace/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please try again later",
    );
    expect(screen.getByLabelText("Your name")).toHaveValue("Jamie");
    await actor.click(screen.getByRole("button", { name: /Enter workspace/ }));
    await screen.findByRole("heading", { name: "A fresh beginning." });
  });
  it("clears displayed user details on an unauthorized event", async () => {
    signedIn = true;
    mount();
    await screen.findByText("Jamie", { selector: "strong" });
    window.dispatchEvent(new Event(unauthorizedEvent));
    await waitFor(() =>
      expect(
        screen.queryByText("Jamie", { selector: "strong" }),
      ).not.toBeInTheDocument(),
    );
  });
});
