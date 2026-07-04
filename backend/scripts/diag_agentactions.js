/**
 * Diagnóstico: imprime as AgentActions (tool calls do agente) de um ticket.
 * Fonte de verdade para depurar comportamento agêntico — mostra, por turno,
 * qual ferramenta foi chamada, com quais parâmetros e qual resultado.
 *
 * Uso:
 *   node scripts/diag_agentactions.js <ticketId> [limit]
 * Ex:  node scripts/diag_agentactions.js 22 40
 *
 * Lê credenciais do .env do backend. Apenas SELECT (read-only).
 */
require("dotenv").config({ path: __dirname + "/../.env" });
const { Client } = require("pg");

const ticketId = Number(process.argv[2] || 0);
const limit = Number(process.argv[3] || 40);

if (!ticketId) {
  console.error("Uso: node scripts/diag_agentactions.js <ticketId> [limit]");
  process.exit(1);
}

(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });
  await c.connect();
  const r = await c.query(
    `SELECT id, action, parameters, result, success, "createdAt"
     FROM "AgentActions" WHERE "ticketId"=$1 ORDER BY "createdAt" DESC LIMIT $2`,
    [ticketId, limit]
  );
  console.log(`ticket=${ticketId} rows=${r.rows.length}`);
  for (const row of r.rows.reverse()) {
    console.log("—".repeat(54));
    console.log(`#${row.id} ${row.action} success=${row.success} [${row.createdAt}]`);
    console.log("  params:", JSON.stringify(row.parameters));
    const res = JSON.stringify(row.result);
    console.log("  result:", res && res.length > 480 ? res.slice(0, 480) + "…" : res);
  }
  await c.end();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
