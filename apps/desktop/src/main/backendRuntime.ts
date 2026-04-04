import { join } from "node:path";

export const resolveDesktopBackendDatabasePath = (
  userDataPath: string,
): string => {
  return join(userDataPath, "backend.db");
};
