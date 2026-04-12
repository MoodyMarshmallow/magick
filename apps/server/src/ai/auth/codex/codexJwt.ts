// Parses Codex-related JWT claims and extracts account metadata used by auth flows.

interface CodexJwtClaims {
  readonly chatgpt_account_id?: string;
  readonly organizations?: readonly { readonly id: string }[];
  readonly email?: string;
  readonly [key: string]: unknown;
}

const decodeBase64Url = (value: string): string => {
  return Buffer.from(value, "base64url").toString("utf8");
};

export const parseJwtClaims = (token: string): CodexJwtClaims | undefined => {
  const parts = token.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || !payload) {
    return undefined;
  }

  try {
    return JSON.parse(decodeBase64Url(payload)) as CodexJwtClaims;
  } catch {
    return undefined;
  }
};

export const extractAccountIdFromClaims = (
  claims: CodexJwtClaims,
): string | undefined => {
  const nestedAuth = claims["https://api.openai.com/auth"] as
    | { readonly chatgpt_account_id?: string }
    | undefined;

  return (
    claims.chatgpt_account_id ??
    nestedAuth?.chatgpt_account_id ??
    claims.organizations?.[0]?.id
  );
};

export const extractEmailFromClaims = (
  claims: CodexJwtClaims,
): string | undefined => {
  return claims.email;
};
