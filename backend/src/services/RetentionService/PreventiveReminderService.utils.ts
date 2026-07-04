/**
 * PreventiveReminderService — lógica PURA, sem dependências de I/O.
 *
 * Isolada para testes unitários sem Sequelize, WhatsApp ou cron.
 * A orquestração I/O vive em `PreventiveReminderService.ts`.
 *
 * Responsabilidades:
 *   - `shouldFirePreventive`  — decide se o toque deve ser disparado
 *   - `buildPreventiveMessage` — monta a mensagem proativa
 */

import { DormantStatusType } from "./DormantDetectionService";

// ── Constantes ─────────────────────────────────────────────────────

/** Ratio mínimo para disparar o lembrete preventivo (default). */
export const DEFAULT_PREVENTIVE_THRESHOLD = 0.8;

/** Ratio máximo — acima disso o cliente já está "atrasado" (não é mais preventivo). */
export const DEFAULT_PREVENTIVE_CEILING = 1.0;

// ── Types ──────────────────────────────────────────────────────────

export interface PreventiveDecisionInput {
  /** Status atual do cliente (DormantDetectionService) */
  status: DormantStatusType;
  /** Ratio (daysSinceLastService / avgInterval) */
  ratio: number;
  /** Já existe um toque preventivo neste ciclo? */
  alreadyTouchedThisCycle: boolean;
  /** Total de serviços do contato (precisa de pelo menos 2 para ter intervalo médio confiável) */
  totalServices: number;
}

export interface PreventiveMessageParams {
  contactName: string;
  /** Template configurado pelo admin (suporta {{name}}, {{dias}}, {{nome}}) */
  template?: string;
  /** Dias desde o último serviço */
  daysSinceLastService: number;
}

// ── Funções Puras ──────────────────────────────────────────────────

/**
 * Decide se o toque preventivo deve ser disparado para um contato.
 *
 * Critérios (TODOS devem ser verdadeiros):
 *   1. Status é "quase_na_hora" (entre 0.8 e 1.0 do intervalo médio)
 *   2. Ratio entre threshold e ceiling
 *   3. Não foi disparado neste ciclo (UNIQUE no banco também garante)
 *   4. Cliente tem histórico mínimo (≥ 2 serviços) — intervalo médio precisa de
 *      pelo menos 1 par para ser significativo
 *
 * @param input Dados de decisão
 * @param threshold Ratio mínimo (default: 0.8)
 * @param ceiling Ratio máximo (default: 1.0)
 * @returns true se deve disparar, false caso contrário
 *
 * @example
 *   shouldFirePreventive({ status: "quase_na_hora", ratio: 0.85, alreadyTouchedThisCycle: false, totalServices: 3 })
 *   // → true
 */
export function shouldFirePreventive(
  input: PreventiveDecisionInput,
  threshold: number = DEFAULT_PREVENTIVE_THRESHOLD,
  ceiling: number = DEFAULT_PREVENTIVE_CEILING
): boolean {
  if (input.alreadyTouchedThisCycle) return false;
  if (input.totalServices < 2) return false;
  if (input.status !== "quase_na_hora") return false;
  if (input.ratio < threshold) return false;
  if (input.ratio >= ceiling) return false;
  return true;
}

/**
 * Monta a mensagem proativa de lembrete preventivo.
 *
 * Se o admin configurou template, usa-o substituindo:
 *   {{name}}, {{nome}} — nome do contato
 *   {{dias}}            — dias desde último serviço
 *
 * Sem template, usa mensagem padrão amigável.
 *
 * @param params Dados para montar a mensagem
 * @returns Texto pronto para envio via WhatsApp
 *
 * @example
 *   buildPreventiveMessage({ contactName: "Maria", daysSinceLastService: 25 })
 *   // → "Olá, Maria! Faz 25 dias..."
 */
export function buildPreventiveMessage(params: PreventiveMessageParams): string {
  const name = params.contactName || "Cliente";
  const dias = params.daysSinceLastService;

  if (params.template && params.template.trim().length > 0) {
    return params.template
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{nome\}\}/g, name)
      .replace(/\{\{dias\}\}/g, String(dias));
  }

  // Mensagem padrão (fallback) — quando admin não configurou
  return (
    `Olá, ${name}! 😊 Faz ${dias} dias desde sua última visita. ` +
    `Sentimos sua falta! Que tal agendar um horário esta semana? ` +
    `Estamos à disposição. ❤️`
  );
}
