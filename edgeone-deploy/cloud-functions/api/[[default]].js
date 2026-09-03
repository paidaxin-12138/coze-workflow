// EdgeOne Pages Cloud Functions - Express 全栈 API 入口
// 匹配 /api/* 所有请求，用 Express 路由处理

import express from 'express';
import cors from 'cors';

// ===== 导入路由模块 =====
import authRoutes from '../../src/routes/auth.js';
import historyRoutes from '../../src/routes/history.js';
import adminRoutes from '../../src/routes/admin.js';
import workflowRoutes from '../../src/routes/workflow.js';
import legacyRoutes from '../../src/routes/legacy.js';
import { CONFIG } from '../../src/config.js';
import { ensureRootAdmin } from '../../db.js';

const app = express();

// ===== 中间件 =====
// 使用白名单 CORS（从 CONFIG.ALLOWED_ORIGINS 读取）
const corsOptions = {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    origin: function (origin, callback) {
        // 允许无 origin 的请求（如 Postman、服务器间调用）
        if (!origin) return callback(null, true);
        // 开发环境允许 localhost
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return callback(null, true);
        }
        // 检查白名单
        if (CONFIG.ALLOWED_ORIGINS.length === 0) {
            console.warn('⚠️ ALLOWED_ORIGINS 未配置，生产环境拒绝所有跨域请求');
            return callback(new Error('CORS 未配置白名单'), false);
        }
        const isAllowed = CONFIG.ALLOWED_ORIGINS.some(allowed => origin === allowed || origin.endsWith(allowed));
        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`⛔ CORS 拒绝: ${origin}`);
            callback(new Error('CORS 策略禁止'), false);
        }
    }
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// 速率限制 (30 req/min per IP) - 使用内存 Map（EdgeOne 无 Redis，保留内存实现）
const rateLimitMap = new Map();
app.use('/api/', async (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `rate_limit:${ip}`;
    const windowSec = Math.ceil(CONFIG.RATE_LIMIT.windowMs / 1000);

    try {
        // 尝试使用 Redis（如果可用）
        // 注意：此函数在 EdgeOne 环境通常无 Redis，使用内存 fallback
        const now = Date.now();
        if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
        const hits = rateLimitMap.get(ip).filter(t => now - t < CONFIG.RATE_LIMIT.windowMs);
        if (hits.length >= CONFIG.RATE_LIMIT.max) {
            res.set('X-RateLimit-Limit', String(CONFIG.RATE_LIMIT.max));
            res.set('X-RateLimit-Remaining', '0');
            return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
        }
        hits.push(now);
        rateLimitMap.set(ip, hits);
        res.set('X-RateLimit-Limit', String(CONFIG.RATE_LIMIT.max));
        res.set('X-RateLimit-Remaining', String(CONFIG.RATE_LIMIT.max - hits.length));
        next();
    } catch (e) {
        console.warn('限流中间件异常，放行请求:', e.message);
        next();
    }
});

// 请求日志
app.use('/api/', (req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ===== 挂载路由 =====
app.use('/api', authRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tasks', workflowRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/upload', workflowRoutes);
app.use('/api', legacyRoutes);

// 确保首次部署时根管理员存在（非阻塞初始化）
if (process.env.ADMIN_DESIGNER_ID) {
    ensureRootAdmin().catch(() => {});
}

// 导出 Express 应用 - EdgeOne 自动包装为 Cloud Functions

// ===== 404 兜底 =====
app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
});

// ===== 全局异常捕获（5 个参数，Express 识别为 error handler） =====
app.use((err, req, res, next) => {
    console.error('🔥 全局异常:', err.stack || err.message);
    const status = err.statusCode || err.status || 500;
    const message = status >= 500
        ? '服务器内部错误，请稍后重试'
        : (err.message || '请求处理失败');
    res.status(status).json({
        success: false,
        error: message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
});

export default app;