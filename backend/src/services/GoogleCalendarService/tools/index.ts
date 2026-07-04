/**
 * Índice das tools do Google Calendar.
 * Exporta definições e função de dispatch para AgentService e SecretaryService.
 */

export { listarServicos, listarServicosDefinition } from "./listarServicos";
export { verificarDisponibilidade, verificarDisponibilidadeDefinition } from "./verificarDisponibilidade";
export { buscarProximoHorario, buscarProximoHorarioDefinition } from "./buscarProximoHorario";
export { criarEvento, criarEventoDefinition } from "./criarEvento";
export { cancelarEvento, cancelarEventoDefinition } from "./cancelarEvento";
export { reagendarEvento, reagendarEventoDefinition } from "./reagendarEvento";
export { buscarAgendamentoCliente, buscarAgendamentoClienteDefinition } from "./buscarAgendamentoCliente";

import { listarServicos } from "./listarServicos";
import { verificarDisponibilidade } from "./verificarDisponibilidade";
import { buscarProximoHorario } from "./buscarProximoHorario";
import { criarEvento } from "./criarEvento";
import { cancelarEvento } from "./cancelarEvento";
import { reagendarEvento } from "./reagendarEvento";
import { buscarAgendamentoCliente } from "./buscarAgendamentoCliente";
import {
  listarServicosDefinition, verificarDisponibilidadeDefinition,
  buscarProximoHorarioDefinition, criarEventoDefinition,
  cancelarEventoDefinition, reagendarEventoDefinition,
  buscarAgendamentoClienteDefinition
} from "./index";
import { AITool } from "../../AgentService/providers/interfaces";

export const ALL_CALENDAR_TOOLS: AITool[] = [
  listarServicosDefinition as AITool,
  verificarDisponibilidadeDefinition as AITool,
  buscarProximoHorarioDefinition as AITool,
  criarEventoDefinition as AITool,
  cancelarEventoDefinition as AITool,
  reagendarEventoDefinition as AITool,
  buscarAgendamentoClienteDefinition as AITool
];

export async function executeCalendarTool(
  name: string,
  args: Record<string, unknown>,
  companyId: number,
  contactId?: number
): Promise<{ result: Record<string, unknown> }> {
  const cast = (v: unknown) => v as Record<string, unknown>;
  switch (name) {
    case "listar_servicos":
      return { result: cast(await listarServicos(args, companyId)) };
    case "verificar_disponibilidade":
      return { result: cast(await verificarDisponibilidade(args as any, companyId)) };
    case "buscar_proximo_horario":
      return { result: cast(await buscarProximoHorario(args as any, companyId)) };
    case "criar_evento":
      return { result: cast(await criarEvento({ ...args as any, contactId: (args as any).contactId ?? contactId }, companyId)) };
    case "cancelar_evento":
      return { result: cast(await cancelarEvento(args as any, companyId)) };
    case "reagendar_evento":
      return { result: cast(await reagendarEvento(args as any, companyId)) };
    case "buscar_agendamento_cliente":
      // Bug #25 (Round 9): contactId SEMPRE do contexto — LLM não conhece o ID
      // interno do contato, só nome/número. Ignorar qualquer valor que o LLM
      // possa ter passado nos args para evitar uso de contactId errado.
      return { result: cast(await buscarAgendamentoCliente({ contactId: contactId! }, companyId)) };
    default:
      return { result: { erro: `Tool de calendário desconhecida: ${name}` } };
  }
}
