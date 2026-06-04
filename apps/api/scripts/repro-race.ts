const BASE_URL = "http://localhost:3000";
const SHORT_CODE = process.env.SHORT_CODE ?? "tenant-a_race";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);

async function makeRequest() {
  const response = await fetch(`${BASE_URL}/r/${SHORT_CODE}`, {
    redirect: "manual",
  });

  return response.status;
}

async function main() {
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => makeRequest())
  );

  const redirects = results.filter((status) => status === 301 || status === 302).length;
  const errors = results.filter((status) => status === 500).length;

  console.log(`Results: ${redirects} redirects, ${errors} errors`);

  if (errors > 0) {
    console.log("BUG REPRODUCED: 500 errors under concurrent load");
    process.exitCode = 1;
    return;
  }

  console.log("No 500s under concurrent load");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
