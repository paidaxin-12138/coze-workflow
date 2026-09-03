// EdgeOne Pages 部署 - Supabase 适配版数据库层
// 替代原 better-sqlite3 版本，兼容所有导出接口
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';
const supabase = SUPABASE_URL ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ===== 兼容 better-sqlite3 的 prepare API (占位，实际不可用) =====
class Statement {
    constructor(sql) { this.sql = sql; }
    run(...params) { throw new Error('Direct db.prepare().run() not supported in Supabase mode'); }
    get(...params) { throw new Error('Direct db.prepare().get() not supported in Supabase mode'); }
    all(...params) { throw new Error('Direct db.prepare().all() not supported in Supabase mode'); }
}

const db = {
    prepare: (sql) => new Statement(sql),
    exec: (sql) => { console.warn('[db.exec] ignored:', sql.slice(0, 60)); },
    pragma: () => {},
};

// 导出 supabase 客户端供路由文件直接使用
export { supabase };

// ===== 辅助函数 =====
function safeParse(str, fallback) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch (_) { return fallback; }
}

function parseHistoryRow(row) {
    return {
        id: row.id, prompt: row.prompt, title: row.title, thumbnail: row.thumbnail,
        imageUrls: safeParse(row.image_urls, []), docId: row.doc_id,
        status: row.status, options: safeParse(row.options, {}), createdAt: row.created_at,
    };
}

function parseTaskRow(row) {
    return {
        id: row.id, name: row.name, status: row.status,
        params: safeParse(row.params, {}), result: safeParse(row.result, {}),
        conversation: safeParse(row.conversation, {}),
        createdAt: row.created_at, updatedAt: row.updated_at, error: row.error,
    };
}

// ===== Token =====
export function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ===== 用户 CRUD =====
export async function createUser({ designer_id, password_hash, email, display_name }) {
    const { data, error } = await supabase.from('users').insert({
        designer_id, password_hash, email: email || null, display_name: display_name || null,
    }).select().single();
    if (error) throw error;
    return data;
}

export async function getUserByDesignerId(designer_id) {
    const { data } = await supabase.from('users').select('*').eq('designer_id', designer_id).single();
    return data || null;
}

export async function getUserById(id) {
    const { data } = await supabase.from('users').select('*').eq('id', id).single();
    return data || null;
}

// ===== 会话 CRUD =====
const SESSION_TTL_HOURS = 72;

export async function createSession(user_id) {
    const token = generateSessionToken();
    const expires_at = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
    const { error } = await supabase.from('sessions').insert({ token, user_id, expires_at });
    if (error) throw error;
    return { token, expires_at };
}

export async function getSession(token) {
    if (!token) return null;
    const { data: session } = await supabase.from('sessions').select('*, users!inner(designer_id, display_name, email)').eq('token', token).single();
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) { await deleteSession(token); return null; }
    return { ...session, designer_id: session.users?.designer_id, display_name: session.users?.display_name, email: session.users?.email };
}

export async function deleteSession(token) {
    if (!token) return;
    await supabase.from('sessions').delete().eq('token', token);
}

export async function cleanExpiredSessions() {
    await supabase.from('sessions').delete().lt('expires_at', new Date().toISOString());
}

// ===== 历史记录 CRUD =====
export async function incrementGenCount(user_id) {
    if (!user_id) return 0;
    const { data: user } = await supabase.from('users').select('gen_count').eq('id', user_id).single();
    const newCount = (user?.gen_count || 0) + 1;
    await supabase.from('users').update({ gen_count: newCount, last_gen_at: new Date().toISOString() }).eq('id', user_id);
    return newCount;
}

export async function addHistory(user_id, entry) {
    const id = entry.id || 'pc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const { error } = await supabase.from('history').insert({
        id, user_id, prompt: entry.prompt || null, title: entry.title || null,
        thumbnail: entry.thumbnail || null, image_urls: JSON.stringify(entry.imageUrls || []),
        doc_id: entry.docId || null, status: entry.status || 'completed',
        options: JSON.stringify(entry.options || {}),
    });
    if (error) throw error;
    await incrementGenCount(user_id);
    return getHistoryById(user_id, id);
}

export async function getHistoryList(user_id, limit = 50) {
    const { data } = await supabase.from('history').select('*').eq('user_id', user_id).order('created_at', { ascending: false }).limit(limit);
    return (data || []).map(parseHistoryRow);
}

export async function getHistoryById(user_id, id) {
    const { data } = await supabase.from('history').select('*').eq('id', id).eq('user_id', user_id).single();
    return data ? parseHistoryRow(data) : null;
}

export async function deleteHistory(user_id, id) {
    const { error } = await supabase.from('history').delete().eq('id', id).eq('user_id', user_id);
    return !error;
}

export async function clearHistory(user_id) {
    const { data } = await supabase.from('history').delete().eq('user_id', user_id).select('count');
    return data?.count || 0;
}

// ===== 任务 CRUD =====
export async function createTask(user_id, { name, params }) {
    const id = 'km_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const { error } = await supabase.from('tasks').insert({
        id, user_id, name, status: 'queued', params: JSON.stringify(params || {}),
    });
    if (error) throw error;
    return getTaskById(user_id, id);
}

export async function getTaskById(user_id, id) {
    const { data } = await supabase.from('tasks').select('*').eq('id', id).eq('user_id', user_id).single();
    return data ? parseTaskRow(data) : null;
}

export async function getTaskRaw(id) {
    const { data } = await supabase.from('tasks').select('*').eq('id', id).single();
    return data || null;
}

export async function listTasks(user_id) {
    const { data } = await supabase.from('tasks').select('*').eq('user_id', user_id).order('created_at', { ascending: false });
    return (data || []).map(parseTaskRow);
}

export async function updateTask(id, fields) {
    const updateData = {};
    for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        updateData[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    }
    updateData.updated_at = new Date().toISOString();
    await supabase.from('tasks').update(updateData).eq('id', id);
    return getTaskRaw(id);
}

export async function deleteTask(user_id, id) {
    const { error } = await supabase.from('tasks').delete().eq('id', id).eq('user_id', user_id);
    return !error;
}

export async function countProcessingTasks(user_id) {
    const { count } = await supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('user_id', user_id).eq('status', 'processing');
    return count || 0;
}

// ===== 管理员 CRUD =====
export async function listUsers() {
    const { data } = await supabase.from('users').select('id, designer_id, email, display_name, is_admin, is_disabled, gen_count, last_gen_at, created_at').order('created_at', { ascending: false });
    return data || [];
}

export async function getUserStats() {
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: adminCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_admin', true);
    const { count: disabledCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_disabled', true);
    const today = new Date().toISOString().split('T')[0];
    const { count: newToday } = await supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', today);
    const { count: totalHistory } = await supabase.from('history').select('*', { count: 'exact', head: true });
    const { data: genData } = await supabase.from('users').select('gen_count');
    const totalGenerations = (genData || []).reduce((s, u) => s + (u.gen_count || 0), 0);
    const { count: todayGenerations } = await supabase.from('history').select('*', { count: 'exact', head: true }).gte('created_at', today);
    const { count: neverUsed } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('gen_count', 0);
    return { totalUsers: totalUsers || 0, adminCount: adminCount || 0, disabledCount: disabledCount || 0, newToday: newToday || 0, totalHistory: totalHistory || 0, totalGenerations, todayGenerations: todayGenerations || 0, neverUsed: neverUsed || 0 };
}

export async function toggleAdmin(userId) {
    const { data: user } = await supabase.from('users').select('is_admin').eq('id', userId).single();
    if (!user) throw new Error('用户不存在');
    const newStatus = !user.is_admin;
    await supabase.from('users').update({ is_admin: newStatus }).eq('id', userId);
    return newStatus;
}

export async function toggleDisabled(userId) {
    const { data: user } = await supabase.from('users').select('is_disabled').eq('id', userId).single();
    if (!user) throw new Error('用户不存在');
    const newStatus = !user.is_disabled;
    await supabase.from('users').update({ is_disabled: newStatus }).eq('id', userId);
    if (newStatus) await supabase.from('sessions').delete().eq('user_id', userId);
    return newStatus;
}

export async function resetUserPassword(userId, new_hash) {
    await supabase.from('users').update({ password_hash: new_hash }).eq('id', userId);
    await supabase.from('sessions').delete().eq('user_id', userId);
}

export async function adminDeleteUser(userId) {
    await supabase.from('history').delete().eq('user_id', userId);
    await supabase.from('sessions').delete().eq('user_id', userId);
    await supabase.from('tasks').delete().eq('user_id', userId);
    await supabase.from('users').delete().eq('id', userId);
}

// ===== 管理员初始化 =====
const ADMIN_DESIGNER_ID = process.env.ADMIN_DESIGNER_ID || '';

export async function ensureRootAdmin() {
    if (ADMIN_DESIGNER_ID) {
        const { data: existing } = await supabase.from('users').select('*').eq('designer_id', ADMIN_DESIGNER_ID).single();
        if (existing && !existing.is_admin) {
            await supabase.from('users').update({ is_admin: true }).eq('designer_id', ADMIN_DESIGNER_ID);
            console.log(`已将 ${ADMIN_DESIGNER_ID} 提升为管理员`);
        }
    }
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_admin', true);
    return (count || 0) > 0;
}

export async function shouldFirstUserBeAdmin() {
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
    return (count || 0) === 0;
}

export default db;