// 认证中间件 - requireAuth + requireAdmin（EdgeOne 版）
import { getSession, getUserById, deleteSession } from '../db.js';

export async function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: '未登录' });
    const token = auth.slice(7);
    const session = await getSession(token);
    if (!session) return res.status(401).json({ error: '会话无效或已过期' });
    const user = await getUserById(session.user_id);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (user.is_disabled) {
        await deleteSession(token);
        return res.status(403).json({ error: '账号已被禁用' });
    }
    req.user = user;
    req.token = token;
    next();
}

export async function requireAdmin(req, res, next) {
    if (!req.user?.is_admin) return res.status(403).json({ error: '需要管理员权限' });
    next();
}