// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { MermaidDiagram } from "./MermaidDiagram";

const { initializeMock, renderMock } = vi.hoisted(() => ({
  initializeMock: vi.fn(),
  renderMock: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
  },
}));

describe("MermaidDiagram", () => {
  beforeEach(() => {
    initializeMock.mockClear();
    renderMock.mockReset();
  });

  it("renders Mermaid svg output", async () => {
    renderMock.mockResolvedValue({ svg: "<svg><text>Flow</text></svg>" });

    const { container } = render(<MermaidDiagram source="graph TD; A-->B;" />);

    await waitFor(() => {
      expect(container.querySelector("svg")).toBeTruthy();
    });
    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false }),
    );
  });

  it("falls back to source when Mermaid rendering fails", async () => {
    renderMock.mockRejectedValue(new Error("parse failure"));

    render(<MermaidDiagram source="graph TD; invalid" />);

    await waitFor(() => {
      expect(screen.getByText(/Mermaid render failed:/)).toBeTruthy();
    });
    expect(screen.getByText("graph TD; invalid")).toBeTruthy();
  });
});
