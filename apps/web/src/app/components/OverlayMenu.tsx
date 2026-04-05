import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface OverlayMenuPosition {
  readonly left: number;
  readonly top: number;
  readonly alignX?: "left" | "right";
}

interface OverlayMenuProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly onClose: () => void;
  readonly position: OverlayMenuPosition;
}

export const getMenuPositionFromTrigger = (
  trigger: HTMLElement,
): OverlayMenuPosition => {
  const rect = trigger.getBoundingClientRect();
  return {
    left: rect.right,
    top: rect.bottom + 4,
    alignX: "right",
  };
};

export const getMenuPositionFromPointer = (args: {
  readonly clientX: number;
  readonly clientY: number;
}): OverlayMenuPosition => ({
  left: args.clientX,
  top: args.clientY + 8,
  alignX: "left",
});

export function OverlayMenu({
  children,
  className = "",
  onClose,
  position,
}: OverlayMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }

      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      className={`overlay-menu ${className}`.trim()}
      ref={menuRef}
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        transform:
          position.alignX === "right" ? "translateX(-100%)" : undefined,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
