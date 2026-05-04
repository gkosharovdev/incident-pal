import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { InvestigationProfileService } from "../../../src/tui/services/InvestigationProfileService.js";

describe("InvestigationProfileService", () => {
  let tmpDir: string;
  let svc: InvestigationProfileService;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pal-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    svc = new InvestigationProfileService(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists empty array when no profiles file exists", () => {
    expect(svc.list()).toEqual([]);
  });

  it("saves and retrieves a profile", () => {
    const saved = svc.save({
      name: "Test Profile",
      serviceId: "my-service",
      environment: "prod",
      defaultLinkingKeyPrefix: "order",
    });
    expect(saved.id).toBeTruthy();
    expect(saved.name).toBe("Test Profile");

    const list = svc.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Test Profile");
  });

  it("rejects duplicate profile names", () => {
    svc.save({
      name: "Dup",
      serviceId: "svc",
      environment: "dev",
      defaultLinkingKeyPrefix: null,
    });
    expect(() =>
      svc.save({
        name: "Dup",
        serviceId: "svc2",
        environment: "dev",
        defaultLinkingKeyPrefix: null,
      }),
    ).toThrow(/already exists/);
  });

  it("deletes a profile by id", () => {
    const p = svc.save({
      name: "ToDelete",
      serviceId: "svc",
      environment: "dev",
      defaultLinkingKeyPrefix: null,
    });
    svc.delete(p.id);
    expect(svc.list()).toHaveLength(0);
  });
});
