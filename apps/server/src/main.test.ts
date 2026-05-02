import {
  AGENT_TRANSPORT_DEBUG_FLAG,
  applyBackendRuntimeOptions,
  resolveBackendBinding,
  resolveBackendRuntimeOptions,
} from "./main";

const { setCodexTransportDebugEnabledMock } = vi.hoisted(() => ({
  setCodexTransportDebugEnabledMock: vi.fn(),
}));

vi.mock(
  "./ai/agent/modules/provider-runtime/codex/codexResponsesClient",
  () => ({
    setCodexTransportDebugEnabled: setCodexTransportDebugEnabledMock,
  }),
);

vi.mock("./index", () => ({
  attachWebSocketServer: vi.fn(),
  createBackendServices: vi.fn(() => ({
    providerAuthService: {},
    providerRegistry: {},
    contextCore: {},
    assistantTurnEngine: {},
    connections: {},
    database: {},
    databasePath: ":memory:",
  })),
}));

describe("resolveBackendBinding", () => {
  it("uses the default local binding", () => {
    expect(resolveBackendBinding({})).toEqual({
      host: "127.0.0.1",
      port: 8787,
    });
  });

  it("uses configured host and port", () => {
    expect(
      resolveBackendBinding({
        MAGICK_BACKEND_HOST: "0.0.0.0",
        MAGICK_BACKEND_PORT: "9000",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 9000,
    });
  });

  it("rejects invalid ports", () => {
    expect(() =>
      resolveBackendBinding({
        MAGICK_BACKEND_PORT: "99999",
      }),
    ).toThrow("Invalid MAGICK_BACKEND_PORT");
  });
});

describe("resolveBackendRuntimeOptions", () => {
  it("enables agent transport debugging when the flag is present", () => {
    expect(resolveBackendRuntimeOptions([AGENT_TRANSPORT_DEBUG_FLAG])).toEqual({
      debugAgentTransport: true,
    });
  });

  it("leaves agent transport debugging disabled by default", () => {
    expect(resolveBackendRuntimeOptions([])).toEqual({
      debugAgentTransport: false,
    });
  });
});

describe("applyBackendRuntimeOptions", () => {
  beforeEach(() => {
    setCodexTransportDebugEnabledMock.mockReset();
  });

  it("enables Codex transport debugging when the run flag is enabled", () => {
    applyBackendRuntimeOptions({
      debugAgentTransport: true,
    });

    expect(setCodexTransportDebugEnabledMock).toHaveBeenCalledWith(true);
  });

  it("disables Codex transport debugging when the run flag is not enabled", () => {
    applyBackendRuntimeOptions({
      debugAgentTransport: false,
    });

    expect(setCodexTransportDebugEnabledMock).toHaveBeenCalledWith(false);
  });
});
