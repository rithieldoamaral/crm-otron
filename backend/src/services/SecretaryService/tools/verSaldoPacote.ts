/**
 * Tool: ver_saldo_pacote
 *
 * Permite ao agente secretária (AI) consultar o saldo de sessões de um cliente,
 * para responder perguntas sobre quantas sessões ainda restam no pacote.
 *
 * Exemplos de uso pelo agente:
 *   - "Quantas sessões eu ainda tenho no meu pacote?"
 *   - "Posso agendar mais uma sessão de laser hoje?"
 *   - "Meu pacote ainda está ativo?"
 *
 * Fase 6 — Pacotes de Sessões.
 */

import ClientPackagePurchase from "../../../models/ClientPackagePurchase";
import Package from "../../../models/Package";
import Contact from "../../../models/Contact";
import {
  calculateSessionsRemaining,
  derivePackageStatus,
} from "../../PackageService/PackageService.utils";

interface VerSaldoPacoteArgs {
  /** ID do contato (cliente) — obrigatório */
  contactId: number;
}

interface SaldoPacoteItem {
  purchaseId: number;
  nomePacote: string;
  nomeServico: string | null;
  totalSessoes: number;
  sessoesUsadas: number;
  sessoesRestantes: number;
  status: string;
  expiresAt: string | null;
}

interface VerSaldoPacoteResult {
  comprasAtivas: SaldoPacoteItem[];
  comprasEncerradas: SaldoPacoteItem[];
  temPacoteAtivo: boolean;
  /** Resumo formatado pronto para enviar ao cliente */
  resumo: string;
}

/**
 * Retorna o saldo de sessões de todos os pacotes de um cliente.
 *
 * @param args      - { contactId: number }
 * @param companyId - ID da empresa (JWT do agente)
 * @returns Saldo de sessões ativas e encerradas com resumo em texto
 */
export async function verSaldoPacote(
  args: VerSaldoPacoteArgs,
  companyId: number
): Promise<VerSaldoPacoteResult> {
  const { contactId } = args;

  // Busca contato para pegar o nome
  const contact = await Contact.findOne({
    where: { id: contactId, companyId },
    attributes: ["id", "name"],
  });

  const clientName = contact?.name ?? "cliente";

  // Busca todas as compras do cliente
  const purchases = await ClientPackagePurchase.findAll({
    where: { companyId, contactId },
    include: [
      {
        model: Package,
        attributes: ["id", "name"],
        required: false,
      },
    ],
    order: [["purchasedAt", "DESC"]],
  });

  if (purchases.length === 0) {
    return {
      comprasAtivas: [],
      comprasEncerradas: [],
      temPacoteAtivo: false,
      resumo: `${clientName} não possui nenhum pacote de sessões cadastrado.`,
    };
  }

  const comprasAtivas: SaldoPacoteItem[] = [];
  const comprasEncerradas: SaldoPacoteItem[] = [];

  for (const p of purchases as any[]) {
    // Re-deriva status em tempo real (pode ter expirado desde o último update)
    const statusAtual = derivePackageStatus(
      p.sessionsUsed,
      p.totalSessions,
      p.expiresAt ?? null
    );

    const remaining = calculateSessionsRemaining(p.totalSessions, p.sessionsUsed);
    const nomePacote = p.package?.name ?? p.serviceName ?? "Pacote";

    const item: SaldoPacoteItem = {
      purchaseId: p.id,
      nomePacote,
      nomeServico: p.serviceName ?? null,
      totalSessoes: p.totalSessions,
      sessoesUsadas: p.sessionsUsed,
      sessoesRestantes: remaining,
      status: statusAtual,
      expiresAt: p.expiresAt ? p.expiresAt.toISOString().split("T")[0] : null,
    };

    if (statusAtual === "active") {
      comprasAtivas.push(item);
    } else {
      comprasEncerradas.push(item);
    }
  }

  // Monta resumo legível
  let resumo = "";

  if (comprasAtivas.length === 0) {
    resumo =
      `${clientName} não possui nenhum pacote ativo no momento. ` +
      `Todos os pacotes foram concluídos ou expiraram.`;
  } else {
    const linhas = comprasAtivas.map((c) => {
      const validade = c.expiresAt ? ` (válido até ${c.expiresAt})` : "";
      const sessaoWord = c.sessoesRestantes === 1 ? "sessão" : "sessões";
      return (
        `• *${c.nomePacote}*: *${c.sessoesRestantes} ${sessaoWord}* restantes` +
        ` (${c.sessoesUsadas}/${c.totalSessoes} usadas)${validade}`
      );
    });

    resumo = `Olá, ${clientName}! Aqui está o saldo dos seus pacotes:\n\n${linhas.join("\n")}`;

    if (comprasEncerradas.length > 0) {
      resumo += `\n\n_${comprasEncerradas.length} pacote(s) encerrado(s) não listado(s)._`;
    }
  }

  return {
    comprasAtivas,
    comprasEncerradas,
    temPacoteAtivo: comprasAtivas.length > 0,
    resumo,
  };
}

export const verSaldoPacoteDefinition = {
  name: "ver_saldo_pacote",
  description:
    "Consulta o saldo de sessões dos pacotes de um cliente. Use quando o cliente perguntar quantas sessões tem disponíveis, se o pacote ainda está ativo, ou antes de agendar uma sessão para verificar se há créditos.",
  parameters: {
    type: "object",
    properties: {
      contactId: {
        type: "number",
        description: "ID do contato (cliente) para consultar o saldo de pacotes",
      },
    },
    required: ["contactId"],
  },
};
