// Tiny mock of the two Seam endpoints the backend uses (plus Resend's /emails),
// for local smoke tests without Seam/Resend accounts.
// Run: deno run --allow-net scripts/mock-seam.ts [port]
// Set MOCK_SEAM_FAIL=1 to make every unlock fail (tests the compensation path).

const port = Number(Deno.args[0] ?? 9911);
const shouldFail = Deno.env.get("MOCK_SEAM_FAIL") === "1";

Deno.serve({ port }, async (req) => {
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));

  if (url.pathname === "/locks/unlock_door") {
    return Response.json({
      action_attempt: {
        action_attempt_id: `mock-${crypto.randomUUID()}`,
        status: "pending",
        device_id: body.device_id,
      },
    });
  }

  if (url.pathname === "/action_attempts/get") {
    return Response.json({
      action_attempt: {
        action_attempt_id: body.action_attempt_id,
        status: shouldFail ? "error" : "success",
        error: shouldFail ? { message: "mock unlock failure" } : undefined,
      },
    });
  }

  if (url.pathname === "/emails") {
    console.log(`[mock resend] to=${JSON.stringify(body.to)} subject=${body.subject}`);
    return Response.json({ id: `mock-email-${crypto.randomUUID()}` });
  }

  return Response.json({ error: "unknown endpoint" }, { status: 404 });
});
