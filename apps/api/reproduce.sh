#!/bin/bash
TOKEN_A=$(npx tsx -e "import jwt from 'jsonwebtoken'; console.log(jwt.sign({ id: 'user-a', tenantId: 'tenant-a' }, 'default-secret-for-dev-only'))")
TOKEN_B=$(npx tsx -e "import jwt from 'jsonwebtoken'; console.log(jwt.sign({ id: 'user-b', tenantId: 'tenant-b' }, 'default-secret-for-dev-only'))")

echo "--- Test 1: FTS Syntax Crash ---"
curl -s -i -H "Authorization: Bearer $TOKEN_A" "http://localhost:3000/links/search?q='" | grep "HTTP/1.1 200" && echo "FIXED (Success)" || echo "STILL CRASHED"

echo "--- Test 2: IDOR via extra query param ---"
curl -s -H "Authorization: Bearer $TOKEN_A" "http://localhost:3000/links/search?tenantId=tenant-b" | jq .data

echo "--- Test 3: Pagination Capping ---"
curl -s -H "Authorization: Bearer $TOKEN_A" "http://localhost:3000/links/search?page_size=1000" | jq .pagination.page_size
