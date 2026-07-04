import "../bootstrap";

module.exports = {
  define: {
    charset: "utf8mb4",
    collate: "utf8mb4_bin"
  },
  dialect: process.env.DB_DIALECT || "mysql",
  timezone: "-03:00",
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  logging: process.env.DB_DEBUG === "true",
  // Escalabilidade (P0): pool padrão do Sequelize = 5 conexões.
  // Com 20 clientes simultâneos × ~15 queries/turno = starvation imediata.
  // max: 30 → comporta ~20 clientes com headroom para picos.
  // acquire: 30000 → cliente aguarda no máximo 30s antes de receber erro
  //   (evita que fila cresça indefinidamente em caso de pico extremo).
  // idle: 10000 → conexões ociosas por 10s são fechadas (libera recursos MySQL).
  pool: {
    max: 30,
    min: 2,
    acquire: 30000,
    idle: 10000
  }
};
