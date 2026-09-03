// Express.js Server - Coze Workflow App
// 注意：此文件是本地开发服务器，请勿上传到 EdgeOne Pages 部署
// EdgeOne 部署使用 cloud-functions/api/[[default]].js 作为云函数入口
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 优先加载 .env.local，缺失回退到 .env（使用 path.resolve 确保绝对路径）
for (const f of ['.env.local', '.env']) {
    const p = path.resolve(__dirname, f);
    if (fs.existsSync(p)) {
        try { dotenvConfig({ path: p, override: true }); console.log(`[env] 已加载 ${f}`); } catch (e) { console.warn(`[env] 加载 ${f} 失败:`, e.message); }
    }
}

import express from 'express';
import cors from 'cors';
import { Redis } from '@upstash/redis';
import { CONFIG } from './src/config.js';
import { ensureRootAdmin } from './db.js';

// ===== 路由模块 =====
import authRoutes from './src/routes/auth.js';
import historyRoutes from './src/routes/history.js';
import adminRoutes from './src/routes/admin.js';
import workflowRoutes from './src/routes/workflow.js';
import legacyRoutes, { setRedis } from './src/routes/legacy.js';

const app = express();
const PORT = CONFIG.PORT;

// ===== Redis 连接 + 内存 fallback =====
let redis;
let redisAvailable = false;
const memoryStore = new Map();

async function initRedis() {
    try {
        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            redis = new Redis({
                url: process.env.UPSTASH_REDIS_REST_URL,
                token: process.env.UPSTASH_REDIS_REST_TOKEN,
            });
            await redis.ping();
            redisAvailable = true;
            console.log('Redis 连接成功');
        } else {
            throw new Error('Redis URL/TOKEN 未配置');
        }
    } catch (e) {
        console.warn('Redis 不可用，降级为内存存储:', e.message);
        redisAvailable = false;
        redis = {
            set: async (key, value) => { memoryStore.set(key, value); },
            get: async (key) => memoryStore.get(key) || null,
            del: async (key) => { memoryStore.delete(key); },
        };
    }
}

// 注入 redis 到 legacy 路由
setRedis(redis);

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

// 速率限制 (30 req/min per IP) - 支持 Redis/内存双模式
const rateLimitMap = new Map();
app.use('/api/', async (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `rate_limit:${ip}`;
    const windowSec = Math.ceil(CONFIG.RATE_LIMIT.windowMs / 1000);

    try {
        if (redisAvailable && redis && typeof redis.incr === 'function') {
            // Redis 实现（原子操作，适配多实例部署）
            const current = await redis.incr(key);
            if (current === 1) {
                await redis.expire(key, windowSec);
            }
            if (current > CONFIG.RATE_LIMIT.max) {
                res.set('X-RateLimit-Limit', String(CONFIG.RATE_LIMIT.max));
                res.set('X-RateLimit-Remaining', '0');
                return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
            }
            res.set('X-RateLimit-Limit', String(CONFIG.RATE_LIMIT.max));
            res.set('X-RateLimit-Remaining', String(CONFIG.RATE_LIMIT.max - current));
        } else {
            // 降级：内存 Map 实现（单实例兼容）
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
        }
        next();
    } catch (e) {
        console.warn('限流中间件异常，放行请求:', e.message);
        next();
    }
});

// 静态文件
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ===== 挂载路由 =====
app.use('/api', authRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tasks', workflowRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/upload', workflowRoutes);
app.use('/api', legacyRoutes);

// Favicon 兜底
app.get('/favicon.ico', (req, res) => res.status(204).end());

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

// 全局异常捕获
process.on('uncaughtException', (err) => {
    console.error('uncaughtException:', err.stack || err.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('unhandledRejection:', reason?.stack || reason?.message || reason);
});

// 启动服务器 — 包装在 async IIFE 中避免顶层 await
(async () => {
    await initRedis();
    app.listen(PORT, () => {
        ensureRootAdmin();
        console.log(`Express 服务器已启动: http://localhost:${PORT}`);
        // [DEBUG] 打印配置信息
        console.log('[CONFIG] KM_COZE_TOKEN length:', CONFIG.KM_COZE_TOKEN?.length);
        console.log('[CONFIG] KM_COZE_TOKEN prefix:', CONFIG.KM_COZE_TOKEN?.substring(0, 10));
        console.log('[CONFIG] KM_WORKFLOW_ID:', CONFIG.KM_WORKFLOW_ID);
        console.log('[CONFIG] COZE_APP_ID:', CONFIG.COZE_APP_ID);
    });
})();