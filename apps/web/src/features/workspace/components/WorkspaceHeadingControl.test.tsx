// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceHeadingControl } from "./WorkspaceHeadingControl";

describe("WorkspaceHeadingControl", () => {
  it("turns heading mode on and opens the level picker", () => {
    const handleCommand = vi.fn();
    const { rerender } = render(
      <WorkspaceHeadingControl
        activeHeadingLevel={null}
        onCommand={handleCommand}
      />,
    );

    fireEvent.click(screen.getByLabelText("Heading"));

    expect(handleCommand).toHaveBeenCalledWith("toggleHeading", { level: 1 });

    rerender(
      <WorkspaceHeadingControl
        activeHeadingLevel={1}
        onCommand={handleCommand}
      />,
    );

    expect(screen.getByLabelText("Heading level").textContent).toBe("1");
  });

  it("moves to a larger heading number with the down arrow", () => {
    const handleCommand = vi.fn();

    render(
      <WorkspaceHeadingControl
        activeHeadingLevel={1}
        onCommand={handleCommand}
      />,
    );

    fireEvent.click(screen.getByLabelText("Next heading level"));

    expect(handleCommand).toHaveBeenLastCalledWith("setHeading", {
      level: 2,
    });
    expect(screen.getByLabelText("Heading level").textContent).toBe("2");
  });

  it("changes the heading level when scrolling on the picker", () => {
    const handleCommand = vi.fn();

    render(
      <WorkspaceHeadingControl
        activeHeadingLevel={1}
        onCommand={handleCommand}
      />,
    );

    const picker = screen
      .getByLabelText("Previous heading level")
      .closest(".workspace__toolbar-heading-picker");

    if (!picker) {
      throw new Error("Expected heading picker to be present.");
    }

    fireEvent.wheel(picker, { deltaY: 120 });

    expect(handleCommand).toHaveBeenLastCalledWith("setHeading", {
      level: 2,
    });
    expect(screen.getByLabelText("Heading level").textContent).toBe("2");
  });

  it("hides the picker when heading mode turns off", () => {
    const handleCommand = vi.fn();
    const { rerender } = render(
      <WorkspaceHeadingControl
        activeHeadingLevel={1}
        onCommand={handleCommand}
      />,
    );

    rerender(
      <WorkspaceHeadingControl
        activeHeadingLevel={null}
        onCommand={handleCommand}
      />,
    );

    expect(screen.queryByLabelText("Heading level")).toBeNull();
  });

  it("toggles heading mode off when clicking the heading button again", () => {
    const handleCommand = vi.fn();
    const { rerender } = render(
      <WorkspaceHeadingControl
        activeHeadingLevel={2}
        onCommand={handleCommand}
      />,
    );

    fireEvent.click(screen.getByLabelText("Heading"));

    expect(handleCommand).toHaveBeenCalledWith("setParagraph");

    rerender(
      <WorkspaceHeadingControl
        activeHeadingLevel={null}
        onCommand={handleCommand}
      />,
    );

    expect(screen.queryByLabelText("Heading level")).toBeNull();
  });

  it("keeps the picker open when clicking inside it", () => {
    const handleCommand = vi.fn();

    render(
      <WorkspaceHeadingControl
        activeHeadingLevel={1}
        onCommand={handleCommand}
      />,
    );

    fireEvent.click(screen.getByLabelText("Next heading level"));

    expect(handleCommand).toHaveBeenLastCalledWith("setHeading", {
      level: 2,
    });
    expect(screen.getByLabelText("Heading level").textContent).toBe("2");
  });
});
