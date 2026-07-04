/**
 * Índice das ferramentas do SecretaryService.
 */

export { consultarAtendimentos, consultarAtendimentosDefinition } from "./consultarAtendimentos";
export { consultarCatalogo, consultarCatalogoDefinition } from "./consultarCatalogo";
export { buscarTicket, buscarTicketDefinition } from "./buscarTicket";
export { consultarContatos, consultarContatosDefinition } from "./consultarContatos";
export { enviarMensagemParaCliente, enviarMensagemParaClienteDefinition } from "./enviarMensagemParaCliente";
export { consultarAgendamentos, consultarAgendamentosDefinition } from "./consultarAgendamentos";
export { consultarUsuarios, consultarUsuariosDefinition } from "./consultarUsuarios";
export { fecharTicket, fecharTicketDefinition } from "./fecharTicket";
export { transferirTicket, transferirTicketDefinition } from "./transferirTicket";
export { consultarMetricas, consultarMetricasDefinition } from "./consultarMetricas";
export { detectarConversasCriticas, detectarConversasCriticasDefinition } from "./detectarConversasCriticas";
export { cancelarAgendamento, cancelarAgendamentoDefinition } from "./cancelarAgendamento";
export { reagendarAgendamento, reagendarAgendamentoDefinition } from "./reagendarAgendamento";
export { relatorioAgente, relatorioAgenteDefinition } from "./relatorioAgente";
export { reabrirTicket, reabrirTicketDefinition } from "./reabrirTicket";
export { resumirCliente, resumirClienteDefinition } from "./resumirCliente";
export { gerarMensagemContextualizada, gerarMensagemContextualizadaDefinition } from "./gerarMensagemContextualizada";
export { listarPacotes, listarPacotesDefinition } from "./listarPacotes";
export { verSaldoPacote, verSaldoPacoteDefinition } from "./verSaldoPacote";
export { consultarFaturamento, consultarFaturamentoDefinition } from "./consultarFaturamento";
export { topClientesPorValor, topClientesPorValorDefinition } from "./topClientesPorValor";
export { topServicosPorReceita, topServicosPorReceitaDefinition } from "./topServicosPorReceita";
export { diaMaisLucrativo, diaMaisLucrativoDefinition } from "./diaMaisLucrativo";
export { compararPeriodos, compararPeriodosDefinition } from "./compararPeriodos";

import { consultarAtendimentos } from "./consultarAtendimentos";
import { consultarCatalogo } from "./consultarCatalogo";
import { buscarTicket } from "./buscarTicket";
import { consultarContatos } from "./consultarContatos";
import { enviarMensagemParaCliente } from "./enviarMensagemParaCliente";
import { consultarAgendamentos } from "./consultarAgendamentos";
import { consultarUsuarios } from "./consultarUsuarios";
import { fecharTicket } from "./fecharTicket";
import { transferirTicket } from "./transferirTicket";
import { consultarMetricas } from "./consultarMetricas";
import { detectarConversasCriticas } from "./detectarConversasCriticas";
import { cancelarAgendamento } from "./cancelarAgendamento";
import { reagendarAgendamento } from "./reagendarAgendamento";
import { relatorioAgente } from "./relatorioAgente";
import { reabrirTicket } from "./reabrirTicket";
import { resumirCliente } from "./resumirCliente";
import { gerarMensagemContextualizada } from "./gerarMensagemContextualizada";
import { listarPacotes } from "./listarPacotes";
import { verSaldoPacote } from "./verSaldoPacote";
import { consultarFaturamento } from "./consultarFaturamento";
import { topClientesPorValor } from "./topClientesPorValor";
import { topServicosPorReceita } from "./topServicosPorReceita";
import { diaMaisLucrativo } from "./diaMaisLucrativo";
import { compararPeriodos } from "./compararPeriodos";

import {
  consultarAtendimentosDefinition,
  consultarCatalogoDefinition,
  buscarTicketDefinition,
  consultarContatosDefinition,
  enviarMensagemParaClienteDefinition,
  consultarAgendamentosDefinition,
  consultarUsuariosDefinition,
  fecharTicketDefinition,
  transferirTicketDefinition,
  consultarMetricasDefinition,
  detectarConversasCriticasDefinition,
  cancelarAgendamentoDefinition,
  reagendarAgendamentoDefinition,
  relatorioAgenteDefinition,
  reabrirTicketDefinition,
  resumirClienteDefinition,
  gerarMensagemContextualizadaDefinition,
  listarPacotesDefinition,
  verSaldoPacoteDefinition,
  consultarFaturamentoDefinition,
  topClientesPorValorDefinition,
  topServicosPorReceitaDefinition,
  diaMaisLucrativoDefinition,
  compararPeriodosDefinition,
} from "./index";

import { AITool } from "../../AgentService/providers/interfaces";

export const ALL_SECRETARY_TOOLS: AITool[] = [
  consultarAtendimentosDefinition as AITool,
  consultarCatalogoDefinition as AITool,
  buscarTicketDefinition as AITool,
  consultarContatosDefinition as AITool,
  enviarMensagemParaClienteDefinition as AITool,
  consultarAgendamentosDefinition as AITool,
  consultarUsuariosDefinition as AITool,
  fecharTicketDefinition as AITool,
  transferirTicketDefinition as AITool,
  consultarMetricasDefinition as AITool,
  detectarConversasCriticasDefinition as AITool,
  cancelarAgendamentoDefinition as AITool,
  reagendarAgendamentoDefinition as AITool,
  relatorioAgenteDefinition as AITool,
  reabrirTicketDefinition as AITool,
  resumirClienteDefinition as AITool,
  gerarMensagemContextualizadaDefinition as AITool,
  listarPacotesDefinition as AITool,
  verSaldoPacoteDefinition as AITool,
  consultarFaturamentoDefinition as AITool,
  topClientesPorValorDefinition as AITool,
  topServicosPorReceitaDefinition as AITool,
  diaMaisLucrativoDefinition as AITool,
  compararPeriodosDefinition as AITool,
];

export async function executeSecretaryTool(
  name: string,
  args: Record<string, unknown>,
  companyId: number
): Promise<{ result: Record<string, unknown> }> {
  const cast = (v: unknown) => v as Record<string, unknown>;

  switch (name) {
    case "consultar_atendimentos":
      return { result: cast(await consultarAtendimentos(args as any, companyId)) };
    case "consultar_catalogo":
      return { result: cast(await consultarCatalogo(args as any, companyId)) };
    case "buscar_ticket":
      return { result: cast(await buscarTicket(args as any, companyId)) };
    case "consultar_contatos":
      return { result: cast(await consultarContatos(args as any, companyId)) };
    case "enviar_mensagem_para_cliente":
      return { result: cast(await enviarMensagemParaCliente(args as any, companyId)) };
    case "consultar_agendamentos":
      return { result: cast(await consultarAgendamentos(args as any, companyId)) };
    case "consultar_usuarios":
      return { result: cast(await consultarUsuarios(args as any, companyId)) };
    case "fechar_ticket":
      return { result: cast(await fecharTicket(args as any, companyId)) };
    case "transferir_ticket":
      return { result: cast(await transferirTicket(args as any, companyId)) };
    case "consultar_metricas":
      return { result: cast(await consultarMetricas(args as any, companyId)) };
    case "detectar_conversas_criticas":
      return { result: cast(await detectarConversasCriticas(args as any, companyId)) };
    case "cancelar_agendamento":
      return { result: cast(await cancelarAgendamento(args as any, companyId)) };
    case "reagendar_agendamento":
      return { result: cast(await reagendarAgendamento(args as any, companyId)) };
    case "relatorio_agente":
      return { result: cast(await relatorioAgente(args as any, companyId)) };
    case "reabrir_ticket":
      return { result: cast(await reabrirTicket(args as any, companyId)) };
    case "resumir_cliente":
      return { result: cast(await resumirCliente(args as any, companyId)) };
    case "gerar_mensagem_contextualizada":
      return { result: cast(await gerarMensagemContextualizada(args as any, companyId)) };
    case "listar_pacotes":
      return { result: cast(await listarPacotes(args as any, companyId)) };
    case "ver_saldo_pacote":
      return { result: cast(await verSaldoPacote(args as any, companyId)) };
    case "consultar_faturamento":
      return { result: cast(await consultarFaturamento(args as any, companyId)) };
    case "top_clientes_por_valor":
      return { result: cast(await topClientesPorValor(args as any, companyId)) };
    case "top_servicos_por_receita":
      return { result: cast(await topServicosPorReceita(args as any, companyId)) };
    case "dia_mais_lucrativo":
      return { result: cast(await diaMaisLucrativo(args as any, companyId)) };
    case "comparar_periodos":
      return { result: cast(await compararPeriodos(args as any, companyId)) };
    default:
      return { result: { erro: `Tool desconhecida: ${name}` } };
  }
}
