// Provides shared time helpers for consistent timestamp generation.

export const nowIso = (): string => {
  return new Date().toISOString();
};
