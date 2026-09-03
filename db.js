import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 强制使用项目根目录 data.db（忽略 TRAE 注入的无效 DB_PATH）
const DB_PATH = path.join(__dirname, 'data.db');

let db;
try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
} catch (err) {
    console.error('❌ 致命错误: 数据库初始化失败:', err.message);
    process.exit(1);
}

// ===== 表结构初始化 =====
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        designer_id TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT, display_name TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_disabled INTEGER NOT NULL DEFAULT 0,
        gen_count INTEGER NOT NULL DEFAULT 0,
        last_gen_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        prompt TEXT, title TEXT, thumbnail TEXT,
        image_urls TEXT, doc_id TEXT, status TEXT, options TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        params TEXT NOT NULL DEFAULT '{}',
        result TEXT DEFAULT '{}',
        conversation TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        error TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);
    CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
`);

// 兼容旧数据库：幂等添加新列
const migrations = [
    "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN gen_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN last_gen_at TEXT",
];
for (const sql of migrations) {
    try { db.exec(sql); } catch (_) {}
}

const ADMIN_DESIGNER_ID = process.env.ADMIN_DESIGNER_ID || '';
export function ensureRootAdmin() {
    if (ADMIN_DESIGNER_ID) {
        const existing = getUserByDesignerId(ADMIN_DESIGNER_ID);
        if (existing && !existing.is_admin) {
            db.prepare('UPDATE users SET is_admin = 1 WHERE designer_id = ?').run(ADMIN_DESIGNER_ID);
            console.log(`已将 ${ADMIN_DESIGNER_ID} 提升为管理员`);
        }
    }
    const adminCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 1').get();
    return adminCount && adminCount.c > 0;
}

export function shouldFirstUserBeAdmin() {
    const count = db.prepare('SELECT COUNT(*) as c FROM users').get();
    return count && count.c === 0;
}

// ===== Token =====
export function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ===== 用户 CRUD =====
export function createUser({ designer_id, password_hash, email, display_name }) {
    const info = db.prepare('INSERT INTO users (designer_id, password_hash, email, display_name) VALUES (?, ?, ?, ?)')
        .run(designer_id, password_hash, email || null, display_name || null);
    return getUserById(info.lastInsertRowid);
}

export function getUserByDesignerId(designer_id) {
    return db.prepare('SELECT * FROM users WHERE designer_id = ?').get(designer_id);
}

export function getUserById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// ===== 会话 CRUD =====
const SESSION_TTL_HOURS = 72;

export function createSession(user_id) {
    const token = generateSessionToken();
    const expires_at = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user_id, expires_at);
    return { token, expires_at };
}

export function getSession(token) {
    if (!token) return null;
    const session = db.prepare('SELECT s.*, u.designer_id, u.display_name, u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?').get(token);
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) { deleteSession(token); return null; }
    return session;
}

export function deleteSession(token) {
    if (!token) return;
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function cleanExpiredSessions() {
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

// ===== 历史记录 CRUD =====
export function incrementGenCount(user_id) {
    if (!user_id) return 0;
    db.prepare('UPDATE users SET gen_count = gen_count + 1, last_gen_at = datetime(\'now\') WHERE id = ?').run(user_id);
    const row = db.prepare('SELECT gen_count FROM users WHERE id = ?').get(user_id);
    return row ? row.gen_count : 0;
}

export function addHistory(user_id, entry) {
    const id = entry.id || 'pc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    db.prepare('INSERT INTO history (id, user_id, prompt, title, thumbnail, image_urls, doc_id, status, options) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, user_id, entry.prompt || null, entry.title || null, entry.thumbnail || null,
            JSON.stringify(entry.imageUrls || []), entry.docId || null, entry.status || 'completed',
            JSON.stringify(entry.options || {}));
    incrementGenCount(user_id);
    return getHistoryById(user_id, id);
}

export function getHistoryList(user_id, limit = 50) {
    const rows = db.prepare('SELECT * FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(user_id, limit);
    return rows.map(parseHistoryRow);
}

export function getHistoryById(user_id, id) {
    const row = db.prepare('SELECT * FROM history WHERE id = ? AND user_id = ?').get(id, user_id);
    return row ? parseHistoryRow(row) : null;
}

export function deleteHistory(user_id, id) {
    const info = db.prepare('DELETE FROM history WHERE id = ? AND user_id = ?').run(id, user_id);
    return info.changes > 0;
}

export function clearHistory(user_id) {
    const info = db.prepare('DELETE FROM history WHERE user_id = ?').run(user_id);
    return info.changes;
}

function parseHistoryRow(row) {
    return {
        id: row.id,
        prompt: row.prompt,
        title: row.title,
        thumbnail: row.thumbnail,
        imageUrls: safeParse(row.image_urls, []),
        docId: row.doc_id,
        status: row.status,
        options: safeParse(row.options, {}),
        createdAt: row.created_at
    };
}

function safeParse(str, fallback) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch (_) { return fallback; }
}

// ===== 任务 CRUD =====
export function createTask(user_id, { name, params }) {
    const id = 'km_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    db.prepare('INSERT INTO tasks (id, user_id, name, status, params) VALUES (?, ?, ?, ?, ?)')
        .run(id, user_id, name, 'queued', JSON.stringify(params || {}));
    return getTaskById(user_id, id);
}

export function getTaskById(user_id, id) {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, user_id);
    return row ? parseTaskRow(row) : null;
}

function getTaskRaw(id) {
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

export function listTasks(user_id) {
    const rows = db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC').all(user_id);
    return rows.map(parseTaskRow);
}

export function updateTask(id, fields) {
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        sets.push(`${k} = ?`);
        vals.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
    }
    if (sets.length === 0) return getTaskRaw(id);
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    return getTaskRaw(id);
}

export function deleteTask(user_id, id) {
    const info = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(id, user_id);
    return info.changes > 0;
}

export function clearTasks(user_id) {
    const info = db.prepare('DELETE FROM tasks WHERE user_id = ?').run(user_id);
    return info.changes;
}

export function countProcessingTasks(user_id) {
    const row = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE user_id = ? AND status = 'processing'").get(user_id);
    return row.c;
}

function parseTaskRow(row) {
    return {
        id: row.id,
        name: row.name,
        status: row.status,
        params: safeParse(row.params, {}),
        result: safeParse(row.result, {}),
        conversation: safeParse(row.conversation, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        error: row.error
    };
}

// ===== 管理员 CRUD =====
export function listUsers() {
    return db.prepare('SELECT id, designer_id, email, display_name, is_admin, is_disabled, gen_count, last_gen_at, created_at FROM users ORDER BY created_at DESC').all();
}

export function getUserStats() {
    const q = (sql) => db.prepare(sql).get();
    return {
        totalUsers: q('SELECT COUNT(*) as c FROM users').c,
        adminCount: q('SELECT COUNT(*) as c FROM users WHERE is_admin = 1').c,
        disabledCount: q('SELECT COUNT(*) as c FROM users WHERE is_disabled = 1').c,
        newToday: q("SELECT COUNT(*) as c FROM users WHERE created_at >= date('now')").c,
        totalHistory: q('SELECT COUNT(*) as c FROM history').c,
        totalGenerations: q('SELECT COALESCE(SUM(gen_count), 0) as c FROM users').c,
        todayGenerations: q("SELECT COUNT(*) as c FROM history WHERE created_at >= date('now')").c,
        neverUsed: q("SELECT COUNT(*) as c FROM users WHERE COALESCE(gen_count, 0) = 0").c,
    };
}

function toggleUserField(userId, field) {
    const user = getUserById(userId);
    if (!user) throw new Error('用户不存在');
    const newStatus = user[field] ? 0 : 1;
    db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(newStatus, userId);
    // 被禁用时清除该用户所有会话
    if (field === 'is_disabled' && newStatus === 1) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    }
    return { ...user, [field]: newStatus };
}

export function toggleAdmin(userId) { return toggleUserField(userId, 'is_admin'); }
export function toggleDisabled(userId) { return toggleUserField(userId, 'is_disabled'); }

export function resetUserPassword(userId, new_hash) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(new_hash, userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); // 强制重新登录
}

export function adminDeleteUser(userId) {
    clearHistory(userId);
    for (const table of ['sessions', 'tasks']) {
        db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
    const info = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return info.changes > 0;
}

export default db;
