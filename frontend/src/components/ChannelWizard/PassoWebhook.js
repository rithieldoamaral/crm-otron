import React from "react";
import {
  Button,
  IconButton,
  Paper,
  TextField,
  Tooltip,
  Typography,
  makeStyles
} from "@material-ui/core";
import FileCopyIcon from "@material-ui/icons/FileCopy";
import { toast } from "react-toastify";

/**
 * Etapa 3 — cadastro do webhook no provedor.
 *
 * ESTE É O PONTO ONDE QUEM NÃO É TÉCNICO TRAVA. "Cadastre a URL de callback"
 * pressupõe saber o que é URL de callback, qual é o domínio do próprio
 * servidor e onde fica esse campo no painel do provedor.
 *
 * Por isso o CRM monta a URL e gera o token sozinho: o usuário não escreve
 * nada, só copia e cola. E cada valor tem botão de cópia, porque selecionar
 * um token de 48 caracteres com o mouse é outro ponto de erro.
 */

const useStyles = makeStyles(theme => ({
  caixa: { padding: theme.spacing(3) },
  titulo: {
    fontSize: "1.1rem",
    fontWeight: 700,
    margin: "0 0 4px",
    color: theme.palette.primary.main
  },
  intro: {
    fontSize: "0.85rem",
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(2)
  },
  passo: {
    display: "flex",
    gap: 10,
    marginBottom: theme.spacing(1.5),
    fontSize: "0.85rem"
  },
  numero: {
    flexShrink: 0,
    width: 22,
    height: 22,
    borderRadius: "50%",
    backgroundColor: theme.palette.primary.main,
    color: "#fff",
    fontSize: "0.72rem",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  campo: { marginBottom: theme.spacing(2) },
  acoes: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: theme.spacing(3)
  }
}));

const PassoWebhook = ({ info, channelType, onVoltar, onContinuar }) => {
  const classes = useStyles();

  const copiar = (valor, rotulo) => {
    navigator.clipboard.writeText(valor).then(
      () => toast.success(`${rotulo} copiado.`),
      () => toast.error("Não foi possível copiar. Selecione e copie à mão.")
    );
  };

  const ehMeta = channelType === "cloud_api";

  const instrucoes = ehMeta
    ? [
        "Abra seu app no painel da Meta (developers.facebook.com).",
        'Vá em WhatsApp → Configuração e clique em "Editar" na seção Webhook.',
        "Cole a URL abaixo no campo de URL de callback.",
        "Cole o código de verificação no campo correspondente e salve.",
        'Ainda nessa tela, marque a caixa "messages" para receber as mensagens.'
      ]
    : [
        "Abra o painel da Twilio (console.twilio.com).",
        "Vá em Messaging → Senders → escolha o seu número de WhatsApp.",
        'Cole a URL abaixo no campo "When a message comes in".',
        "Salve as alterações."
      ];

  return (
    <Paper className={classes.caixa} elevation={1}>
      <h3 className={classes.titulo}>Avise o provedor para onde mandar</h3>
      <p className={classes.intro}>
        Falta dizer ao provedor onde entregar as mensagens que seus clientes
        enviarem. Copie os valores abaixo e cole no painel dele — não é preciso
        digitar nada.
      </p>

      {instrucoes.map((texto, i) => (
        <div className={classes.passo} key={texto}>
          <span className={classes.numero}>{i + 1}</span>
          <span>{texto}</span>
        </div>
      ))}

      <div style={{ marginTop: 20 }}>
        <TextField
          className={classes.campo}
          fullWidth
          variant="outlined"
          size="small"
          label="URL de callback"
          value={info?.url || ""}
          InputProps={{
            readOnly: true,
            endAdornment: (
              <Tooltip title="Copiar">
                <IconButton
                  size="small"
                  onClick={() => copiar(info?.url, "URL")}
                >
                  <FileCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )
          }}
        />

        {/* A Twilio não usa token de verificação; esconder o campo evita a
            pergunta "e onde eu coloco isso?" para quem escolheu Twilio. */}
        {info?.precisaVerifyToken && (
          <TextField
            className={classes.campo}
            fullWidth
            variant="outlined"
            size="small"
            label="Código de verificação"
            value={info?.verifyToken || ""}
            helperText="A Meta usa este código para confirmar que a URL é sua."
            InputProps={{
              readOnly: true,
              endAdornment: (
                <Tooltip title="Copiar">
                  <IconButton
                    size="small"
                    onClick={() => copiar(info?.verifyToken, "Código")}
                  >
                    <FileCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )
            }}
          />
        )}
      </div>

      <Typography variant="body2" color="textSecondary">
        Já colou tudo no painel? Então vamos testar de verdade.
      </Typography>

      <div className={classes.acoes}>
        <Button onClick={onVoltar}>Voltar</Button>
        <Button color="primary" variant="contained" onClick={onContinuar}>
          Testar envio
        </Button>
      </div>
    </Paper>
  );
};

export default PassoWebhook;
