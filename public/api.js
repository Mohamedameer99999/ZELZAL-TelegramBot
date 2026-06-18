const API = {
  base: '',
  token: localStorage.getItem('admin_token') || '',

  setToken(t) { this.token = t; localStorage.setItem('admin_token', t); },
  clearToken() { this.token = ''; localStorage.removeItem('admin_token'); },
  hasToken() { return !!this.token; },

  headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    if (this.token) h['X-Auth-Token'] = this.token;
    return h;
  },

  async get(endpoint) {
    const r = await fetch(this.base + endpoint, { headers: this.headers() });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  async post(endpoint, body) {
    const r = await fetch(this.base + endpoint, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  async login(token) {
    const r = await this.get('/api/status');
    this.setToken(token);
    return r;
  },

  async getPublicStats() { return this.get('/api/public-stats'); },
  async verifyLicense(key) { return this.post('/api/verify-license', { license_key: key }); },
  async submitContact(data) { return this.post('/api/contact', data); },

  async getAdminStats() { return this.get('/api/admin/stats'); },
  async getAdminTickets(status) { return this.get('/api/admin/tickets' + (status ? '?status=' + status : '')); },
  async getAdminPayments(limit) { return this.get('/api/admin/payments' + (limit ? '?limit=' + limit : '')); },
  async getAdminAffiliates() { return this.get('/api/admin/affiliates'); },
  async getAdminContacts() { return this.get('/api/admin/contacts'); },
};
