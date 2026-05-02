import { WebContentService } from "./webContentService";

describe("WebContentService", () => {
  it("strips html wrappers for fetched pages", async () => {
    const service = new WebContentService(
      (async () =>
        new Response(
          "<html><body><script>ignored()</script><main>Hello <strong>Magick</strong></main></body></html>",
          {
            status: 200,
            headers: { "content-type": "text/html" },
          },
        )) as unknown as typeof fetch,
    );

    await expect(
      service.fetchUrl("https://example.com"),
    ).resolves.toMatchObject({
      content: "Hello Magick",
    });
  });

  it("surfaces network and http failures", async () => {
    const networkService = new WebContentService((async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch);
    await expect(
      networkService.fetchUrl("https://example.com"),
    ).rejects.toThrow("network down");

    const httpService = new WebContentService(
      (async () =>
        new Response("nope", { status: 503 })) as unknown as typeof fetch,
    );
    await expect(httpService.fetchUrl("https://example.com")).rejects.toThrow(
      "Fetch failed with status 503.",
    );
  });

  it("returns the final response URL after redirects", async () => {
    const fetchMock = vi.fn(async () => {
      const response = new Response("redirected", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
      Object.defineProperty(response, "url", {
        value: "https://example.com/final",
      });
      return response;
    });
    const redirectingService = new WebContentService(
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      redirectingService.fetchUrl("https://example.com/start"),
    ).resolves.toEqual({
      url: "https://example.com/final",
      content: "redirected",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/start");
  });
});
