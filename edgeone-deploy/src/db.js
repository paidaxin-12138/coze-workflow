// 🚨 Supabase 数据库适配层
// 替代原 better-sqlite3 版本，用于 EdgeOne Pages 部署
// 使用前请先在 Supabase 创建项目并执行下面的 SQL 建表

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';

// 启动时校验 Supabase 配置，缺失/为空时报出明确错误，避免 createClient 静默 500
if (!SUPABASE_URL || !SUPABASE_KEY) {
    const missing = [];
    if (!SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!SUPABASE_KEY) missing.push('SUPABASE_ANON_KEY');
    console.error(`❌ 致命错误: 环境变量 ${missing.join(', ')} 未设置或为空，请检查 .env 文件`);
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ADMIN_DESIGNER_ID = process.env.ADMIN_DESIGNER_ID || '';

// ===== 建表 SQL（在 Supabase SQL Editor 中执行一次）=====
/*
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    designer_id TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT,
    display_name TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_disabled INTEGER NOT NULL DEFAULT 0,
    gen_count INTEGER NOT NULL DEFAULT 0,
    last_gen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt TEXT, title TEXT, thumbnail TEXT,
    image_urls TEXT, doc_id TEXT, status TEXT, options TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    params TEXT NOT NULL DEFAULT '{}',
    result TEXT DEFAULT '{}',
    conversation TEXT DEFAULT '{}',
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);
CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
*/

// ===== 工具函数 =====
function safeParse(str, fallback) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch (_) { return fallback; }
}

function formatUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        designer_id: user.designer_id,
        password_hash: user.password_hash,
        email: user.email,
        display_name: user.display_name,
        is_admin: !!user.is_admin,
        is_disabled: !!user.is_disabled,
        gen_count: user.gen_count || 0,
        last_gen_at: user.last_gen_at || null,
        created_at: user.created_at
    };
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

// ===== 管理员初始化 =====
export async function ensureRootAdmin() {
    if (ADMIN_DESIGNER_ID) {
        const { data: existing } = await supabase
            .from('users').select('*')
            .eq('designer_id', ADMIN_DESIGNER_ID)
            .single();
        if (existing && !existing.is_admin) {
            await supabase.from('users').update({ is_admin: 1 }).eq('designer_id', ADMIN_DESIGNER_ID);
        }
    }
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_admin', 1);
    return (count || 0) > 0;
}

export async function shouldFirstUserBeAdmin() {
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
    return (count || 0) === 0;
}

// ===== 用户 CRUD =====
export async function createUser({ designer_id, password_hash, email, display_name }) {
    const { data, error } = await supabase.from('users').insert({
        designer_id, password_hash, email: email || null, display_name: display_name || null
    }).select().single();
    if (error) throw error;
    return data;
}

export async function getUserByDesignerId(designer_id) {
    const { data } = await supabase.from('users').select('*').eq('designer_id', designer_id).maybeSingle();
    return data;
}

export async function getUserById(id) {
    const { data } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
    return data;
}

export async function updateUser(id, fields) {
    const { data } = await supabase.from('users').update(fields).eq('id', id).select().single();
    return data;
}

// ===== 会话 CRUD =====
const SESSION_TTL_HOURS = 72;

export async function createSession(user_id) {
    const token = generateSessionToken();
    const expires_at = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
    const { data, error } = await supabase.from('sessions').insert({
        token, user_id, expires_at
    }).select().single();
    if (error) throw error;
    return { token, expires_at };
}

export function generateSessionToken() {
    const chars = 'abcdef0123456789';
    let token = '';
    for (let i = 0; i < 64; i++) token += chars[Math.floor(Math.random() * chars.length)];
    return token;
}

export async function getSession(token) {
    if (!token) return null;
    const { data: session } = await supabase.from('sessions').select('*, users!inner(designer_id, display_name, email)').eq('token', token).maybeSingle();
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) {
        await supabase.from('sessions').delete().eq('token', token);
        return null;
    }
    return {
        ...session,
        designer_id: session.users?.designer_id,
        display_name: session.users?.display_name,
        email: session.users?.email
    };
}

export async function deleteSession(token) {
    if (!token) return;
    await supabase.from('sessions').delete().eq('token', token);
}

export async function deleteUserSessions(user_id) {
    await supabase.from('sessions').delete().eq('user_id', user_id);
}

export async function cleanExpiredSessions() {
    await supabase.from('sessions').delete().lt('expires_at', new Date().toISOString());
}

// ===== 历史记录 CRUD =====
export async function incrementGenCount(user_id) {
    const { data: user } = await supabase.from('users').select('gen_count').eq('id', user_id).single();
    const newCount = (user?.gen_count || 0) + 1;
    await supabase.from('users').update({
        gen_count: newCount,
        last_gen_at: new Date().toISOString()
    }).eq('id', user_id);
    return newCount;
}

export async function addHistory(user_id, entry) {
    const id = entry.id || 'pc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const { data, error } = await supabase.from('history').insert({
        id, user_id,
        prompt: entry.prompt || null,
        title: entry.title || null,
        thumbnail: entry.thumbnail || null,
        image_urls: JSON.stringify(entry.imageUrls || []),
        doc_id: entry.docId || null,
        status: entry.status || 'completed',
        options: JSON.stringify(entry.options || {})
    }).select().single();
    if (error) throw error;
    await incrementGenCount(user_id);
    return getHistoryById(user_id, id);
}

export async function getHistoryList(user_id, limit = 50) {
    const { data: rows } = await supabase.from('history').select('*').eq('user_id', user_id).order('created_at', { ascending: false }).limit(limit);
    return (rows || []).map(parseHistoryRow);
}

export async function getHistoryById(user_id, id) {
    const { data: row } = await supabase.from('history').select('*').eq('id', id).eq('user_id', user_id).maybeSingle();
    return row ? parseHistoryRow(row) : null;
}

export async function deleteHistory(user_id, id) {
    const { error } = await supabase.from('history').delete().eq('id', id).eq('user_id', user_id);
    return !error;
}

export async function clearHistory(user_id) {
    const { data } = await supabase.from('history').delete().eq('user_id', user_id).select();
    return data?.length || 0;
}

// ===== 任务 CRUD =====
export async function createTask(user_id, { name, params }) {
    const id = 'km_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    const { data, error } = await supabase.from('tasks').insert({
        id, user_id, name, status: 'queued', params: JSON.stringify(params || {})
    }).select().single();
    if (error) throw error;
    return parseTaskRow(data);
}

export async function getTaskById(user_id, id) {
    const { data: row } = await supabase.from('tasks').select('*').eq('id', id).eq('user_id', user_id).maybeSingle();
    return row ? parseTaskRow(row) : null;
}

export async function getTaskRaw(id) {
    const { data: row } = await supabase.from('tasks').select('*').eq('id', id).maybeSingle();
    return row;
}

export async function listTasks(user_id) {
    const { data: rows } = await supabase.from('tasks').select('*').eq('user_id', user_id).order('created_at', { ascending: false });
    return (rows || []).map(parseTaskRow);
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

export async function clearTasks(user_id) {
    const { count, error } = await supabase.from('tasks').delete().eq('user_id', user_id).select('count');
    if (error) throw error;
    return count || 0;
}

// 返回"正在生成/占用额度"的任务数：仅统计流转中的状态。
// 已就绪待用户确认的状态（spec_ready/preview_ready/multi_ready）不占额度，
// 避免生成完成但未点击"确认完毕"的任务长期占用并发配额导致新任务无法创建。
export async function countNonTerminalTasks(user_id) {
    const { count } = await supabase.from('tasks').select('*', { count: 'exact', head: true })
        .eq('user_id', user_id)
        .in('status', ['queued', 'processing', 'spec_confirming', 'generating_preview', 'generating_multi', 'waiting_confirm']);
    return count || 0;
}

// ===== 管理员 CRUD =====
export async function listUsers() {
    const { data } = await supabase.from('users').select('id, designer_id, email, display_name, is_admin, is_disabled, gen_count, last_gen_at, created_at').order('created_at', { ascending: false });
    return data || [];
}

export async function getUserStats() {
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: adminCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_admin', 1);
    const { count: disabledCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_disabled', 1);
    const { count: newToday } = await supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString());
    const { count: totalHistory } = await supabase.from('history').select('*', { count: 'exact', head: true });
    const { data: genSum } = await supabase.from('users').select('gen_count');
    const totalGenerations = (genSum || []).reduce((s, u) => s + (u.gen_count || 0), 0);
    const { count: todayGenerations } = await supabase.from('history').select('*', { count: 'exact', head: true }).gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString());
    const { count: neverUsed } = await supabase.from('users').select('*', { count: 'exact', head: true }).or('gen_count.is.null,gen_count.lte.0');

    return {
        totalUsers: totalUsers || 0,
        adminCount: adminCount || 0,
        disabledCount: disabledCount || 0,
        newToday: newToday || 0,
        totalHistory: totalHistory || 0,
        totalGenerations,
        todayGenerations: todayGenerations || 0,
        neverUsed: neverUsed || 0,
    };
}

export async function toggleAdmin(userId) {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    if (!user) throw new Error('用户不存在');
    const newStatus = user.is_admin ? 0 : 1;
    await supabase.from('users').update({ is_admin: newStatus }).eq('id', userId);
    return { ...user, is_admin: newStatus };
}

export async function toggleDisabled(userId) {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    if (!user) throw new Error('用户不存在');
    const newStatus = user.is_disabled ? 0 : 1;
    await supabase.from('users').update({ is_disabled: newStatus }).eq('id', userId);
    if (newStatus === 1) {
        await supabase.from('sessions').delete().eq('user_id', userId);
    }
    return { ...user, is_disabled: newStatus };
}

export async function resetUserPassword(userId, new_hash) {
    await supabase.from('users').update({ password_hash: new_hash }).eq('id', userId);
    await supabase.from('sessions').delete().eq('user_id', userId);
}

export async function adminDeleteUser(userId) {
    await supabase.from('sessions').delete().eq('user_id', userId);
    await supabase.from('tasks').delete().eq('user_id', userId);
    await supabase.from('history').delete().eq('user_id', userId);
    const { error } = await supabase.from('users').delete().eq('id', userId);
    return !error;
}

export default { supabase };