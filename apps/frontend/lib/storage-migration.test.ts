import { describe, expect, it } from "vitest";
import {
  migrateToProjectStorage as facadeMigrate,
  recoverFromLegacy as facadeRecover,
} from "./storage-migration";
import {
  migrateToProjectStorage as canonicalMigrate,
  recoverFromLegacy as canonicalRecover,
} from "./storage/storage-migration";

describe("storage-migration root facade", () => {
  it("re-exports the same migration helpers as the storage domain module", () => {
    expect(facadeMigrate).toBe(canonicalMigrate);
    expect(facadeRecover).toBe(canonicalRecover);
  });
});
