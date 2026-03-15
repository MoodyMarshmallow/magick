// Provides shared id generation helpers.

export const createId = (prefix: string): string => {
  return `${prefix}_${crypto.randomUUID()}`;
};
