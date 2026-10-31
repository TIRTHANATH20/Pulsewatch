import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/lib/password";

describe("password storage", () => {
  it("verifies the password while storing a salted scrypt hash", async () => {
    const password = "a-long-test-password";
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).not.toBe(password);
    expect(first).not.toBe(second);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword("different-password", first)).toBe(false);
  });

  it("rejects malformed hashes and oversized passwords", async () => {
    expect(await verifyPassword("password", "not-a-password-hash")).toBe(false);
    expect(await verifyPassword("x".repeat(1025), "not-a-password-hash")).toBe(
      false,
    );
    await expect(hashPassword("x".repeat(1025))).rejects.toThrow(/too long/);
  });
});
