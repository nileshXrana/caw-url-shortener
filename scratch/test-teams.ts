import assert from "node:assert";

const API_URL = "http://localhost:3000"; // Assuming dev server
const HEADERS = {
  "Content-Type": "application/json",
  "x-tenant-id": "test-tenant",
  "x-created-by": `user-${Math.random().toString(36).substring(7)}`
};

const randomSlug = () => `team-${Math.random().toString(36).substring(7)}`;

async function testTeams() {
  console.log("🚀 Starting Edge Case Gauntlet for /teams...");

  // 1. Security: Missing Headers
  console.log("Test 1: Missing Headers...");
  const res1 = await fetch(`${API_URL}/teams`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Fail Team", slug: "fail" })
  });
  assert.strictEqual(res1.status, 400, "Should return 400 for missing x-tenant-id");
  const data1 = await res1.json();
  assert.strictEqual(data1.error, "x-tenant-id is required");

  // 2. Edge Case: Empty Name
  console.log("Test 2: Empty Team Name...");
  const res2 = await fetch(`${API_URL}/teams`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ name: "  ", slug: "empty-name" })
  });
  assert.strictEqual(res2.status, 400, "Should return 400 for whitespace name");

  // 3. Validation: Invalid Slug
  console.log("Test 3: Invalid Slug (Spaces)...");
  const res3 = await fetch(`${API_URL}/teams`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ name: "Good Name", slug: "invalid slug" })
  });
  assert.strictEqual(res3.status, 400, "Should return 400 for slug with spaces");

  // 4. Selective Return: Leak Check
  console.log("Test 4: Selective JSON Return...");
  const res4 = await fetch(`${API_URL}/teams`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ name: "Security Team", slug: randomSlug() })
  });
  assert.strictEqual(res4.status, 201);
  const data4 = await res4.json();
  assert.ok(!data4.tenantId, "Should NOT leak tenantId in response");
  assert.ok(!data4.createdBy, "Should NOT leak createdBy in response");
  const teamId = data4.id;

  // 5. Security: IDOR Attack
  console.log("Test 5: IDOR Attack (User B inviting to User A's team)...");
  const res5 = await fetch(`${API_URL}/teams/${teamId}/invitations`, {
    method: "POST",
    headers: {
      ...HEADERS,
      "x-created-by": "attacker-user" // Different user
    },
    body: JSON.stringify({ email: "victim@test.com" })
  });
  assert.strictEqual(res5.status, 403, "Should return 403 for unauthorized invitation attempt");
  const data5 = await res5.json();
  assert.strictEqual(data5.error, "forbidden");

  // 6. Feature: Team Dashboard
  console.log("Test 6: Team Dashboard (Metadata, Members, Stats)...");
  const res6 = await fetch(`${API_URL}/teams/${teamId}`, {
    method: "GET",
    headers: HEADERS
  });
  assert.strictEqual(res6.status, 200);
  const data6 = await res6.json();
  assert.strictEqual(data6.id, teamId);
  assert.ok(data6.members.length > 0, "Team should have at least one member");
  assert.strictEqual(data6.members[0].user_id, HEADERS["x-created-by"]);
  assert.ok(data6.stats && typeof data6.stats.total_links === "number", "Stats should contain total_links");

  // Setup: Create a Link for Feature Tests
  const setupRes = await fetch(`${API_URL}/links`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ long_url: "https://google.com" })
  });
  const { id: linkId } = await setupRes.json();

  // 7. Feature: Comment Threads
  console.log("Test 7: Comment Threads (Create, Fetch)...");
  const res7a = await fetch(`${API_URL}/links/${linkId}/comments`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "Parallel build test comment" })
  });
  assert.strictEqual(res7a.status, 201);

  const res7b = await fetch(`${API_URL}/links/${linkId}/comments`, {
    method: "GET",
    headers: HEADERS
  });
  const data7b = await res7b.json();
  assert.ok(data7b.length > 0, "Should have at least one comment");
  assert.strictEqual(data7b[0].content, "Parallel build test comment");

  // Setup: Successful Invitation for Activity
  console.log("Inviting a member to trigger activity...");
  await fetch(`${API_URL}/teams/${teamId}/invitations`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ email: "success@test.com" })
  });

  // 8. Feature: Activity Feed
  console.log("Test 8: Activity Feed (Audit Logging)...");
  const res8 = await fetch(`${API_URL}/teams/${teamId}/activity`, {
    method: "GET",
    headers: HEADERS
  });
  assert.strictEqual(res8.status, 200);
  const data8 = await res8.json();
  assert.ok(data8.length >= 2, "Should have at least 2 events (LINK_CREATED, MEMBER_INVITED)");
  const types = data8.map(e => e.type);
  assert.ok(types.includes("LINK_CREATED"), "Activity feed should include link creation");
  assert.ok(types.includes("MEMBER_INVITED"), "Activity feed should include member invitation");

  console.log("✅ All tests passed (Parallel Build Verified!)");
}

testTeams().catch(err => {
  console.error("❌ Test Failed:", err.message);
  process.exit(1);
});
