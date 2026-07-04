import { Request, Response } from "express";
import Contact from "../models/Contact";
import { resumirCliente } from "../services/SecretaryService/tools/resumirCliente";
import AppError from "../errors/AppError";

/**
 * POST /contacts/:contactId/summarize
 * Gera um resumo inteligente do cliente via sub-LLM (resumirCliente tool).
 * Retorna bullet points com histórico de atendimento e pendências.
 */
export const summarizeContact = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { contactId } = req.params;
  const { companyId } = req.user;

  const contact = await Contact.findOne({
    where: { id: Number(contactId), companyId },
    attributes: ["id", "name", "number"],
  });

  if (!contact) {
    throw new AppError("ERR_CONTACT_NOT_FOUND", 404);
  }

  const result = await resumirCliente(
    { cliente: (contact as any).number || (contact as any).name },
    companyId
  );

  return res.json(result);
};
