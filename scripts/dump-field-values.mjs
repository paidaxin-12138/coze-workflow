// ===== dump design_library 全字段取值分布 =====
// 只读：统计 13 个匹配相关字段的取值分布，评估精确匹配（score）是否受控。
// 用法：node scripts/dump-field-values.mjs          （默认连 ./data.db）
//       DB_PATH=/xxx/data.db node scripts/dump-field-values.mjs
// 不做任何 INSERT/UPDATE/DELETE。
import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || 'data.db';
const db = new Database(DB_PATH, { readonly: true });

const FIELDS = [
  // 7 结构
  'shape_family', 'shoulder_type', 'body_silhouette', 'surface_treatment',
  'base_type', 'neck_type', 'cap_architecture',
  // 5 材质/颜色
  'primary_material', 'dominant_color', 'liquid_color',
  'liquid_fill_level', 'overall_mood',
  // 额外进权重表但不在 12 标签清单
  'height_to_width_ratio',
];

const total = db.prepare('SELECT COUNT(*) AS c FROM design_library').get().c;
console.log(`design_library 总行数: ${total}\n`);

for (const f of FIELDS) {
  const rows = db.prepare(
    `SELECT ${f} AS v, COUNT(*) AS c, SUM(CASE WHEN ${f} IS NULL OR ${f} = '' THEN 1 ELSE 0 END) AS blank
     FROM design_library GROUP BY v ORDER BY c DESC, v`
  ).all();

  const nonNull = rows.filter((r) => r.v !== null && r.v !== '');
  const uniq = nonNull.length; // 非空唯一值个数（含 NULL/空值会单列出来）
  const blank = rows.filter((r) => r.v === null || r.v === '').reduce((s, r) => s + r.c, 0);

  console.log(`--- ${f} ---`);
  console.log(`  唯一值(非空): ${uniq} | 空/NULL 计数: ${blank} / ${total}`);
  for (const r of rows) {
    const label = (r.v === null || r.v === '') ? '(NULL/空)' : `"${r.v}"`;
    console.log(`    ${label}  x${r.c}`);
  }
  console.log('');
}

const sql = db.prepare(`
  SELECT primary_material AS v, COUNT(*) AS c FROM design_library
  WHERE primary_material IS NOT NULL AND primary_material <> '' GROUP BY v
`).all();
console.log('special -> primary_material(权重10) 非空唯一值册: ' + JSON.stringify(sql));

db.close();