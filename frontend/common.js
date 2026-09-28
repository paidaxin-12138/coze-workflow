// =====================================================
// 共享工具函数（common.js）
// 供工坊页(studio.html 内的 script.js)与仿香页(copy.html)复用，减少重复、便于维护。
// 使用方必须在自身脚本之前引入本文件（<script src="common.js"></script>），
// 否则需在调用本文件函数之前加载完毕。
// =====================================================

// 获取当前登录 token（本地 localStorage 会话键与 script.js 一致）
function getAuthToken() {
    try {
        const s = JSON.parse(localStorage.getItem('pcs_user_session') || 'null');
        return (s && s.token) ? s.token : null;
    } catch (_) { return null; }
}

// API Base URL 解析（支持构建期注入 window.__API_BASE__）
function getAPIUrl() {
    return (typeof window !== 'undefined' && window.__API_BASE__) || '';
}

// HTML 转义（空值安全，避免显示 'null'/'undefined' 字样）
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// 通用 Toast 提示（自包含、无固定 DOM 依赖，任意页面可用）
function showToast(msg, type) {
    const existing = document.getElementById('kmToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'kmToast';
    toast.style.cssText = `
        position: fixed; top: 24px; right: 24px; z-index: 9999;
        display: flex; align-items: center; gap: 10px;
        padding: 14px 20px; border-radius: 8px;
        font-size: 14px; font-family: inherit;
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        opacity: 0; transform: translateY(-12px);
        transition: opacity 0.35s ease, transform 0.35s ease;
        max-width: 400px; word-break: break-word;
    `;
    const isSuccess = type === 'success';
    toast.style.background = isSuccess ? '#eaf5e6' : '#fef3e9';
    toast.style.color = isSuccess ? '#2d4a1e' : '#8a5d1a';
    toast.style.border = isSuccess ? '1px solid #b8d4a8' : '1px solid #f0cfb0';
    toast.innerHTML = `
        <span style="font-size:20px;flex-shrink:0;">${isSuccess ? '✅' : 'ℹ️'}</span>
        <span style="flex:1;">${escapeHtml(msg)}</span>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-12px)';
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// ===== 统一 401 处理：token 过期即回到登录页 =====
// 全局去重标志：多个请求同时 401 只触发一次跳转
let __authRedirecting = false;

function handleUnauthorized() {
    if (__authRedirecting) return;
    __authRedirecting = true;
    // 清除本地登录态；键与各页 SESSION_KEY 一致('pcs_user_session')
    try { localStorage.removeItem('pcs_user_session'); } catch (_) {}
    const page = window.location.pathname.split('/').filter(Boolean).pop() || 'index.html';
    const qs = window.location.search || '';
    const redirect = encodeURIComponent(page + qs);
    // replace：登录页替换过期页，回退键不会复活 401 页
    window.location.replace('login.html?redirect=' + redirect);
}

// ===== 账号隔离的本地历史存储 =====
// 历史数据按登录账号(user.id)隔离，避免同一浏览器多账号共享同一份历史记录。
// 读取时若带账号后缀的新 key 为空，自动把旧的全局 key 数据迁移到当前账号 key 下，老数据不丢。
function getLocalUid() {
    try {
        const s = JSON.parse(localStorage.getItem('pcs_user_session') || 'null');
        return (s && s.user && (s.user.id || s.user.designer_id)) || '';
    } catch (_) { return ''; }
}

function scopedKey(baseKey) {
    const uid = getLocalUid();
    return baseKey + (uid ? '_' + uid : '');
}

function loadScopedHistory(baseKey) {
    try {
        const k = scopedKey(baseKey);
        const raw = localStorage.getItem(k);
        if (raw !== null) return JSON.parse(raw);
        // 一次性迁移旧全局 key 数据到当前账号
        const legacy = localStorage.getItem(baseKey);
        if (legacy !== null) {
            localStorage.setItem(k, legacy);
            localStorage.removeItem(baseKey);
            return JSON.parse(legacy);
        }
        return [];
    } catch (_) { return []; }
}

function saveScopedHistory(baseKey, items) {
    try { localStorage.setItem(scopedKey(baseKey), JSON.stringify(items)); } catch (_) {}
}

function removeScopedHistory(baseKey) {
    try { localStorage.removeItem(scopedKey(baseKey)); } catch (_) {}
}