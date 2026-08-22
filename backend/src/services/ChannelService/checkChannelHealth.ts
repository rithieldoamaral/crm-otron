import Whatsapp from "../../models/Whatsapp";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";
import { getChannelConfig } from "./channelConfig";
import { isCanalOficial } from "./types";
import { validateCredentials } from "./validateCredentials";

/**
 * Verifica se as conexões oficiais continuam realmente utilizáveis.
 *
 * POR QUE EXISTE (item 4 da auditoria): canal oficial não tem socket. Sem
 * sessão que caia, a conexão fica marcada como "Conectado" para sempre — mesmo
 * com o token revogado, a conta comercial suspensa ou a conta Twilio sem saldo.
 * O operador só descobriria por reclamação de cliente, depois de perder
 * atendimentos.
 *
 * O Baileys tem `wbotMonitor` reagindo a eventos do socket. Aqui não há evento:
 * é preciso PERGUNTAR ao provedor, periodicamente.
 *
 * CUSTO CONTROLADO: a checagem é uma consulta leve por conexão oficial (a mesma
 * do assistente), rodando a cada 15 minutos. Não é chamada a cada mensagem.
 */

/** Intervalo entre verificações. */
export const INTERVALO_MS = 15 * 60 * 1000;

/**
 * Verifica UMA conexão e atualiza o status se necessário.
 *
 * @returns true se a conexão está utilizável.
 */
export const verificarConexao = async (
  whatsapp: Whatsapp
): Promise<boolean> => {
  const config = getChannelConfig(whatsapp);

  const resultado = await validateCredentials(
    whatsapp.channelType as any,
    config
  );

  const novoStatus = resultado.valido ? "CONNECTED" : "DISCONNECTED";

  // Só escreve quando MUDA: gravar a cada ciclo geraria escrita inútil no
  // banco e um evento de socket a cada 15 minutos para cada conexão.
  if (whatsapp.status === novoStatus) return resultado.valido;

  await whatsapp.update({ status: novoStatus });

  // Queda de canal oficial é evento operacional que exige ação humana
  // (renovar token, resolver pendência na Meta) — precisa aparecer no log.
  if (!resultado.valido) {
    logger.error({
      fn: "checkChannelHealth",
      whatsappId: whatsapp.id,
      companyId: whatsapp.companyId,
      channelType: whatsapp.channelType,
      motivo: resultado.mensagem,
      msg: "Conexão oficial deixou de funcionar"
    });
  } else {
    logger.info({
      fn: "checkChannelHealth",
      whatsappId: whatsapp.id,
      companyId: whatsapp.companyId,
      msg: "Conexão oficial voltou a funcionar"
    });
  }

  // Atualiza a tela de Conexões em tempo real, como o Baileys faz.
  getIO().emit(`company-${whatsapp.companyId}-whatsappSession`, {
    action: "update",
    session: whatsapp
  });

  return resultado.valido;
};

/**
 * Verifica todas as conexões oficiais de todas as empresas.
 *
 * @returns Quantidade de conexões verificadas.
 *
 * @example
 * setInterval(() => checkChannelHealth(), INTERVALO_MS);
 */
export const checkChannelHealth = async (): Promise<number> => {
  const conexoes = await Whatsapp.findAll();

  // Baileys tem monitor próprio por evento de socket; incluí-lo aqui geraria
  // checagem redundante e concorrente com o que já existe.
  const oficiais = conexoes.filter(w => isCanalOficial(w.channelType));

  // eslint-disable-next-line no-restricted-syntax
  for (const conexao of oficiais) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await verificarConexao(conexao);
    } catch (err: any) {
      // Uma conexão com problema não pode impedir a verificação das outras —
      // inclusive porque são de empresas diferentes.
      logger.error({
        fn: "checkChannelHealth",
        whatsappId: conexao.id,
        companyId: conexao.companyId,
        err: err.message,
        msg: "Falha ao verificar conexão oficial"
      });
    }
  }

  return oficiais.length;
};

/**
 * Inicia a verificação periódica.
 *
 * @returns O timer, para que os testes possam pará-lo.
 */
export const iniciarMonitoramentoDeCanais = (): NodeJS.Timeout => {
  logger.info({
    fn: "iniciarMonitoramentoDeCanais",
    intervaloMinutos: INTERVALO_MS / 60000,
    msg: "Monitoramento de canais oficiais iniciado"
  });

  return setInterval(() => {
    checkChannelHealth().catch(err => {
      logger.error({
        fn: "iniciarMonitoramentoDeCanais",
        err: err.message,
        msg: "Ciclo de verificação falhou"
      });
    });
  }, INTERVALO_MS);
};
