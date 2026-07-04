/**
 * secretaryBriefing — briefing matinal automático do canal secretária.
 *
 * Executa a cada minuto via cron (* * * * *) em server.ts.
 * Dispara no minuto exato configurado em `secretaryBriefingTime` (padrão "08:00").
 *
 * Idempotência: chave Redis `secretary:briefing_sent:{companyId}:{YYYY-MM-DD}`
 * com TTL de 12h (43 200s) garante envio único por empresa/dia, mesmo que o
 * servidor reinicie ou o cron dispare duas vezes no mesmo minuto.
 *
 * Conteúdo do briefing:
 *   ☀️ Cabeçalho com data por extenso
 *   📅 Agendamentos do dia (até 5 listados, resto como "+ N outros")
 *   🎫 Tickets abertos + em espera longa (> 2h)
 *   ✅ Tickets fechados ontem
 */

import { Op } from "sequelize";
import Company  from "../../models/Company";
import Whatsapp from "../../models/Whatsapp";
import Ticket   from "../../models/Ticket";
import Schedule from "../../models/Schedule";
import Contact  from "../../models/Contact";
import User     from "../../models/User";
import { getSettingsByCompany } from "../AgentService/settingsCache";
import { getWbot }              from "../../libs/wbot";
import { get as redisGet, set as redisSet } from "../../libs/cache";
import { logger }               from "../../utils/logger";
import { canonicalizePhone }    from "./phoneMatch";

// ── Constantes ──────────────────────────────────────────────────────────────

const BRIEFING_TTL_SECONDS    = 43_200; // 12 horas
const MAX_AGENDAMENTOS_LISTA  = 5;      // máximo exibido antes do "+ N outros"
const ESPERA_LONGA_MS         = 2 * 60 * 60 * 1_000; // 2h em ms
const DEFAULT_BRIEFING_TIME   = "08:00";

// ── Helpers internos ────────────────────────────────────────────────────────

/** Formata Date para "HH:MM". */
function toHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Data no formato ISO YYYY-MM-DD (fuso local). */
function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Chave Redis de idempotência por empresa/dia. */
function briefingKey(companyId: number, dateStr: string): string {
  return `secretary:briefing_sent:${companyId}:${dateStr}`;
}

/**
 * Monta a mensagem de briefing em texto rico para WhatsApp.
 * Recebe os dados já coletados para manter a função pura/testável.
 */
function buildBriefingMessage(
  agendamentos: any[],
  ticketsAbertos: number,
  ticketsEsperaLonga: number,
  fechadosOntem: number
): string {
  const now     = new Date();
  const dateStr = now.toLocaleDateString("pt-BR", {
    weekday: "long", day: "numeric", month: "long"
  });

  const lines: string[] = [
    `☀️ *Bom dia! Resumo do dia — ${dateStr}*`,
    "",
    `📅 *Agendamentos hoje:* ${agendamentos.length}`,
  ];

  if (agendamentos.length > 0) {
    const exibidos = agendamentos.slice(0, MAX_AGENDAMENTOS_LISTA);
    for (const s of exibidos) {
      const hora    = toHHMM(new Date(s.sendAt));
      const cliente = s.contact?.name ?? "—";
      lines.push(`  • ${hora} — ${cliente}`);
    }
    const restantes = agendamentos.length - MAX_AGENDAMENTOS_LISTA;
    if (restantes > 0) {
      lines.push(`  _+ ${restantes} outros_`);
    }
  }

  lines.push("");
  const espera = ticketsEsperaLonga > 0 ? ` _(${ticketsEsperaLonga} em espera longa)_` : "";
  lines.push(`🎫 *Tickets abertos:* ${ticketsAbertos}${espera}`);
  lines.push(`✅ *Fechados ontem:* ${fechadosOntem}`);

  return lines.join("\n");
}

// ── Função principal ─────────────────────────────────────────────────────────

/**
 * Gera e envia o briefing matinal para uma empresa específica.
 *
 * @param companyId    - ID da empresa (multi-tenant)
 * @param whatsapp     - Canal secretária da empresa
 * @param adminNumbers - Números que receberão o briefing
 * @returns true se o briefing foi enviado, false se já havia sido enviado hoje
 */
export async function generateMorningBriefing(
  companyId: number,
  whatsapp: any,
  adminNumbers: string[]
): Promise<boolean> {
  const now     = new Date();
  const today   = toDateStr(now);
  const redisKey = briefingKey(companyId, today);

  // Idempotência: aborta se já enviou hoje
  const alreadySent = await redisGet(redisKey);
  if (alreadySent) return false;

  // ── Coleta de dados (paralela) ────────────────────────────────────────────

  const inicioDia = new Date(now);
  inicioDia.setHours(0, 0, 0, 0);
  const fimDia = new Date(now);
  fimDia.setHours(23, 59, 59, 999);

  const inicioDiaOntem = new Date(inicioDia);
  inicioDiaOntem.setDate(inicioDiaOntem.getDate() - 1);
  const fimDiaOntem = new Date(fimDia);
  fimDiaOntem.setDate(fimDiaOntem.getDate() - 1);

  const limiarEspera = new Date(Date.now() - ESPERA_LONGA_MS);

  const [agendamentos, ticketsAbertos, ticketsEsperaLonga, fechadosOntem] = await Promise.all([
    Schedule.findAll({
      where: {
        companyId,
        sendAt: { [(Op as any).between]: [inicioDia, fimDia] }
      },
      include: [
        { model: Contact, as: "contact", attributes: ["name"] },
        { model: User,    as: "user",    attributes: ["name"] }
      ],
      order: [["sendAt", "ASC"]]
    }),
    Ticket.count({ where: { companyId, status: "open" } }),
    Ticket.count({ where: { companyId, status: "open", updatedAt: { [Op.lt]: limiarEspera } } }),
    Ticket.count({
      where: {
        companyId,
        status: "closed",
        updatedAt: { [(Op as any).between]: [inicioDiaOntem, fimDiaOntem] }
      }
    }),
  ]);

  // ── Monta e envia a mensagem ──────────────────────────────────────────────

  const message = buildBriefingMessage(
    agendamentos as any[],
    ticketsAbertos,
    ticketsEsperaLonga,
    fechadosOntem
  );

  try {
    const wbot = getWbot(whatsapp.id);
    await Promise.all(
      adminNumbers.map(number => {
        // Canonicaliza o número antes de montar o JID de destino: o cadastro
        // pode ter o 9º dígito brasileiro (5548988368758) enquanto o JID real
        // do WhatsApp trafega sem ele (554888368758). Enviar na forma canônica
        // (sem o 9, com código de país) garante a entrega. Ver phoneMatch.ts.
        const jid = `${canonicalizePhone(number)}@s.whatsapp.net`;
        return wbot.sendMessage(jid, { text: message }).catch((err: any) => {
          logger.warn(`SecretaryBriefing: falha ao enviar para ${number}: ${err.message}`);
        });
      })
    );
  } catch (err: any) {
    logger.warn(`SecretaryBriefing: wbot indisponível (whatsapp ${whatsapp.id}): ${err.message}`);
  }

  // Marca como enviado (TTL 12h — cobre o dia inteiro com folga)
  await redisSet(redisKey, "1", "EX", BRIEFING_TTL_SECONDS);

  return true;
}

// ── Orquestrador (chamado pelo cron) ─────────────────────────────────────────

/**
 * Ponto de entrada chamado pelo cron a cada minuto (* * * * *).
 * Para cada empresa ativa com canal secretária:
 *   1. Verifica se o horário atual bate com `secretaryBriefingTime`
 *   2. Se sim, delega para `generateMorningBriefing` (Redis evita duplo envio)
 */
export async function runMorningBriefings(): Promise<void> {
  const now         = new Date();
  const currentTime = toHHMM(now); // "HH:MM"

  try {
    const companies = await Company.findAll({ where: { status: true } });

    await Promise.all(
      companies.map(async (company: any) => {
        try {
          const whatsapp = await Whatsapp.findOne({
            where: { companyId: company.id, isSecretaryChannel: true }
          });

          if (!whatsapp) return;

          const rows = await getSettingsByCompany(company.id);
          const map  = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));

          const adminRaw: string     = map.secretaryAdminNumbers ?? "";
          const adminNumbers         = adminRaw.split(",").map((n: string) => n.trim()).filter(Boolean);
          const briefingTime: string = map.secretaryBriefingTime ?? DEFAULT_BRIEFING_TIME;

          // Só processa empresas com admins configurados e no horário exato
          if (adminNumbers.length === 0) return;
          if (currentTime !== briefingTime) return;

          await generateMorningBriefing(company.id, whatsapp, adminNumbers);
        } catch (err: any) {
          logger.error(`SecretaryBriefing: erro na empresa ${company.id}: ${err.message}`);
        }
      })
    );
  } catch (err: any) {
    logger.error(`SecretaryBriefing: erro fatal: ${err.message}`);
  }
}
