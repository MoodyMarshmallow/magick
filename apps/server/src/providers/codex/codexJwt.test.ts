// Verifies JWT parsing and Codex account metadata extraction rules.

import {
  extractAccountIdFromClaims,
  extractEmailFromClaims,
  parseJwtClaims,
} from "./codexJwt";

const encodeJwt = (payload: Record<string, unknown>) => {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
};

describe("codexJwt", () => {
  it("parses JWT claims and extracts account metadata", () => {
    const token = encodeJwt({
      chatgpt_account_id: "acct_1",
      email: "user@example.com",
    });
    const claims = parseJwtClaims(token);

    expect(claims).toBeDefined();
    expect(extractAccountIdFromClaims(claims ?? {})).toBe("acct_1");
    expect(extractEmailFromClaims(claims ?? {})).toBe("user@example.com");
  });

  it("falls back to organization ids and handles malformed tokens", () => {
    expect(parseJwtClaims("bad-token")).toBeUndefined();
    expect(
      extractAccountIdFromClaims({ organizations: [{ id: "org_1" }] }),
    ).toBe("org_1");
  });
});
