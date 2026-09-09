// Express.js Server - Coze Workflow App
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { config as dotenvConfig } from 'dotenv';

// 设置终端编码为 UTF-8，解决中文乱码（需在同一个控制台执行才生效）
try { execSync('cmd /c chcp 65001', { stdio: 'inherit' }); } catch (_) {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 优先加载 .env.local，缺失回退到 .env（使用 path.resolve 确保绝对路径）
for (const f of ['.env.local', '.env']) {
    const p = path.resolve(__dirname, f);
    if (fs.existsSync(p)) {
        try { dotenvConfig({ path: p, override: true }); if (process.env.NODE_ENV !== 'production') console.log(`[env] 已加载 ${f}`); } catch (e) { console.warn(`[env] 加载 ${f} 失败:`, e.message); }
    }
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Redis } from '@upstash/redis';
import { CONFIG } from './src/config.js';
import { ensureRootAdmin, clearTasks, default as db } from './db.js';
import { requireAuth } from './src/middleware/auth.js';
import pino from 'pino';
import pinoHttp from 'pino-http';
import crypto from 'crypto';

// ===== 结构化日志 =====
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'production'
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        },
    formatters: {
        level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
});

// ===== 路由模块 =====
import authRoutes from './src/routes/auth.js';
import historyRoutes from './src/routes/history.js';
import adminRoutes from './src/routes/admin.js';
import workflowRoutes from './src/routes/workflow.js';
import legacyRoutes, { setRedis } from './src/routes/legacy.js';

const app = express();
// 前端页面重定向（补全 .html 后缀）
app.get('/account', (req, res) => res.redirect('/account.html'));
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/history', (req, res) => res.redirect('/history.html'));
app.get('/tasks', (req, res) => res.redirect('/tasks.html'));
app.get('/studio', (req, res) => res.redirect('/studio.html'));
app.get('/about', (req, res) => res.redirect('/about.html'));
app.get('/login', (req, res) => res.redirect('/login.html'));
const PORT = CONFIG.PORT;

// ===== Redis 连接（REDIS_MODE = required / optional / disabled） =====
let redis;
let redisAvailable = false;
const memoryStore = new Map();

async function initRedis() {
    const mode = (process.env.REDIS_MODE || 'optional').toLowerCase();
    const logPrefix = `[Redis mode=${mode}]`;

    // disabled 模式 — 完全禁用，直接使用内存
    if (mode === 'disabled') {
        logger.info(logPrefix + ' Redis 已禁用，使用内存存储');
        redisAvailable = false;
        redis = {
            set: async (key, value) => { memoryStore.set(key, value); },
            get: async (key) => memoryStore.get(key) || null,
            del: async (key) => { memoryStore.delete(key); },
        };
        return;
    }

    // 尝试连接 Upstash
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
        try {
            redis = new Redis({
                url: process.env.UPSTASH_REDIS_REST_URL,
                token: process.env.UPSTASH_REDIS_REST_TOKEN,
            });
            await redis.ping();
            redisAvailable = true;
            logger.info(logPrefix + ' Upstash Redis 连接成功');
            return;
        } catch (e) {
            logger.warn(logPrefix + ' Upstash Redis 连接失败:', e.message);
        }
    }

    // 尝试连接本地 Redis（需动态安装 ioredis）
    if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
        try {
            const { default: RedisLocal } = await import('ioredis');
            const localRedis = new RedisLocal({
                host: process.env.REDIS_HOST,
                port: parseInt(process.env.REDIS_PORT, 10) || 6379,
                password: process.env.REDIS_PASSWORD || undefined,
                retryStrategy: () => null, // 不重试，快速失败
                lazyConnect: true,
            });
            await localRedis.connect();
            redis = localRedis;
            redisAvailable = true;
            logger.info(logPrefix + ' 本地 Redis 连接成功');
            return;
        } catch (e) {
            logger.warn(logPrefix + ' 本地 Redis 连接失败:', e.message);
        }
    }

    // 所有连接方式均失败
    if (mode === 'required') {
        throw new Error('=== 致命错误：Redis 不可用，服务无法启动 ===\n' +
            '请配置 UPSTASH_REDIS_REST_URL/TOKEN 或 REDIS_HOST/PORT，' +
            '或设置 REDIS_MODE=optional 降级为内存存储');
    }

    // optional 模式 — 降级为内存存储
    logger.warn(logPrefix + ' Redis 未配置或不可用，降级为内存存储');
    redisAvailable = false;
    redis = {
        set: async (key, value) => { memoryStore.set(key, value); },
        get: async (key) => memoryStore.get(key) || null,
        del: async (key) => { memoryStore.delete(key); },
    };
}
await initRedis();

// 注入 redis 到 legacy 路由
setRedis(redis);

// ===== 中间件 =====
// 使用白名单 CORS（从 CONFIG.ALLOWED_ORIGINS 读取）
const corsOptions = {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    origin: function (origin, callback) {
        // 1. 允许无 origin 的请求（如 Postman、服务器间调用）
        if (!origin) return callback(null, true);
        // 2. 开发环境允许 localhost
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return callback(null, true);
        }
        // 检查白名单
        if (CONFIG.ALLOWED_ORIGINS.length === 0) {
            logger.warn({ origin }, 'ALLOWED_ORIGINS 未配置，生产环境拒绝所有跨域请求');
            return callback(new Error('CORS 未配置白名单'), false);
        }
        const isAllowed = CONFIG.ALLOWED_ORIGINS.some(allowed => origin === allowed || origin.endsWith(allowed));
        if (isAllowed) {
            callback(null, true);
        } else {
            logger.warn({ origin }, 'CORS 拒绝');
            callback(new Error('CORS 策略禁止'), false);
        }
    }
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// ===== Nonce 生成中间件（在 Helmet 之前） =====
app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('base64');
    next();
});

// 非 HTML 静态文件（css, js, png 等由 express.static 直接处理）
app.use(express.static(path.join(__dirname, 'frontend'), { extensions: ['html'], index: false }));
// 上传图片静态文件服务
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// 带 nonce 注入的 HTML 页面路由
const htmlDir = path.join(__dirname, 'frontend');
function serveHtml(htmlFile) {
    return (req, res) => {
        const filePath = path.join(htmlDir, htmlFile);
        if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
        let html = fs.readFileSync(filePath, 'utf-8');
        // 在所有 <script> 标签中注入 nonce（排除已有 nonce 的标签）
        html = html.replace(/<script(?![^>]*nonce)(\s)/g, `<script nonce="${res.locals.nonce}"$1`);
        // 在所有 <link rel="preload" as="script"> 标签中注入 nonce
        html = html.replace(/<link(?![^>]*nonce)([^>]*rel=["']preload["'][^>]*as=["']script["'][^>]*)>/g, `<link nonce="${res.locals.nonce}"$1>`);
        res.type('html').send(html);
    };
}

// 启用 Helmet 安全头（包含 CSP 策略，使用 nonce 替代 unsafe-inline/unsafe-eval）
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                (req, res) => `'nonce-${res.locals.nonce}'`,
                "https://cdnjs.cloudflare.com",
                "https://lf3-static.bytednsdoc.com",
                "https://lf9-static.bytednsdoc.com",
            ],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            connectSrc: ["'self'", "https://api.coze.cn", "https://api.coze.com", "https://oss.miheai.com", "https://*.coze.cn"],
            frameSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    // 启用 HSTS（任务 7）
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
    },
}));

// ===== 请求日志中间件 =====
const httpLogger = pinoHttp({
    logger,
    genReqId: (req) => {
        const requestId = req.headers['x-request-id'] || crypto.randomUUID();
        req.headers['x-request-id'] = requestId;
        return requestId;
    },
    customLogLevel: (req, res, err) => {
        if (res.statusCode >= 500 || err) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    },
    customSuccessMessage: (req, res) => {
        return `${req.method} ${req.url} ${res.statusCode} - ${res.statusCode >= 400 ? '❌' : '✅'}`;
    },
    customErrorMessage: (req, res, err) => {
        return `${req.method} ${req.url} ${res.statusCode} - ❌ ${err.message}`;
    },
});

app.use(httpLogger);

// 速率限制 (30 req/min per IP) - 使用 Redis（若可用）或内存存储
async function getRateLimit(ip) {
    const now = Date.now();
    const windowMs = CONFIG.RATE_LIMIT.windowMs;
    const key = `rate_limit:${ip}`;

    if (redisAvailable) {
        try {
            // Redis: 使用有序集合存储时间戳，删除过期记录，计数
            await redis.zremrangebyscore(key, 0, now - windowMs);
            const count = await redis.zcard(key);
            return { count, success: true };
        } catch (e) {
            logger.warn({ err: e }, 'Redis 限流查询失败，降级到内存');
        }
    }

    // 内存存储降级
    const memoryStore = global.rateLimitMap || new Map();
    global.rateLimitMap = memoryStore;
    const hits = (memoryStore.get(ip) || []).filter(t => now - t < windowMs);
    return { count: hits.length, success: true };
}

async function incrementRateLimit(ip) {
    const now = Date.now();
    const windowMs = CONFIG.RATE_LIMIT.windowMs;
    const key = `rate_limit:${ip}`;

    if (redisAvailable) {
        try {
            await redis.zadd(key, now, now.toString());
            await redis.expire(key, Math.ceil(windowMs / 1000));
            return true;
        } catch (e) {
            logger.warn({ err: e }, 'Redis 限流增量失败，降级到内存');
        }
    }

    // 内存存储降级
    const memoryStore = global.rateLimitMap || new Map();
    global.rateLimitMap = memoryStore;
    const hits = (memoryStore.get(ip) || []).filter(t => now - t < windowMs);
    hits.push(now);
    memoryStore.set(ip, hits);
    return true;
}

// 限流中间件（异步版本兼容 Express）
app.use('/api/', async (req, res, next) => {
    // GET /api/workflow 是只读状态同步接口，前端有活跃任务时每秒轮询，跳过严格限流避免 429
    if (req.method === 'GET' && req.path === '/workflow') {
        return next();
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = CONFIG.RATE_LIMIT.windowMs;
    const max = CONFIG.RATE_LIMIT.max;

    try {
        const { count } = await getRateLimit(ip);

        if (count >= max) {
            res.set('X-RateLimit-Limit', String(max));
            res.set('X-RateLimit-Remaining', '0');
            return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
        }

        await incrementRateLimit(ip);

        res.set('X-RateLimit-Limit', String(max));
        res.set('X-RateLimit-Remaining', String(max - count - 1));
        next();
    } catch (e) {
        logger.warn({ err: e }, '限流处理失败，放行请求');
        next();
    }
});

// 定时清理内存存储（仅在 Redis 不可用时需要）
if (!redisAvailable) {
    setInterval(() => {
        const now = Date.now();
        const windowMs = CONFIG.RATE_LIMIT.windowMs;
        const memoryStore = global.rateLimitMap;
        if (!memoryStore) return;

        let cleared = 0;
        for (const [ip, timestamps] of memoryStore.entries()) {
            const valid = timestamps.filter(t => now - t < windowMs);
            if (valid.length === 0) {
                memoryStore.delete(ip);
                cleared++;
            } else {
                memoryStore.set(ip, valid);
            }
        }
        if (cleared > 0) {
            logger.info({ cleared, mapSize: memoryStore.size }, '已清理过期 IP 限流记录');
        }
    }, 5 * 60 * 1000); // 5 分钟
}

// HTML 页面路由（带 nonce 注入）
app.get('/', serveHtml('index.html'));
app.get('/index.html', serveHtml('index.html'));
app.get('/studio.html', serveHtml('studio.html'));
app.get('/copy.html', serveHtml('copy.html'));
app.get('/history.html', serveHtml('history.html'));
app.get('/tasks.html', serveHtml('tasks.html'));
app.get('/about.html', serveHtml('about.html'));
app.get('/login.html', serveHtml('login.html'));
app.get('/account.html', serveHtml('account.html'));
app.get('/admin.html', serveHtml('admin.html'));
app.get('/500.html', serveHtml('500.html'));

// ===== 挂载路由 =====
app.use('/api', authRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/admin', adminRoutes);

// 清空当前用户的所有任务（必须在 workflowRoutes 之前，避免被 /:id 拦截）
app.delete('/api/tasks/clear', requireAuth, (req, res) => {
    try {
        const count = clearTasks(req.user.id);
        res.json({ success: true, deletedCount: count });
    } catch (e) {
        logger.error({ err: e }, '清空任务失败');
        res.status(500).json({ success: false, error: '清空任务失败' });
    }
});

app.use('/api/workflow', workflowRoutes);
app.use('/api', legacyRoutes);

// Favicon 兜底
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ===== 404 兜底 =====
app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
});

// ===== 全局异常捕获 =====
app.use((err, req, res, next) => {
    logger.error({ err }, '全局异常: ' + (err.stack || err.message));
    const status = err.statusCode || err.status || 500;
    const message = status >= 500
        ? '服务器内部错误，请稍后重试'
        : (err.message || '请求处理失败');

    // 判断请求类型：如果是 HTML 页面请求，返回优雅的错误页面
    const acceptHeader = req.headers.accept || '';
    if (status >= 500 && acceptHeader.includes('text/html')) {
        return res.status(status).sendFile(path.join(__dirname, 'frontend', '500.html'));
    }

    res.status(status).json({
        success: false,
        error: message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
});

// ===== 启动服务器
let server = null;
server = app.listen(PORT, () => {
    ensureRootAdmin();
    logger.info({ port: PORT, url: `http://localhost:${PORT}` }, 'Express 服务器已启动');
    if (process.env.NODE_ENV !== 'production') {
        logger.info({ tokenLen: CONFIG.KM_COZE_TOKEN?.length, tokenPrefix: CONFIG.KM_COZE_TOKEN?.substring(0, 10) }, '[CONFIG] Coze Token');
        logger.info({ workflowId: CONFIG.KM_WORKFLOW_ID }, '[CONFIG] KM_WORKFLOW_ID');
        logger.info({ appId: CONFIG.COZE_APP_ID }, '[CONFIG] COZE_APP_ID');
        logger.info({ specId: CONFIG.WF_SPEC_ID, previewId: CONFIG.WF_PREVIEW_ID, multiId: CONFIG.WF_MULTI_ID }, '[CONFIG] Workflow IDs');
    }
});

// 定时清理 7 天前的上传图片（每天检查一次，降低磁盘 I/O，避免误删仍在使用的降级文件）
const UPLOAD_DIR = path.join(__dirname, 'public/uploads');
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 1天
const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7天
setInterval(() => {
    if (!fs.existsSync(UPLOAD_DIR)) return;
    const now = Date.now();
    let deleted = 0;
    try {
        const files = fs.readdirSync(UPLOAD_DIR);
        for (const file of files) {
            const filePath = path.join(UPLOAD_DIR, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > MAX_AGE) {
                    fs.unlinkSync(filePath);
                    deleted++;
                }
            } catch (_) { /* 文件可能已被删除 */ }
        }
        if (deleted > 0) logger.info({ deleted }, '已清理过期上传图片');
    } catch (_) { /* 目录不存在或无权访问 */ }
}, CLEANUP_INTERVAL);

// ===== 优雅关机 =====
function gracefulShutdown(signal) {
    logger.info({ signal }, '收到终止信号，正在优雅关闭服务器...');

    if (server) {
        // 停止接收新请求，等待现有请求完成（超时 10 秒）
        server.close(() => {
            logger.info('所有请求已处理完成，服务器已关闭');

            // 关闭数据库连接
            try {
                if (db && typeof db.close === 'function') {
                    db.close();
                    logger.info('数据库连接已关闭');
                }
            } catch (err) {
                logger.warn({ err }, '关闭数据库连接时出错: ' + err.message);
            }

            // 关闭 Redis 连接（如果存在）
            try {
                if (redis && typeof redis.quit === 'function') {
                    redis.quit();
                    logger.info('Redis 连接已关闭');
                }
            } catch (err) {
                logger.warn({ err }, '关闭 Redis 连接时出错: ' + err.message);
            }

            process.exit(0);
        });

        // 设置超时强制退出（10 秒后强制终止）
        setTimeout(() => {
            logger.error('强制关闭：等待请求超时（10秒）');
            process.exit(1);
        }, 10000);
    } else {
        process.exit(0);
    }
}

// 监听终止信号
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 捕获未处理的异常并尝试优雅关闭
process.on('uncaughtException', (err) => {
    logger.error({ err }, '未捕获的异常: ' + (err.stack || err.message || err));
    setTimeout(() => process.exit(1), 500);
});
process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, '未处理的 Promise 拒绝: ' + (reason?.stack || reason?.message || reason));
    setTimeout(() => process.exit(1), 500);
});