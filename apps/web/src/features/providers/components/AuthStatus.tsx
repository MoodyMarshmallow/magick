import { CircleDot, Orbit, ScanEye } from "lucide-react";
import { appIconSize } from "../../../app/appIconSize";

export function AuthStatus() {
  return (
    <section className="auth-line">
      <div className="auth-line__header">
        <p className="eyebrow">Channel</p>
        <span>
          <Orbit size={appIconSize} />
          codex
        </span>
      </div>
      <ul className="auth-line__list">
        <li>
          <CircleDot size={appIconSize} />
          auth link stable
        </li>
        <li>
          <ScanEye size={appIconSize} />
          replies stream into live threads
        </li>
      </ul>
    </section>
  );
}
