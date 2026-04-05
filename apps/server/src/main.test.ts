import { resolveBackendBinding } from "./main";

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
