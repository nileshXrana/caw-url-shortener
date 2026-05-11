import axios from 'axios';
import jwt from 'jsonwebtoken';

const API_URL = 'http://localhost:3000';
const JWT_SECRET = 'default-secret-for-dev-only';

const tokenA = jwt.sign({ id: 'user-a', tenantId: 'tenant-a' }, JWT_SECRET);
const tokenB = jwt.sign({ id: 'user-b', tenantId: 'tenant-b' }, JWT_SECRET);

async function run() {
  console.log('--- Seeding Data ---');
  try {
    await axios.post(`${API_URL}/links`, { code: 'a_link', longUrl: 'https://a.com' }, { headers: { Authorization: `Bearer ${tokenA}` } });
    await axios.post(`${API_URL}/links`, { code: 'b_link', longUrl: 'https://b.com' }, { headers: { Authorization: `Bearer ${tokenB}` } });
  } catch (e) {}

  console.log('--- Test 1: FTS Syntax Crash ---');
  try {
    const res = await axios.get(`${API_URL}/links/search?q='`, { headers: { Authorization: `Bearer ${tokenA}` } });
    console.log('FTS Search Success (Unexpected if vulnerable to crash):', res.status);
  } catch (e: any) {
    console.log('FTS Search Failed (Expected crash):', e.response?.status, e.response?.data);
  }

  console.log('--- Test 2: IDOR Attempt via Filter Mutation ---');
  try {
    // Attempting to bypass tenantId via OR injection if it were possible
    const res = await axios.get(`${API_URL}/links/search?q=a_link&tenantId=tenant-b`, { headers: { Authorization: `Bearer ${tokenA}` } });
    const hasOtherTenantLink = res.data.data.some((l: any) => l.tenantId === 'tenant-b');
    console.log('IDOR Attempt 1 result (Should be false):', hasOtherTenantLink);
  } catch (e: any) {
    console.log('IDOR Attempt 1 Failed:', e.response?.status);
  }

  console.log('--- Test 3: IDOR Attempt via Object Injection ---');
  try {
    // If Express parses query params into objects
    const res = await axios.get(`${API_URL}/links/search?where[tenantId]=tenant-b`, { headers: { Authorization: `Bearer ${tokenA}` } });
    const hasOtherTenantLink = res.data.data?.some((l: any) => l.tenantId === 'tenant-b');
    console.log('IDOR Attempt 2 result (Should be false):', hasOtherTenantLink);
  } catch (e: any) {
    console.log('IDOR Attempt 2 Failed:', e.response?.status);
  }
}

run();
