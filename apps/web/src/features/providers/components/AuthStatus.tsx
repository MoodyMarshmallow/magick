import { CircleDot, Orbit, ScanEye } from "lucide-react";

export function AuthStatus() {
  return (
    <section className="auth-line">
      <div className="auth-line__header">
        <p className="eyebrow">Channel</p>
        <span>
          <Orbit size={15} />
          codex
        </span>
      </div>
      <ul className="auth-line__list">
        <li>
          <CircleDot size={14} />
          auth link stable
        </li>
        <li>
          <ScanEye size={14} />
          replies stream into live threads
        </li>
      </ul>
    </section>
  );
}
