import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Step,
  StepLabel,
  Stepper,
  makeStyles
} from "@material-ui/core";
import { toast } from "react-toastify";

import api from "../../services/api";
import EscolhaDoCanal from "./EscolhaDoCanal";
import PassoCredenciais from "./PassoCredenciais";
import PassoWebhook from "./PassoWebhook";
import PassoTeste from "./PassoTeste";
import { NOME_DO_CANAL } from "./camposPorCanal";

/**
 * Assistente de Conexão — orquestra as etapas.
 *
 * Este arquivo só COORDENA: cada etapa é um componente próprio (CLAUDE.md
 * II.4). O estado do fluxo vive aqui porque é o que as etapas compartilham;
 * a lógica de cada tela vive na tela.
 *
 * Escolher "WhatsApp comum" sai do assistente e cai no fluxo de QR Code que já
 * existe — não se reescreve o que já funciona.
 */

const ETAPAS = ["Tipo de conexão", "Credenciais", "Webhook", "Teste"];

const useStyles = makeStyles(theme => ({
  stepper: { padding: theme.spacing(2, 0, 3) }
}));

const ChannelWizard = ({ open, onClose, whatsappId, onConcluido, onEscolherQrCode }) => {
  const classes = useStyles();

  const [etapa, setEtapa] = useState(0);
  const [channelType, setChannelType] = useState(null);
  const [valores, setValores] = useState({});
  const [validando, setValidando] = useState(false);
  const [resultadoValidacao, setResultadoValidacao] = useState(null);
  const [webhookInfo, setWebhookInfo] = useState(null);
  const [enviandoTeste, setEnviandoTeste] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState(null);
  // A conexão é criada pelo próprio assistente quando ainda não existe.
  const [idConexao, setIdConexao] = useState(whatsappId || null);

  const reiniciar = () => {
    setEtapa(0);
    setChannelType(null);
    setValores({});
    setResultadoValidacao(null);
    setWebhookInfo(null);
    setResultadoTeste(null);
    setIdConexao(whatsappId || null);
  };

  const fechar = () => {
    reiniciar();
    onClose();
  };

  const escolher = tipo => {
    if (tipo === "baileys") {
      // QR Code já tem fluxo próprio e testado; o assistente sai de cena.
      fechar();
      onEscolherQrCode?.();
      return;
    }

    setChannelType(tipo);
    setResultadoValidacao(null);
    setEtapa(1);
  };

  /**
   * Cria a conexão (se ainda não existe), valida na API real e grava.
   *
   * `__nome` é separado das credenciais de propósito: ele vira o nome da
   * conexão no CRM e não pode ir para o `channelConfig`, que guarda apenas
   * credencial e é cifrado.
   */
  const validarEGravar = async () => {
    setValidando(true);
    setResultadoValidacao(null);

    const { __nome: nomeConexao, ...credenciais } = valores;

    try {
      const { data: validacao } = await api.post("/channel/validate", {
        channelType,
        config: credenciais
      });

      setResultadoValidacao(validacao);

      // Só cria a conexão DEPOIS de a credencial passar: criar antes
      // deixaria conexões órfãs a cada tentativa malsucedida.
      if (!validacao.valido) return;

      let alvo = idConexao;

      if (!alvo) {
        const { data: nova } = await api.post("/whatsapp", {
          name: nomeConexao,
          status: "OPENING",
          isDefault: false,
          queueIds: []
        });
        alvo = nova.id;
        setIdConexao(alvo);
      }

      await api.put(`/channel/${alvo}/config`, {
        channelType,
        config: credenciais
      });
    } catch (err) {
      // Mostra o motivo REAL vindo do backend: mensagem genérica devolveria
      // o usuário ao ponto de partida sem saber o que corrigir.
      const detalhe = err?.response?.data?.error || err?.message;
      setResultadoValidacao({
        valido: false,
        mensagem: detalhe || "Não foi possível validar. Tente novamente."
      });
    } finally {
      setValidando(false);
    }
  };

  const irParaWebhook = async () => {
    try {
      const { data } = await api.get(`/channel/${idConexao}/webhook-info`);
      setWebhookInfo(data);
      setEtapa(2);
    } catch (err) {
      toast.error(
        err?.response?.data?.error || "Não foi possível montar os dados do webhook."
      );
    }
  };

  const enviarTeste = async numero => {
    setEnviandoTeste(true);
    setResultadoTeste(null);

    try {
      const { data } = await api.post(`/channel/${idConexao}/test-message`, {
        to: numero
      });
      setResultadoTeste(data);
    } catch (err) {
      setResultadoTeste({
        sucesso: false,
        mensagem:
          err?.response?.data?.mensagem ||
          err?.response?.data?.error ||
          "Falha ao enviar."
      });
    } finally {
      setEnviandoTeste(false);
    }
  };

  const finalizar = () => {
    toast.success("Canal oficial conectado.");
    fechar();
    onConcluido?.();
  };

  return (
    <Dialog open={open} onClose={fechar} maxWidth="md" fullWidth>
      <DialogTitle>
        Conectar WhatsApp
        {channelType ? ` — ${NOME_DO_CANAL[channelType]}` : ""}
      </DialogTitle>

      <DialogContent>
        <Stepper activeStep={etapa} className={classes.stepper} alternativeLabel>
          {ETAPAS.map(rotulo => (
            <Step key={rotulo}>
              <StepLabel>{rotulo}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {etapa === 0 && (
          <EscolhaDoCanal
            onEscolher={escolher}
            embeddedSignupHabilitado={
              process.env.REACT_APP_META_EMBEDDED_SIGNUP === "true"
            }
          />
        )}

        {etapa === 1 && (
          <PassoCredenciais
            channelType={channelType}
            valores={valores}
            onMudar={(nome, valor) =>
              setValores(v => ({ ...v, [nome]: valor }))
            }
            onValidar={validarEGravar}
            onVoltar={() => setEtapa(0)}
            onConcluir={irParaWebhook}
            validando={validando}
            resultado={resultadoValidacao}
          />
        )}

        {etapa === 2 && (
          <PassoWebhook
            info={webhookInfo}
            channelType={channelType}
            onVoltar={() => setEtapa(1)}
            onContinuar={() => setEtapa(3)}
          />
        )}

        {etapa === 3 && (
          <PassoTeste
            onEnviar={enviarTeste}
            onVoltar={() => setEtapa(2)}
            onFinalizar={finalizar}
            enviando={enviandoTeste}
            resultado={resultadoTeste}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ChannelWizard;
