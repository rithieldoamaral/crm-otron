/**
 * Índice das ferramentas do AgentService.
 * Exporta definições JSON Schema (para o provider de IA) e funções de execução.
 */

export { buscarContato, buscarContatoDefinition } from "./buscarContato";
export { enviarMensagem, enviarMensagemDefinition } from "./enviarMensagem";
export { listarAgendamentos, listarAgendamentosDefinition } from "./listarAgendamentos";
export { notificarProprietario, notificarProprietarioDefinition } from "./notificarProprietario";
export { transferirParaHumano, transferirParaHumanoDefinition } from "./transferirParaHumano";
export { listarPacotes, listarPacotesDefinition } from "./listarPacotes";
export { registrarAniversario, registrarAniversarioDefinition } from "./registrarAniversario";

import { buscarContato } from "./buscarContato";
import { enviarMensagem } from "./enviarMensagem";
import { listarAgendamentos } from "./listarAgendamentos";
import { notificarProprietario } from "./notificarProprietario";
import { transferirParaHumano } from "./transferirParaHumano";
import { listarPacotes } from "./listarPacotes";
import { registrarAniversario } from "./registrarAniversario";
import { buscarContatoDefinition } from "./buscarContato";
import { enviarMensagemDefinition } from "./enviarMensagem";
import { listarAgendamentosDefinition } from "./listarAgendamentos";
import { notificarProprietarioDefinition } from "./notificarProprietario";
import { transferirParaHumanoDefinition } from "./transferirParaHumano";
import { listarPacotesDefinition } from "./listarPacotes";
import { registrarAniversarioDefinition } from "./registrarAniversario";
import { AITool } from "../providers/interfaces";
import { ALL_CALENDAR_TOOLS, executeCalendarTool } from "../../GoogleCalendarService/tools";

// Removido em 2026-04-26: `criar_agendamento` era ambíguo com `criar_evento` do
// GoogleCalendarService. LLMs baratos (GPT-OSS-120b, Llama) gravitavam para a
// versão simples, criando Schedule sem profissional e sem sincronizar Google
// Calendar. `criar_evento` é agora o único caminho de criação de agendamento.
export const ALL_AGENT_TOOLS: AITool[] = [
  buscarContatoDefinition,
  enviarMensagemDefinition,
  listarAgendamentosDefinition,
  notificarProprietarioDefinition,
  transferirParaHumanoDefinition,
  listarPacotesDefinition,
  registrarAniversarioDefinition,
  ...ALL_CALENDAR_TOOLS
];

export interface ToolExecutionContext {
  companyId: number;
  ticketId: number;
  whatsappId: number;
  contactId?: number;
}

/**
 * Executa a tool correta pelo nome, passando os argumentos e contexto.
 * Retorna o resultado como objeto para ser serializado como tool result.
 */
export async function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<{ result: Record<string, unknown> }> {
  const { companyId, ticketId, whatsappId } = ctx;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cast = (v: unknown) => v as Record<string, unknown>;

  switch (name) {
    case "buscar_contato":
      return { result: cast(await buscarContato(args as any, companyId)) };
    case "enviar_mensagem":
      return { result: cast(await enviarMensagem(args as any, companyId, whatsappId)) };
    case "listar_agendamentos":
      return { result: cast(await listarAgendamentos(args as any, companyId)) };
    case "notificar_proprietario":
      return { result: cast(await notificarProprietario(args as any, companyId)) };
    case "transferir_para_humano":
      return { result: cast(await transferirParaHumano({ ...args, ticketId } as any, companyId)) };
    case "listar_pacotes":
      return { result: cast(await listarPacotes(args, companyId)) };
    case "registrar_aniversario":
      // contactId vem do contexto (contato do ticket atual), nunca do LLM — Bug #25.
      return { result: cast(await registrarAniversario(args as any, companyId, ctx.contactId)) };
    default:
      // Delega para tools de calendário se não for tool do agente
      if (name.startsWith("listar_servicos") || name.startsWith("verificar_") ||
          name.startsWith("buscar_proximo") || name.startsWith("criar_evento") ||
          name.startsWith("cancelar_evento") || name.startsWith("reagendar_") ||
          name.startsWith("buscar_agendamento")) {
        return executeCalendarTool(name, args, companyId, ctx.contactId);
      }
      return { result: { erro: `Tool desconhecida: ${name}` } };
  }
}
