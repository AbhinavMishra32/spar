import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password credentials", () => {
  it("verifies the original password and rejects another password", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", encoded)).resolves.toBe(false);
  });

  it("uses a fresh salt for each password hash", async () => {
    const first = await hashPassword("same password");
    const second = await hashPassword("same password");
    expect(first).not.toBe(second);
  });
});
