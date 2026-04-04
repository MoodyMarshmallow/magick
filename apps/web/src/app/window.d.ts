import type {
  MagickDesktopApi,
  MagickDesktopFileApi,
} from "@magick/shared/localWorkspace";

declare global {
  interface MagickDesktopRuntimeApi {
    getBackendUrl: () => Promise<string>;
  }

  interface Window {
    magickDesktop?: MagickDesktopApi;
    magickDesktopFiles?: MagickDesktopFileApi;
    magickDesktopRuntime?: MagickDesktopRuntimeApi;
  }
}
