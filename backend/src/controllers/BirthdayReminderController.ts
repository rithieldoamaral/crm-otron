import { Request, Response } from "express";
import BirthdayIntelligentService from "../services/RetentionService/BirthdayIntelligentService";
import { logger } from "../utils/logger";

/**
 * Endpoint de teste manual do fluxo de aniversário.
 *
 * NOTA: a partir da Fase 2 do Módulo de Retenção, este endpoint agora
 * executa o `BirthdayIntelligentService` (3 toques: D-3, D-0+cupom, D+7)
 * ao invés do legacy `BirthdayReminderService` (apenas D-0).
 *
 * O endpoint só dispara mensagens se estivermos dentro da janela horária
 * configurada por empresa — para forçar disparo "now" durante testes,
 * ajuste temporariamente o Setting `birthdayReminderTime`.
 */
export const testBirthdayReminder = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    logger.info("[Test] Executando manualmente BirthdayIntelligentService");
    await BirthdayIntelligentService();
    return res.status(200).json({
      message: "Serviço de aniversário executado. Verifique os logs."
    });
  } catch (err) {
    logger.error(`[Test] Erro ao executar BirthdayIntelligentService: ${err}`);
    return res.status(500).json({
      error: "Erro ao executar serviço de aniversário",
      details: err instanceof Error ? err.message : String(err)
    });
  }
};


