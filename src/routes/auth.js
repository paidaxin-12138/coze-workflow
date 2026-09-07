// 认证路由 - 注册/登录/登出/账户管理
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import db, {
    createUser, getUserByDesignerId, getUserById,
    createSession, deleteSession, shouldFirstUserBeAdmin, ensureRootAdmin
} from '../../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// 注册接口限流：每 IP 每小时最多 5 次注册
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: '注册过于频繁，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false,
});

function formatUser(user) {
    return {
        id: user.id, designer_id: user.designer_id,
        display_name: user.display_name, email: user.email,
        is_admin: !!user.is_admin, is_disabled: !!user.is_disabled,
        gen_count: user.gen_count || 0, last_gen_at: user.last_gen_at || null,
        created_at: user.created_at
    };
}

// POST /api/register
router.post('/register', registerLimiter, async (req, res) => {
    try {
        const { designer_id, password, email, display_name } = req.body;
        if (!designer_id || !password) return res.status(400).json({ error: '请提供 designer_id 和 password' });
        if (designer_id.length < 3 || designer_id.length > 30)
            return res.status(400).json({ error: 'designer_id 长度需在 3-30 之间' });
        if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
        if (getUserByDesignerId(designer_id)) return res.status(409).json({ error: '该 designer_id 已被注册' });

        const shouldFirstBeAdmin = shouldFirstUserBeAdmin();
        const password_hash = await bcrypt.hash(password, 10);
        const user = createUser({ designer_id, password_hash, email, display_name });
        if (shouldFirstBeAdmin) db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
        ensureRootAdmin();
        const session = createSession(user.id);
        return res.json({ success: true, token: session.token, user: formatUser(getUserById(user.id)) });
    } catch (e) {
        console.error('注册失败:', e);
        return res.status(500).json({ error: '注册失败' });
    }
});

// POST /api/login
router.post('/login', async (req, res) => {
    try {
        const { designer_id, password } = req.body;
        if (!designer_id || !password) return res.status(400).json({ error: '请提供 designer_id 和 password' });
        const user = getUserByDesignerId(designer_id);
        if (!user) return res.status(404).json({ error: `账号「${designer_id}」不存在，请先注册`, code: 'USER_NOT_FOUND' });
        if (user.is_disabled) return res.status(403).json({ error: '该账号已被禁用，请联系管理员', code: 'ACCOUNT_DISABLED' });
        if (!(await bcrypt.compare(password, user.password_hash)))
            return res.status(401).json({ error: '密码错误，请重试', code: 'WRONG_PASSWORD' });
        const session = createSession(user.id);
        return res.json({ success: true, token: session.token, user: formatUser(user) });
    } catch (e) {
        if (process.env.NODE_ENV !== 'production') console.error('登录失败:', e);
        return res.status(500).json({ error: '登录失败' });
    }
});

// POST /api/logout
router.post('/logout', requireAuth, (req, res) => {
    deleteSession(req.token);
    res.json({ success: true });
});

// GET /api/me
router.get('/me', requireAuth, (req, res) => {
    const user = getUserById(req.user.id);
    if (!user) return res.status(401).json({ error: '账户不存在' });
    res.json({ user: formatUser(user) });
});

// GET /api/account
router.get('/account', requireAuth, (req, res) => {
    const user = getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ success: true, user: formatUser(user) });
});

// PUT /api/account
router.put('/account', requireAuth, (req, res) => {
    const { display_name, email } = req.body;
    db.prepare('UPDATE users SET display_name = ?, email = ? WHERE id = ?').run(display_name || null, email || null, req.user.id);
    res.json({ success: true, user: formatUser(getUserById(req.user.id)) });
});

// POST /api/account/change-password
router.post('/account/change-password', requireAuth, async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: '请提供当前密码和新密码' });
    if (new_password.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
    const user = getUserById(req.user.id);
    if (!(await bcrypt.compare(current_password, user.password_hash)))
        return res.status(401).json({ error: '当前密码错误' });
    const password_hash = await bcrypt.hash(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    res.json({ success: true, message: '密码修改成功，请重新登录' });
});

// DELETE /api/account
router.delete('/account', requireAuth, async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: '请输入密码以确认' });
    const user = getUserById(req.user.id);
    if (!(await bcrypt.compare(password, user.password_hash)))
        return res.status(401).json({ error: '密码错误' });
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    res.json({ success: true, message: '账号已删除' });
});

export default router;