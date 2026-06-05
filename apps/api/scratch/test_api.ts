import axios from 'axios';
import jwt from 'jsonwebtoken';

const API_URL = 'http://localhost:3000';
const JWT_SECRET = 'default-secret-for-dev-only-and-needs-to-be-32-chars-long';

const tokenA = jwt.sign({ id: 'user-a', tenantId: 'tenant-a' }, JWT_SECRET);

async function run() {
  try {
    console.log('Sending request to POST /links...');
    const postRes = await axios.post(
      `${API_URL}/links`, 
      { code: 'tenant-a_my_test_code', longUrl: 'https://google.com' }, 
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );
    console.log('POST /links response:', postRes.status, postRes.data);
  } catch (e: any) {
    console.error('POST /links error:', e.response?.status, e.response?.data);
  }

  try {
    console.log('Sending request to GET /r/tenant-a_my_test_code...');
    const redRes = await axios.get(`${API_URL}/r/tenant-a_my_test_code`, { maxRedirects: 0 });
    console.log('GET /r/tenant-a_my_test_code response:', redRes.status, redRes.headers.location);
  } catch (e: any) {
    console.error('GET /r/tenant-a_my_test_code error:', e.response?.status || e.status, e.message);
  }
}

run();
