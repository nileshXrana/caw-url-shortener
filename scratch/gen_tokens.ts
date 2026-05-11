import jwt from "jsonwebtoken";

const secret = "default-secret-for-dev-only";

const tokenA = jwt.sign({ sub: "user-a", tenantId: "tenant-1" }, secret);
const tokenB = jwt.sign({ sub: "user-b", tenantId: "tenant-1" }, secret);

console.log(`TOKEN_A=${tokenA}`);
console.log(`TOKEN_B=${tokenB}`);
