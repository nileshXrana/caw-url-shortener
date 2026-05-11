const BASE_URL = "http://localhost:3000";

async function runTest() {
  console.log("Running regression test: Redirect Logic...");

  try {
    // 1. Create a test link
    // Note: Our API expects 'long_url' and tenant info in headers
    const create = await fetch(`${BASE_URL}/links`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-tenant-id": "regression-test",
        "x-created-by": "test-runner"
      },
      body: JSON.stringify({ long_url: "https://example.com" })
    });

    if (!create.ok) {
      throw new Error(`Failed to create link: ${create.status} ${await create.text()}`);
    }

    const { code } = await create.json();
    console.log(`- Created test link with code: ${code}`);

    // 2. Hit the redirect and assert 302
    // We use redirect: "manual" to stop fetch from following the 302
    const redirect = await fetch(`${BASE_URL}/r/${code}`, { redirect: "manual" });

    console.log(`- Received status: ${redirect.status}`);
    
    if (redirect.status !== 302) {
      throw new Error(`Expected 302, got ${redirect.status}`);
    }

    const location = redirect.headers.get("location");
    console.log(`- Location header: ${location}`);

    if (location !== "https://example.com") {
      throw new Error(`Wrong location header. Expected https://example.com, got ${location}`);
    }

    console.log("✅ PASS: Redirect returns 302 with correct Location header");
  } catch (err) {
    console.error("❌ FAIL:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

runTest();
