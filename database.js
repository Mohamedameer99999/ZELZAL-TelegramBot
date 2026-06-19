const Database = require('better-sqlite3');
const path = require('path');
const config = require('./config');

const DB_FILE = config.db_path || path.join(__dirname, 'zelzal.db');
let db;

function init() {
  db = new Database(DB_FILE, { /* verbose: console.log */ });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createTables();
  migrateSettings();
  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      first_name TEXT,
      username TEXT,
      joined_at TEXT,
      last_seen TEXT,
      msgs INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT UNIQUE NOT NULL,
      hmac_signature TEXT,
      telegram_id INTEGER,
      customer_name TEXT,
      phone TEXT,
      email TEXT,
      product TEXT NOT NULL,
      plan_type TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      expires_at TEXT,
      activated_at TEXT,
      payment_date TEXT,
      notes TEXT,
      FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      plan_type TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      current_period_start TEXT NOT NULL,
      current_period_end TEXT NOT NULL,
      auto_renew INTEGER DEFAULT 1,
      payment_method TEXT DEFAULT 'vodafone_cash',
      last_payment_ref TEXT,
      cancelled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(telegram_id)
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER,
      user_id INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'EGP',
      payment_method TEXT NOT NULL,
      payment_ref TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      phone TEXT,
      notes TEXT,
      processed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
      FOREIGN KEY (user_id) REFERENCES users(telegram_id)
    );
    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      discount_percent INTEGER NOT NULL,
      product TEXT,
      max_uses INTEGER DEFAULT 1,
      used_count INTEGER DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      result TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      notified INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS affiliates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      code TEXT UNIQUE NOT NULL,
      total_earned REAL DEFAULT 0,
      total_paid REAL DEFAULT 0,
      referral_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(telegram_id)
    );
    CREATE TABLE IF NOT EXISTS affiliate_commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      affiliate_id INTEGER NOT NULL,
      referred_user_id INTEGER,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      source TEXT DEFAULT 'purchase',
      created_at TEXT NOT NULL,
      paid_at TEXT,
      FOREIGN KEY (affiliate_id) REFERENCES affiliates(id),
      FOREIGN KEY (referred_user_id) REFERENCES users(telegram_id)
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      priority TEXT DEFAULT 'normal',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(telegram_id)
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      message TEXT NOT NULL,
      read_status INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id),
      FOREIGN KEY (sender_id) REFERENCES users(telegram_id)
    );
  `);
}

function migrateSettings() {
  const count = db.prepare('SELECT COUNT(*) as c FROM settings').get().c;
  if (count === 0) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('schema_version', '1');
  }
}

function get() {
  if (!db) init();
  return db;
}

// ─── Users ───

function trackUser(msg) {
  const dbc = get();
  const uid = msg.from.id;
  const existing = dbc.prepare('SELECT * FROM users WHERE telegram_id = ?').get(uid);
  if (existing) {
    dbc.prepare('UPDATE users SET last_seen = ?, msgs = msgs + 1, username = ?, first_name = ? WHERE telegram_id = ?')
      .run(new Date().toISOString(), msg.from.username || '', msg.from.first_name || '', uid);
  } else {
    dbc.prepare('INSERT INTO users (telegram_id, first_name, username, joined_at, last_seen, msgs) VALUES (?, ?, ?, ?, ?, 1)')
      .run(uid, msg.from.first_name || '', msg.from.username || '', new Date().toISOString(), new Date().toISOString());
  }
}

function getUser(telegramId) {
  return get().prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

function getAllUsers() {
  return get().prepare('SELECT * FROM users ORDER BY joined_at DESC').all();
}

function getUserCount() {
  return get().prepare('SELECT COUNT(*) as c FROM users').get().c;
}

function getTodayUsers() {
  const today = new Date().toISOString().split('T')[0];
  return get().prepare("SELECT COUNT(*) as c FROM users WHERE last_seen LIKE ?").get(`${today}%`).c;
}

// ─── Licenses ───

function addLicense(data) {
  const dbc = get();
  dbc.prepare(`INSERT INTO licenses (license_key, hmac_signature, telegram_id, customer_name, phone, email, product, plan_type, status, created_at, expires_at, activated_at, payment_date, notes)
    VALUES (@license_key, @hmac_signature, @telegram_id, @customer_name, @phone, @email, @product, @plan_type, @status, @created_at, @expires_at, @activated_at, @payment_date, @notes)`)
    .run(data);
  return data;
}

function getLicense(key) {
  return get().prepare('SELECT * FROM licenses WHERE license_key = ?').get(key);
}

function getLicensesByUser(telegramId) {
  return get().prepare('SELECT * FROM licenses WHERE telegram_id = ? ORDER BY created_at DESC').all(telegramId);
}

function getAllLicenses() {
  return get().prepare('SELECT * FROM licenses ORDER BY created_at DESC').all();
}

function getActiveLicenses() {
  return get().prepare("SELECT * FROM licenses WHERE status = 'active' ORDER BY created_at DESC").all();
}

function updateLicenseStatus(key, status) {
  get().prepare('UPDATE licenses SET status = ? WHERE license_key = ?').run(status, key);
}

function getLicenseCount() {
  return get().prepare('SELECT COUNT(*) as c FROM licenses').get().c;
}

function getActiveLicenseCount() {
  return get().prepare("SELECT COUNT(*) as c FROM licenses WHERE status = 'active'").get().c;
}

function getExpiringLicenses(days = 7) {
  const future = new Date(Date.now() + days * 86400000).toISOString().split('T')[0].replace(/-/g, '');
  return get().prepare("SELECT * FROM licenses WHERE status = 'active' AND expires_at <= ?").all(future);
}

// ─── Subscriptions ───

function addSubscription(data) {
  const dbc = get();
  dbc.prepare(`INSERT INTO subscriptions (user_id, product_id, plan_type, status, current_period_start, current_period_end, auto_renew, payment_method, last_payment_ref, created_at, updated_at)
    VALUES (@user_id, @product_id, @plan_type, @status, @current_period_start, @current_period_end, @auto_renew, @payment_method, @last_payment_ref, @created_at, @updated_at)`)
    .run(data);
  return dbc.prepare('SELECT last_insert_rowid() as id').get().id;
}

function getSubscription(id) {
  return get().prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
}

function getSubscriptionsByUser(userId) {
  return get().prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function getActiveSubscriptions() {
  return get().prepare("SELECT * FROM subscriptions WHERE status = 'active' ORDER BY created_at DESC").all();
}

function updateSubscriptionStatus(id, status) {
  get().prepare('UPDATE subscriptions SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
}

function updateSubscriptionPeriod(id, periodStart, periodEnd, paymentRef) {
  get().prepare('UPDATE subscriptions SET current_period_start = ?, current_period_end = ?, last_payment_ref = ?, updated_at = ? WHERE id = ?')
    .run(periodStart, periodEnd, paymentRef, new Date().toISOString(), id);
}

function cancelSubscription(id) {
  get().prepare('UPDATE subscriptions SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ?')
    .run('cancelled', new Date().toISOString(), new Date().toISOString(), id);
}

function getExpiringSubscriptions(days = 3) {
  const future = new Date(Date.now() + days * 86400000).toISOString();
  return get().prepare("SELECT * FROM subscriptions WHERE status = 'active' AND current_period_end IS NOT NULL AND current_period_end <= ?").all(future);
}

// ─── Payments ───

function addPayment(data) {
  const dbc = get();
  dbc.prepare(`INSERT INTO payments (subscription_id, user_id, product_id, amount, currency, payment_method, payment_ref, status, phone, notes, created_at)
    VALUES (@subscription_id, @user_id, @product_id, @amount, @currency, @payment_method, @payment_ref, @status, @phone, @notes, @created_at)`)
    .run(data);
  return dbc.prepare('SELECT last_insert_rowid() as id').get().id;
}

function getPayment(ref) {
  return get().prepare('SELECT * FROM payments WHERE payment_ref = ?').get(ref);
}

function updatePaymentStatus(ref, status, processedAt) {
  get().prepare('UPDATE payments SET status = ?, processed_at = ? WHERE payment_ref = ?').run(status, processedAt, ref);
}

function getPaymentsByUser(userId) {
  return get().prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

// ─── Coupons ───

function addCoupon(data) {
  get().prepare(`INSERT INTO coupons (code, discount_percent, product, max_uses, used_count, expires_at, created_at)
    VALUES (@code, @discount_percent, @product, @max_uses, 0, @expires_at, @created_at)`)
    .run(data);
  return data;
}

function getCoupon(code) {
  return get().prepare('SELECT * FROM coupons WHERE code = ?').get(code);
}

function getAllCoupons() {
  return get().prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
}

function useCoupon(code) {
  get().prepare('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?').run(code);
}

function deleteCoupon(code) {
  get().prepare('DELETE FROM coupons WHERE code = ?').run(code);
}

function isValidCoupon(code, product) {
  const c = getCoupon(code);
  if (!c) return { valid: false, reason: 'الكود غير موجود' };
  if (c.expires_at && new Date(c.expires_at) < new Date()) return { valid: false, reason: 'الكود منتهي الصلاحية' };
  if (c.used_count >= c.max_uses) return { valid: false, reason: 'الكود استنفذ الاستخدامات القصوى' };
  if (c.product && c.product !== product && c.product !== '*') return { valid: false, reason: 'الكود غير صالح لهذا المنتج' };
  return { valid: true, discount: c.discount_percent, coupon: c };
}

// ─── Commands (pending-commands / command-results) ───

function addCommand(task) {
  const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  get().prepare('INSERT INTO commands (id, task, status, created_at) VALUES (?, ?, ?, ?)')
    .run(id, task, 'pending', new Date().toISOString());
  return id;
}

function getPendingCommands() {
  return get().prepare("SELECT * FROM commands WHERE status = 'pending' ORDER BY created_at ASC").all();
}

function getUnnotifiedResults() {
  return get().prepare("SELECT * FROM commands WHERE status = 'done' AND notified = 0 ORDER BY created_at ASC").all();
}

function markCommandDone(id, result) {
  get().prepare('UPDATE commands SET status = ?, result = ?, completed_at = ? WHERE id = ?')
    .run('done', result, new Date().toISOString(), id);
}

function markNotified(id) {
  get().prepare('UPDATE commands SET notified = 1 WHERE id = ?').run(id);
}

function getAllCommands() {
  return get().prepare('SELECT * FROM commands ORDER BY created_at DESC LIMIT 50').all();
}

function getChatHistory(limit = 10) {
  return get().prepare("SELECT task, result, created_at FROM commands WHERE result IS NOT NULL AND status='done' ORDER BY created_at DESC LIMIT ?").all(limit);
}

// ─── Affiliates ───

function createAffiliate(userId, code) {
  const dbc = get();
  dbc.prepare('INSERT INTO affiliates (user_id, code, created_at) VALUES (?, ?, ?)').run(userId, code, new Date().toISOString());
  return dbc.prepare('SELECT * FROM affiliates WHERE user_id = ?').get(userId);
}

function getAffiliate(userId) {
  return get().prepare('SELECT * FROM affiliates WHERE user_id = ?').get(userId);
}

function getAffiliateByCode(code) {
  return get().prepare('SELECT * FROM affiliates WHERE code = ?').get(code);
}

function getAllAffiliates() {
  return get().prepare('SELECT a.*, u.first_name, u.username FROM affiliates a LEFT JOIN users u ON a.user_id = u.telegram_id ORDER BY a.total_earned DESC').all();
}

function addCommission(affiliateId, referredUserId, amount) {
  const dbc = get();
  dbc.prepare('INSERT INTO affiliate_commissions (affiliate_id, referred_user_id, amount, created_at) VALUES (?, ?, ?, ?)').run(affiliateId, referredUserId, amount, new Date().toISOString());
  dbc.prepare('UPDATE affiliates SET total_earned = total_earned + ?, referral_count = referral_count + 1 WHERE id = ?').run(amount, affiliateId);
}

function getCommissions(affiliateId, status) {
  if (status) return get().prepare('SELECT * FROM affiliate_commissions WHERE affiliate_id = ? AND status = ? ORDER BY created_at DESC').all(affiliateId, status);
  return get().prepare('SELECT * FROM affiliate_commissions WHERE affiliate_id = ? ORDER BY created_at DESC').all(affiliateId);
}

function getAllCommissions(status) {
  if (status) return get().prepare('SELECT * FROM affiliate_commissions WHERE status = ? ORDER BY created_at DESC').all(status);
  return get().prepare('SELECT * FROM affiliate_commissions ORDER BY created_at DESC').all();
}

function markCommissionPaid(commissionId) {
  const dbc = get();
  dbc.prepare('UPDATE affiliate_commissions SET status = ?, paid_at = ? WHERE id = ?').run('paid', new Date().toISOString(), commissionId);
  const comm = dbc.prepare('SELECT affiliate_id, amount FROM affiliate_commissions WHERE id = ?').get(commissionId);
  if (comm) dbc.prepare('UPDATE affiliates SET total_paid = total_paid + ? WHERE id = ?').run(comm.amount, comm.affiliate_id);
}

function getAffiliateStats() {
  const dbc = get();
  const total = dbc.prepare('SELECT COUNT(*) as c FROM affiliates').get().c;
  const totalCommissions = dbc.prepare('SELECT COALESCE(SUM(amount),0) as s FROM affiliate_commissions').get().s;
  const pendingCommissions = dbc.prepare("SELECT COALESCE(SUM(amount),0) as s FROM affiliate_commissions WHERE status='pending'").get().s;
  const paidCommissions = dbc.prepare("SELECT COALESCE(SUM(amount),0) as s FROM affiliate_commissions WHERE status='paid'").get().s;
  return { total, totalCommissions, pendingCommissions, paidCommissions };
}

// ─── Tickets ───

function createTicket(userId, subject, message) {
  const dbc = get();
  const now = new Date().toISOString();
  const result = dbc.prepare('INSERT INTO tickets (user_id, subject, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(userId, subject, 'open', now, now);
  const ticketId = result.lastInsertRowid;
  dbc.prepare('INSERT INTO ticket_messages (ticket_id, sender_id, message, is_admin, created_at) VALUES (?, ?, ?, 0, ?)').run(ticketId, userId, message, now);
  return { id: ticketId, subject };
}

function getTicket(id) {
  return get().prepare('SELECT * FROM tickets WHERE id = ?').get(id);
}

function getTicketsByUser(userId, status) {
  if (status) return get().prepare('SELECT * FROM tickets WHERE user_id = ? AND status = ? ORDER BY created_at DESC').all(userId, status);
  return get().prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function getAllTickets(status) {
  if (status) return get().prepare('SELECT t.*, u.first_name, u.username FROM tickets t LEFT JOIN users u ON t.user_id = u.telegram_id WHERE t.status = ? ORDER BY t.updated_at DESC').all(status);
  return get().prepare('SELECT t.*, u.first_name, u.username FROM tickets t LEFT JOIN users u ON t.user_id = u.telegram_id ORDER BY t.updated_at DESC').all();
}

function addTicketMessage(ticketId, senderId, message, isAdmin) {
  const dbc = get();
  dbc.prepare('INSERT INTO ticket_messages (ticket_id, sender_id, message, is_admin, created_at) VALUES (?, ?, ?, ?, ?)').run(ticketId, senderId, isAdmin ? 1 : 0, message, new Date().toISOString());
  dbc.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(isAdmin ? 'pending' : 'open', new Date().toISOString(), ticketId);
}

function getTicketMessages(ticketId) {
  return get().prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(ticketId);
}

function updateTicketStatus(id, status) {
  const now = new Date().toISOString();
  if (status === 'closed') get().prepare('UPDATE tickets SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?').run(status, now, now, id);
  else get().prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
}

function getTicketStats() {
  const dbc = get();
  const open = dbc.prepare("SELECT COUNT(*) as c FROM tickets WHERE status='open'").get().c;
  const pending = dbc.prepare("SELECT COUNT(*) as c FROM tickets WHERE status='pending'").get().c;
  const closed = dbc.prepare("SELECT COUNT(*) as c FROM tickets WHERE status='closed'").get().c;
  const total = dbc.prepare('SELECT COUNT(*) as c FROM tickets').get().c;
  return { open, pending, closed, total };
}

// ─── Contacts ───

function saveContact(data) {
  const dbc = get();
  dbc.prepare('INSERT INTO contacts (name, phone, message, created_at) VALUES (?, ?, ?, ?)').run(data.name, data.phone || '', data.message, new Date().toISOString());
  return dbc.prepare('SELECT last_insert_rowid() as id').get().id;
}

function getContacts(limit = 50) {
  return get().prepare('SELECT * FROM contacts ORDER BY created_at DESC LIMIT ?').all(limit);
}

function getUnreadContactCount() {
  return get().prepare("SELECT COUNT(*) as c FROM contacts WHERE read_status = 0").get().c;
}

function markContactRead(id) {
  get().prepare('UPDATE contacts SET read_status = 1 WHERE id = ?').run(id);
}

// ─── Enhanced Stats ───

function getRevenueStats(period) {
  const dbc = get();
  let dateFilter;
  if (period === 'today') dateFilter = new Date().toISOString().split('T')[0];
  else if (period === 'week') dateFilter = new Date(Date.now() - 7 * 86400000).toISOString();
  else if (period === 'month') dateFilter = new Date(Date.now() - 30 * 86400000).toISOString();
  else dateFilter = new Date(0).toISOString();
  const payments = dbc.prepare("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM payments WHERE status='completed' AND processed_at >= ?").get(dateFilter);
  const newUsers = dbc.prepare('SELECT COUNT(*) as c FROM users WHERE joined_at >= ?').get(dateFilter).c;
  const newLicenses = dbc.prepare('SELECT COUNT(*) as c FROM licenses WHERE created_at >= ?').get(dateFilter).c;
  return { revenue: payments.total, paymentCount: payments.count, newUsers, newLicenses };
}

function getSalesByProduct() {
  return get().prepare("SELECT product, COUNT(*) as count FROM licenses GROUP BY product ORDER BY count DESC").all();
}

function getMonthlyRevenue() {
  return get().prepare("SELECT strftime('%Y-%m', processed_at) as month, SUM(amount) as revenue, COUNT(*) as count FROM payments WHERE status='completed' GROUP BY month ORDER BY month DESC LIMIT 12").all();
}

// ─── Stats ───

function getDashboardStats() {
  const dbc = get();
  const users = getUserCount();
  const activeUsers = getTodayUsers();
  const licenses = getLicenseCount();
  const activeLicenses = getActiveLicenseCount();
  const products = require('./products.json');
  const mainCount = products.filter(p => p.type === 'main').length;
  const toolCount = products.filter(p => p.type === 'tool').length;
  const monthly = dbc.prepare("SELECT COUNT(*) as c FROM licenses WHERE plan_type = 'monthly'").get().c;
  const yearly = dbc.prepare("SELECT COUNT(*) as c FROM licenses WHERE plan_type = 'yearly'").get().c;
  const lifetime = dbc.prepare("SELECT COUNT(*) as c FROM licenses WHERE plan_type = 'lifetime'").get().c;
  const revoked = dbc.prepare("SELECT COUNT(*) as c FROM licenses WHERE status = 'revoked'").get().c;
  const expired = dbc.prepare("SELECT COUNT(*) as c FROM licenses WHERE status = 'expired'").get().c;
  return { users, activeUsers, licenses, activeLicenses, mainCount, toolCount, monthly, yearly, lifetime, revoked, expired };
}

function close() {
  if (db) db.close();
}

module.exports = {
  init, get, close,
  trackUser, getUser, getAllUsers, getUserCount, getTodayUsers,
  addLicense, getLicense, getLicensesByUser, getAllLicenses, getActiveLicenses,
  updateLicenseStatus, getLicenseCount, getActiveLicenseCount, getExpiringLicenses,
  // Subscriptions
  addSubscription, getSubscription, getSubscriptionsByUser, getActiveSubscriptions,
  updateSubscriptionStatus, updateSubscriptionPeriod, cancelSubscription, getExpiringSubscriptions,
  // Payments
  addPayment, getPayment, updatePaymentStatus, getPaymentsByUser,
  // Coupons
  addCoupon, getCoupon, getAllCoupons, useCoupon, deleteCoupon, isValidCoupon,
  // Commands
  addCommand, getPendingCommands, getUnnotifiedResults, markCommandDone, markNotified, getAllCommands, getChatHistory,
  // Affiliates
  createAffiliate, getAffiliate, getAffiliateByCode, getAllAffiliates,
  addCommission, getCommissions, getAllCommissions, markCommissionPaid, getAffiliateStats,
  // Tickets
  createTicket, getTicket, getTicketsByUser, getAllTickets,
  addTicketMessage, getTicketMessages, updateTicketStatus, getTicketStats,
  // Enhanced Stats
  getRevenueStats, getSalesByProduct, getMonthlyRevenue,
  getDashboardStats,
  saveContact, getContacts, getUnreadContactCount, markContactRead,
};
