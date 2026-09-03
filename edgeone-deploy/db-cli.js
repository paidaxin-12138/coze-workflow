// ===============================================================
// db-cli.js · SQLite 数据库管理命令行工具
// 用法: node db-cli.js <command> [args]
// ===============================================================
import db from './db.js';

const [cmd, ...args] = process.argv.slice(2);

const commands = {
    // 用户管理
    users: () => {
        const rows = db.prepare('SELECT id, designer_id, display_name, email, is_admin, is_disabled, gen_count, last_gen_at, created_at FROM users ORDER BY gen_count DESC, id').all();
        console.log(`\n=== 用户列表 (${rows.length}) ===`);
        rows.forEach(u => {
            const badge = [u.is_admin ? '管理员' : '', u.is_disabled ? '已禁用' : ''].filter(Boolean).join('|') || '正常';
            const gen = `生成${u.gen_count || 0}次`;
            const last = u.last_gen_at ? `上次${new Date(u.last_gen_at).toLocaleDateString('zh-CN')}` : '从未';
            console.log(`  [${u.id}] ${u.designer_id.padEnd(20)} ${badge.padEnd(10)} ${gen.padEnd(8)} ${last.padEnd(14)} ${u.display_name || '-'}  ${u.email || '-'}  ${u.created_at}`);
        });
    },

    addadmin: (designerId) => {
        if (!designerId) { console.error('用法: node db-cli.js addadmin <designer_id>'); process.exit(1); }
        const r = db.prepare('UPDATE users SET is_admin = 1 WHERE designer_id = ?').run(designerId);
        if (r.changes === 0) { console.error(`未找到用户 "${designerId}"`); process.exit(1); }
        console.log(`✓ 已将 "${designerId}" 提升为管理员`);
    },

    deladmin: (designerId) => {
        if (!designerId) { console.error('用法: node db-cli.js deladmin <designer_id>'); process.exit(1); }
        const r = db.prepare('UPDATE users SET is_admin = 0 WHERE designer_id = ?').run(designerId);
        console.log(r.changes > 0 ? `✓ 已撤销 "${designerId}" 的管理员权限` : `未找到用户`);
    },

    resetpw: async (designerId, newPw) => {
        if (!designerId || !newPw) { console.error('用法: node db-cli.js resetpw <designer_id> <new_password>'); process.exit(1); }
        if (newPw.length < 6) { console.error('密码至少 6 位'); process.exit(1); }
        const bcrypt = (await import('bcryptjs')).default;
        const hash = await bcrypt.hash(newPw, 10);
        const r = db.prepare('UPDATE users SET password_hash = ? WHERE designer_id = ?').run(hash, designerId);
        db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE designer_id = ?)').run(designerId);
        console.log(r.changes > 0 ? `✓ "${designerId}" 密码已重置为: ${newPw}` : `未找到用户`);
    },

    // 手动累加 / 回退生成次数（管理员补偿用）
    addgen: (designerId, deltaStr) => {
        if (!designerId) { console.error('用法: node db-cli.js addgen <designer_id> [delta] (delta 默认 1，可正可负)'); process.exit(1); }
        const delta = parseInt(deltaStr || '1', 10);
        if (!Number.isFinite(delta)) { console.error('delta 必须是整数'); process.exit(1); }
        const u = db.prepare('SELECT id, designer_id, gen_count FROM users WHERE designer_id = ?').get(designerId);
        if (!u) { console.error(`未找到用户 "${designerId}"`); process.exit(1); }
        const newCount = Math.max(0, (u.gen_count || 0) + delta);
        db.prepare('UPDATE users SET gen_count = ?, last_gen_at = COALESCE(last_gen_at, datetime(\'now\')) WHERE id = ?').run(newCount, u.id);
        console.log(`✓ "${u.designer_id}" 生成次数: ${u.gen_count || 0} → ${newCount} (Δ ${delta})`);
    },

    delete: (designerId) => {
        if (!designerId) { console.error('用法: node db-cli.js delete <designer_id>'); process.exit(1); }
        const u = db.prepare('SELECT id FROM users WHERE designer_id = ?').get(designerId);
        if (!u) { console.error(`未找到用户`); process.exit(1); }
        db.prepare('DELETE FROM history WHERE user_id = ?').run(u.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
        console.log(`✓ 用户 "${designerId}" 已删除（含历史和会话）`);
    },

    // 会话管理
    sessions: () => {
        const rows = db.prepare(`
            SELECT s.token, u.designer_id, s.created_at, s.expires_at
            FROM sessions s JOIN users u ON s.user_id = u.id
            ORDER BY s.created_at DESC
        `).all();
        console.log(`\n=== 会话列表 (${rows.length}) ===`);
        rows.forEach(s => {
            const exp = new Date(s.expires_at) < new Date() ? '已过期' : '有效';
            console.log(`  ${s.designer_id.padEnd(20)} ${exp.padEnd(6)} ${s.expires_at}`);
        });
    },

    clearsessions: () => {
        const r = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
        console.log(`✓ 已清理 ${r.changes} 个过期会话`);
    },

    // 历史记录
    history: (designerId) => {
        let rows;
        if (designerId) {
            rows = db.prepare(`
                SELECT h.*, u.designer_id FROM history h
                JOIN users u ON h.user_id = u.id
                WHERE u.designer_id = ? ORDER BY h.created_at DESC
            `).all(designerId);
        } else {
            rows = db.prepare(`
                SELECT h.*, u.designer_id FROM history h
                JOIN users u ON h.user_id = u.id
                ORDER BY h.created_at DESC LIMIT 20
            `).all();
        }
        console.log(`\n=== 历史记录 (${rows.length}) ===`);
        rows.forEach(h => {
            console.log(`  [${h.id}] ${h.designer_id.padEnd(15)} "${(h.title || h.prompt || '').substring(0, 40)}..."  ${h.created_at}`);
        });
    },

    // 统计
    stats: () => {
        const stats = {
            users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
            admins: db.prepare('SELECT COUNT(*) c FROM users WHERE is_admin = 1').get().c,
            disabled: db.prepare('SELECT COUNT(*) c FROM users WHERE is_disabled = 1').get().c,
            sessions: db.prepare('SELECT COUNT(*) c FROM sessions').get().c,
            history: db.prepare('SELECT COUNT(*) c FROM history').get().c,
            totalGen: db.prepare('SELECT COALESCE(SUM(gen_count),0) c FROM users').get().c,
            todayGen: db.prepare("SELECT COUNT(*) c FROM history WHERE created_at >= date('now')").get().c,
            neverUsed: db.prepare('SELECT COUNT(*) c FROM users WHERE COALESCE(gen_count,0) = 0').get().c
        };
        console.log('\n=== 数据库统计 ===');
        console.log(`  用户总数:  ${stats.users}`);
        console.log(`  管理员:    ${stats.admins}`);
        console.log(`  已禁用:    ${stats.disabled}`);
        console.log(`  从未生成:  ${stats.neverUsed}`);
        console.log(`  活跃会话:  ${stats.sessions}`);
        console.log(`  历史记录:  ${stats.history}`);
        console.log(`  总生成数:  ${stats.totalGen}`);
        console.log(`  今日生成:  ${stats.todayGen}`);
    },

    // 生成次数排行榜
    topgen: (limitStr) => {
        const limit = Math.min(100, Math.max(1, parseInt(limitStr || '10', 10)));
        const rows = db.prepare(`
            SELECT designer_id, gen_count, last_gen_at, created_at
            FROM users
            ORDER BY gen_count DESC, last_gen_at DESC NULLS LAST
            LIMIT ?
        `).all(limit);
        console.log(`\n=== 生成次数排行榜 TOP ${rows.length} ===`);
        rows.forEach((u, i) => {
            const rank = String(i + 1).padStart(2);
            const last = u.last_gen_at ? new Date(u.last_gen_at).toLocaleString('zh-CN') : '-';
            console.log(`  #${rank} ${u.designer_id.padEnd(22)} ${String(u.gen_count || 0).padStart(5)} 次    上次: ${last}`);
        });
    },

    // SQL 查询
    query: (sql) => {
        if (!sql) { console.error('用法: node db-cli.js query "SELECT * FROM users"'); process.exit(1); }
        try {
            const rows = db.prepare(sql).all();
            console.log(`\n=== 查询结果 (${rows.length} 行) ===`);
            if (rows.length > 0) {
                console.table(rows);
            } else {
                console.log('无数据');
            }
        } catch (e) {
            console.error('SQL 错误:', e.message);
        }
    },

    // 表结构
    tables: () => {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
        console.log('\n=== 表列表 ===');
        tables.forEach(t => {
            console.log(`\n--- ${t.name} ---`);
            const info = db.prepare(`PRAGMA table_info(${t.name})`).all();
            info.forEach(c => console.log(`  ${c.name.padEnd(20)} ${c.type.padEnd(15)} ${c.notnull ? 'NOT NULL' : ''} ${c.pk ? 'PK' : ''}`));
            const count = db.prepare(`SELECT COUNT(*) c FROM ${t.name}`).get().c;
            console.log(`  行数: ${count}`);
        });
    },

    // 清空数据库（危险操作）
    reset: () => {
        console.log('⚠️  此操作将删除所有用户、会话和历史记录！');
        process.stdout.write('确认输入 "YES" 继续: ');
        process.stdin.resume();
        process.stdin.once('data', (input) => {
            const confirm = input.toString().trim();
            if (confirm !== 'YES') { console.log('已取消'); process.exit(0); }
            db.prepare('DELETE FROM history').run();
            db.prepare('DELETE FROM sessions').run();
            db.prepare('DELETE FROM users').run();
            console.log('✓ 数据库已清空（首注册用户将自动成为管理员）');
            process.exit(0);
        });
    },

    // 备份
    backup: async (destPath) => {
        const target = destPath || `data_backup_${Date.now()}.db`;
        const fs = (await import('fs')).default;
        // 先 checkpoint WAL
        db.pragma('wal_checkpoint(TRUNCATE)');
        fs.copyFileSync('data.db', target);
        console.log(`✓ 已备份到: ${target}`);
    },

    help: () => {
        console.log(`
SQLite 数据库管理工具
用法: node db-cli.js <command> [args]

用户管理:
  users                    列出所有用户（按生成次数排序）
  addadmin <id>            提升用户为管理员
  deladmin <id>            撤销管理员权限
  resetpw <id> <password>  重置用户密码
  addgen <id> [delta]      手动调整生成次数（delta 可正可负，默认 +1）
  delete <id>              删除用户（含历史和会话）

数据查看:
  stats                    数据库统计（含生成次数汇总）
  topgen [n]               生成次数排行榜 (默认 TOP 10)
  sessions                 查看所有会话
  history [id]             查看历史记录（可选指定用户）
  tables                   查看表结构和行数
  query "<sql>"            执行 SQL 查询

维护:
  clearsessions            清理过期会话
  backup [path]            备份数据库
  reset                    清空所有数据（危险！）

示例:
  node db-cli.js users
  node db-cli.js topgen 20
  node db-cli.js addadmin alice
  node db-cli.js addgen bob 3
  node db-cli.js resetpw bob newpass123
  node db-cli.js query "SELECT designer_id, gen_count FROM users ORDER BY gen_count DESC LIMIT 5"
        `);
    }
};

// 执行命令
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    commands.help();
    process.exit(0);
}

const fn = commands[cmd];
if (!fn) {
    console.error(`未知命令: ${cmd}`);
    console.error('运行 "node db-cli.js help" 查看可用命令');
    process.exit(1);
}

// 处理 async 函数
Promise.resolve(fn(...args)).then(() => {
    if (cmd !== 'reset') process.exit(0);
}).catch(e => {
    console.error('执行错误:', e.message);
    process.exit(1);
});
