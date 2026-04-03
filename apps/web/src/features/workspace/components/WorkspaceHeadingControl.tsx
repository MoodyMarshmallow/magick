import { ChevronDown, ChevronUp, Heading } from "lucide-react";
import {
  type WheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { appIconSize } from "../../../app/appIconSize";
import type {
  EditorCommandName,
  EditorHeadingLevel,
} from "../../document/components/EditorSurface";

const minHeadingLevel: EditorHeadingLevel = 1;
const maxHeadingLevel: EditorHeadingLevel = 6;

const clampHeadingLevel = (level: number): EditorHeadingLevel => {
  if (level <= minHeadingLevel) {
    return minHeadingLevel;
  }

  if (level >= maxHeadingLevel) {
    return maxHeadingLevel;
  }

  return level as EditorHeadingLevel;
};

interface WorkspaceHeadingControlProps {
  readonly activeHeadingLevel: EditorHeadingLevel | null;
  readonly onCommand: (
    commandName: EditorCommandName,
    options?: { readonly level?: EditorHeadingLevel },
  ) => void;
}

interface PickerPosition {
  readonly left: number;
  readonly top: number;
}

export function WorkspaceHeadingControl({
  activeHeadingLevel,
  onCommand,
}: WorkspaceHeadingControlProps) {
  const [selectedLevel, setSelectedLevel] =
    useState<EditorHeadingLevel>(minHeadingLevel);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const [pickerPosition, setPickerPosition] = useState<PickerPosition | null>(
    null,
  );

  const isHeadingActive = activeHeadingLevel !== null;

  const syncPickerPosition = useCallback(() => {
    const toggle = toggleRef.current;
    if (!toggle) {
      return;
    }

    const rect = toggle.getBoundingClientRect();
    setPickerPosition({
      left: rect.right + 6,
      top: rect.top,
    });
  }, []);

  useEffect(() => {
    if (!isHeadingActive) {
      return;
    }

    setSelectedLevel(activeHeadingLevel);
  }, [activeHeadingLevel, isHeadingActive]);

  useLayoutEffect(() => {
    if (!isHeadingActive) {
      return;
    }

    syncPickerPosition();
  }, [isHeadingActive, syncPickerPosition]);

  useEffect(() => {
    if (!isHeadingActive) {
      return;
    }

    window.addEventListener("resize", syncPickerPosition);
    window.addEventListener("scroll", syncPickerPosition, true);
    return () => {
      window.removeEventListener("resize", syncPickerPosition);
      window.removeEventListener("scroll", syncPickerPosition, true);
    };
  }, [isHeadingActive, syncPickerPosition]);

  const handleToggleClick = () => {
    if (isHeadingActive) {
      onCommand("setParagraph");
      return;
    }

    onCommand("toggleHeading", { level: selectedLevel });
  };

  const handleLevelChange = (delta: -1 | 1) => {
    const nextLevel = clampHeadingLevel(selectedLevel + delta);
    if (nextLevel === selectedLevel) {
      return;
    }

    setSelectedLevel(nextLevel);
    onCommand("setHeading", { level: nextLevel });
  };

  const handlePickerWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) {
      return;
    }

    event.preventDefault();
    handleLevelChange(event.deltaY > 0 ? 1 : -1);
  };

  return (
    <div className="workspace__toolbar-heading">
      <button
        aria-expanded={isHeadingActive}
        aria-label="Heading"
        className={`workspace__toolbar-button${
          isHeadingActive ? " is-active" : ""
        }`}
        onClick={handleToggleClick}
        ref={toggleRef}
        type="button"
      >
        <Heading size={appIconSize} />
      </button>
      {isHeadingActive && pickerPosition
        ? createPortal(
            <div
              className="workspace__toolbar-heading-picker"
              onWheel={handlePickerWheel}
              style={{
                left: `${pickerPosition.left}px`,
                top: `${pickerPosition.top}px`,
              }}
            >
              <button
                aria-label="Previous heading level"
                className="workspace__toolbar-heading-step"
                onClick={() => handleLevelChange(-1)}
                type="button"
              >
                <ChevronUp size={appIconSize} />
              </button>
              <output
                aria-label="Heading level"
                className="workspace__toolbar-heading-value"
              >
                {selectedLevel}
              </output>
              <button
                aria-label="Next heading level"
                className="workspace__toolbar-heading-step"
                onClick={() => handleLevelChange(1)}
                type="button"
              >
                <ChevronDown size={appIconSize} />
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
