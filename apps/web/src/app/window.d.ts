import type {
  MagickDesktopApi,
  MagickDesktopFileApi,
} from "@magick/shared/localWorkspace";

declare global {
  interface Window {
    magickDesktop?: MagickDesktopApi;
    magickDesktopFiles?: MagickDesktopFileApi;
  }
}
