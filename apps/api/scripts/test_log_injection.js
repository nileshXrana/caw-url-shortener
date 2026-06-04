const axios = require('axios');
const jwt = require('jsonwebtoken');

(async () => {
  const token = jwt.sign({ id: 'user-a', tenantId: 'tenant-a' }, 'default-secret-for-dev-only');
  const url = 'https://normal-url.com\n{"ts":"2025-01-15T15:42:03.500Z","level":"info","req_id":"r-102","msg":"admin login successful","user":"admin","ip":"10.0.0.1"}';
  try {
    const r = await axios.post('http://localhost:3000/links', { code: 'inj_test', longUrl: url }, { headers: { Authorization: `Bearer ${token}` } });
    console.log('created:', r.data.id);
  } catch (e) {
    console.error('create_err', e.response?.data || e.message);
  }

  try {
    const r2 = await axios.get('http://localhost:3000/links', { headers: { Authorization: `Bearer ${token}` } });
    console.log('links_count', r2.data.length);
    const found = r2.data.find(l => l.code === 'inj_test');
    console.log('found_longUrl:', found?.longUrl);
  } catch (e) {
    console.error('list_err', e.response?.data || e.message);
  }
})();
