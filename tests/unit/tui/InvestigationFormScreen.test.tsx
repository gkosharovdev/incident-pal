import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { InvestigationFormScreen } from "../../../src/tui/screens/InvestigationFormScreen.js";

describe("InvestigationFormScreen", () => {
  it("renders form fields on mount", () => {
    const { lastFrame } = render(
      <InvestigationFormScreen onSubmit={vi.fn()} />,
    );
    expect(lastFrame()).toContain("New Investigation");
    expect(lastFrame()).toContain("Service ID");
    expect(lastFrame()).toContain("Environment");
  });

  it("calls onSubmit with correct InvestigationRequest when service filled and Enter pressed on description", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <InvestigationFormScreen onSubmit={onSubmit} />,
    );

    // Type service ID and advance through fields
    stdin.write("order-service");
    await new Promise((r) => setTimeout(r, 50));
    // Tab to environment
    stdin.write("\t");
    await new Promise((r) => setTimeout(r, 50));
    // Tab to linking key
    stdin.write("\t");
    await new Promise((r) => setTimeout(r, 50));
    // Tab to description
    stdin.write("\t");
    await new Promise((r) => setTimeout(r, 50));
    // Submit
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: "order-service",
        environment: "production",
      }),
    );
  });

  it("does not submit when service ID is empty", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <InvestigationFormScreen onSubmit={onSubmit} />,
    );

    // Tab to description and try to submit with empty service ID
    stdin.write("\t\t\t");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
