export class WebContentService {
  readonly #fetch: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.#fetch = fetchImpl;
  }

  async fetchUrl(
    url: string,
  ): Promise<{ readonly url: string; readonly content: string }> {
    const response = await this.#fetch(url);
    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}.`);
    }

    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    const body = await response.text();
    const content = contentType.includes("text/html")
      ? body
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : body.trim();

    return { url, content };
  }
}
