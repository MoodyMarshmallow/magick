import type { MagickDesktopApi } from "@magick/shared/localWorkspace";

declare global {
  interface Window {
    magickDesktop?: MagickDesktopApi;
  }
}
