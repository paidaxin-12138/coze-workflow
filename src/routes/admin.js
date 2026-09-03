// 管理员路由
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db, { getUserById, listUsers, getUserStats, toggleAdmin, toggleDisabled, resetUserPassword, adminDeleteUser } from '../../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// GET /api/admin/stats
router.get('/stats', requireAuth, requireAdmin, (req, res) => res.json(getUserStats()));

// GET /api/admin/users
router.get('/users', requireAuth, requireAdmin, (req, res) => res.json({ users: listUsers() }));

// POST /api/admin/users/:id/toggle-admin
router.post('/users/:id/toggle-admin', requireAuth, requireAdmin, (req, res) => {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: '不能修改自己的管理员状态' });
    toggleAdmin(targetId);
    res.json({ success: true });
});

// POST /api/admin/users/:id/toggle-disabled
router.post('/users/:id/toggle-disabled', requireAuth, requireAdmin, (req, res) => {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: '不能禁用自己' });
    const user = getUserById(targetId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    toggleDisabled(targetId);
    if (!user.is_disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
    res.json({ success: true });
});

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: '不能重置自己的密码' });
    const new_password = req.body.new_password || Math.random().toString(36).slice(2, 10);
    const password_hash = await bcrypt.hash(new_password, 10);
    resetUserPassword(targetId, password_hash);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
    res.json({ success: true, message: '密码已重置成功' });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: '不能删除自己' });
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
    adminDeleteUser(targetId);
    res.json({ success: true });
});

export default router;