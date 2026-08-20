/**
 * Testes da tool `notificar_proprietario`.
 *
 * Por que existem: o número do proprietário era usado com um simples
 * `replace(/\D/g, "")`, sem canonicalização. Como a tela da Secretária ensina
 * o formato SEM DDI ("48988368758") e este campo esperava COM DDI
 * ("5548988368758"), quem seguisse a convenção da outra tela gerava um JID
 * inválido: a mensagem não chegava e ainda era criado um Contact lixo — falha
 * TOTALMENTE silenciosa, porque a tool respondia "sucesso" ao agente.
 *
 * O primeiro teste abaixo trava exatamente esse caso.
 */

import { canonicalizePhone } from "../../../SecretaryService/phoneMatch";
import Whatsapp from "../../../../models/Whatsapp";
import Setting from "../../../../models/Setting";
import Contact from "../../../../models/Contact";
import FindOrCreateTicketService from "../../../TicketServices/FindOrCreateTicketService";
import SendWhatsAppMessage from "../../../WbotServices/SendWhatsAppMessage";
import { notificarProprietario } from "../notificarProprietario";

jest.mock("../../../../models/Whatsapp", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock("../../../../models/Setting", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock("../../../../models/Contact", () => ({
  __esModule: true,
  default: { findOrCreate: jest.fn() }
}));
jest.mock("../../../TicketServices/FindOrCreateTicketService", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../../WbotServices/SendWhatsAppMessage", () => ({
  __esModule: true,
  default: jest.fn()
}));

const COMPANY_ID = 1;

/** Configura o cenário feliz: canal conectado, ticket e envio funcionando. */
const prepararCenario = (settings: Record<string, string>) => {
  (Setting.findOne as jest.Mock).mockImplementation(
    ({ where }: { where: { key: string } }) =>
      Promise.resolve(
        settings[where.key] !== undefined
          ? { value: settings[where.key] }
          : null
      )
  );
  (Whatsapp.findOne as jest.Mock).mockResolvedValue({ id: 7 });
  (Contact.findOrCreate as jest.Mock).mockResolvedValue([{ id: 99 }]);
  (FindOrCreateTicketService as jest.Mock).mockResolvedValue({ id: 42 });
  (SendWhatsAppMessage as jest.Mock).mockResolvedValue(undefined);
};

/** Número com que o Contact foi procurado/criado. */
const numeroUsado = (): string =>
  (Contact.findOrCreate as jest.Mock).mock.calls[0][0].where.number;

describe("notificarProprietario", () => {
  beforeEach(() => jest.clearAllMocks());

  it("canonicaliza número salvo SEM DDI (formato que a tela da Secretária ensina)", async () => {
    prepararCenario({ agentOwnerNumber: "48988368758" });

    const r = await notificarProprietario({ mensagem: "teste" }, COMPANY_ID);

    expect(r.sucesso).toBe(true);
    // Sem canonicalizar, seria "48988368758" — JID inválido, entrega silenciosa.
    expect(numeroUsado()).toBe(canonicalizePhone("48988368758"));
    expect(numeroUsado()).toBe("554888368758");
  });

  it("aceita o mesmo número COM DDI e chega ao MESMO contato", async () => {
    prepararCenario({ agentOwnerNumber: "5548988368758" });

    await notificarProprietario({ mensagem: "teste" }, COMPANY_ID);

    // O ponto central: os dois formatos convergem para uma chave só, então
    // não se cria um Contact duplicado para a mesma pessoa.
    expect(numeroUsado()).toBe("554888368758");
  });

  it("tolera número com máscara", async () => {
    prepararCenario({ agentOwnerNumber: "(48) 98836-8758" });

    await notificarProprietario({ mensagem: "teste" }, COMPANY_ID);

    expect(numeroUsado()).toBe("554888368758");
  });

  it("usa o primeiro número de admin da Secretária quando o campo está vazio", async () => {
    prepararCenario({
      agentOwnerNumber: "",
      secretaryAdminNumbers: "48988368758, 11999998888"
    });

    const r = await notificarProprietario({ mensagem: "teste" }, COMPANY_ID);

    expect(r.sucesso).toBe(true);
    expect(numeroUsado()).toBe("554888368758");
  });

  it("falha explicitamente quando não há proprietário NEM admin cadastrado", async () => {
    prepararCenario({ agentOwnerNumber: "", secretaryAdminNumbers: "" });

    const r = await notificarProprietario({ mensagem: "teste" }, COMPANY_ID);

    expect(r.sucesso).toBe(false);
    expect(SendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("não envia quando o canal do agente está desconectado", async () => {
    prepararCenario({ agentOwnerNumber: "5548988368758" });
    (Whatsapp.findOne as jest.Mock).mockResolvedValue(null);

    const r = await notificarProprietario({ mensagem: "teste" }, COMPANY_ID);

    expect(r.sucesso).toBe(false);
    expect(SendWhatsAppMessage).not.toHaveBeenCalled();
  });
});
