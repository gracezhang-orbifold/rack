import { test, expect } from "@playwright/test";

// Prereqs (see README): db container up + migrated + seeded + dev users;
// mock Seam on :9911; API on :3000 with SEAM_API_URL/RESEND_API_URL → :9911;
// a lock paired: update locks set seam_device_id='mock-device-1'.
test("borrow and return an item end to end", async ({ page }) => {
  await page.goto("/");
  // Sign in
  await page.getByLabel(/email/i).fill("user@rack.local");
  await page.getByLabel(/password/i).fill("password123");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  // Browse + search
  await expect(page.getByPlaceholder(/search/i)).toBeVisible();
  await page.getByPlaceholder(/search/i).fill("GoPro 13");
  const row = page.locator("li", { hasText: "GoPro 13 Black" });
  await expect(row).toBeVisible();

  // Borrow
  await row.getByRole("button", { name: /borrow/i }).click();
  await page.getByRole("button", { name: /confirm & unlock/i }).click();
  await expect(page.getByText(/cabinet unlocked|checked out/i)).toBeVisible();
  await page.getByRole("button", { name: /done/i }).click();

  // My Items → return (scope to the first matching row — the account may
  // already hold other borrows from earlier runs; state is not reset here)
  await page.getByRole("link", { name: /my items/i }).click();
  const myRow = page.locator("li", { hasText: "GoPro 13 Black" }).first();
  await expect(myRow).toBeVisible();
  await myRow.getByRole("button", { name: /return/i }).click();
  await page.getByRole("button", { name: /confirm & unlock/i }).click();
  await expect(page.getByText(/cabinet unlocked/i)).toBeVisible();
});
