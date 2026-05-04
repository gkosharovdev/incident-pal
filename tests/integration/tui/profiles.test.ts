import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { InvestigationProfileService } from "../../../src/tui/services/InvestigationProfileService.js";

describe("Investigation profile CRUD", () => {
  let tmpDir: string;
  let svc: InvestigationProfileService;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pal-profiles-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    svc = new InvestigationProfileService(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full CRUD lifecycle: save → list → delete → verify absent", () => {
    const p = svc.save({
      name: "Production Order Service",
      serviceId: "order-service",
      environment: "prod",
      defaultLinkingKeyPrefix: "order",
    });

    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0]?.id).toBe(p.id);

    svc.delete(p.id);
    expect(svc.list()).toHaveLength(0);
  });

  it("duplicate name rejection", () => {
    svc.save({
      name: "My Profile",
      serviceId: "svc-a",
      environment: "dev",
      defaultLinkingKeyPrefix: null,
    });

    expect(() =>
      svc.save({
        name: "My Profile",
        serviceId: "svc-b",
        environment: "prod",
        defaultLinkingKeyPrefix: null,
      }),
    ).toThrow(/already exists/);

    expect(svc.list()).toHaveLength(1);
  });

  it("update preserves createdAt and changes updatedAt", () => {
    const original = svc.save({
      name: "Editable",
      serviceId: "svc",
      environment: "dev",
      defaultLinkingKeyPrefix: null,
    });

    // Small delay to ensure different timestamp
    const updated = svc.save({
      id: original.id,
      name: "Editable",
      serviceId: "svc-updated",
      environment: "prod",
      defaultLinkingKeyPrefix: "order",
    });

    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.serviceId).toBe("svc-updated");
    expect(svc.list()).toHaveLength(1);
  });

  it("persists across service instances (file-backed)", () => {
    svc.save({
      name: "Persistent",
      serviceId: "svc",
      environment: "dev",
      defaultLinkingKeyPrefix: null,
    });

    const svc2 = new InvestigationProfileService(tmpDir);
    expect(svc2.list()).toHaveLength(1);
    expect(svc2.list()[0]?.name).toBe("Persistent");
  });
});
