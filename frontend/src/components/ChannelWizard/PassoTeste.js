import React, { useState } from "react";
import {
  Button,
  Paper,
  TextField,
  Typography,
  makeStyles
} from "@material-ui/core";
import CheckCircleIcon from "@material-ui/icons/CheckCircle";
import ErrorIcon from "@material-ui/icons/ErrorOutline";

/**
 * Etapa 4 — teste real antes de dar a conexão como pronta.
 *
 * POR QUE ESTA ETAPA EXISTE: credencial validada e webhook cadastrado ainda
 * podem não entregar mensagem nenhuma — número não registrado no WhatsApp,
 * conta comercial suspensa, saldo zerado na Twilio. Nada disso aparece na
 * validação de credencial.
 *
 * A pergunta "chegou?" é deliberadamente feita a um humano. O provedor
 * responder "aceito" não significa que a mensagem chegou; só quem está com o
 * celular na mão sabe.
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
  resultado: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    marginTop: theme.spacing(2),
    padding: theme.spacing(1.5, 2),
    borderRadius: 6
  },
  ok: { backgroundColor: "#E8F5E9", color: "#1B5E20" },
  erro: { backgroundColor: "#FDECEA", color: "#B71C1C" },
  acoes: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: theme.spacing(3)
  }
}));

const PassoTeste = ({ onEnviar, onVoltar, onFinalizar, enviando, resultado }) => {
  const classes = useStyles();
  const [numero, setNumero] = useState("");

  return (
    <Paper className={classes.caixa} elevation={1}>
      <h3 className={classes.titulo}>Vamos testar de verdade</h3>
      <p className={classes.intro}>
        Digite o seu próprio número de WhatsApp. Vamos enviar uma mensagem de
        teste por essa conexão para confirmar que tudo funciona antes de você
        colocar no ar.
      </p>

      <TextField
        fullWidth
        autoFocus
        variant="outlined"
        size="small"
        label="Seu número de WhatsApp"
        placeholder="48988368758"
        helperText="DDD + número. O código do país é adicionado automaticamente."
        value={numero}
        onChange={e => setNumero(e.target.value)}
        onKeyPress={e => {
          if (e.key === "Enter" && numero) onEnviar(numero);
        }}
      />

      {resultado && (
        <div
          className={`${classes.resultado} ${
            resultado.sucesso ? classes.ok : classes.erro
          }`}
        >
          {resultado.sucesso ? <CheckCircleIcon /> : <ErrorIcon />}
          <Typography variant="body2">
            {resultado.sucesso ? (
              <>
                <strong>Mensagem enviada.</strong> Confira o seu WhatsApp. Se
                ela chegou, é só finalizar.
              </>
            ) : (
              <>
                <strong>Não foi possível enviar.</strong> {resultado.mensagem}
              </>
            )}
          </Typography>
        </div>
      )}

      <div className={classes.acoes}>
        <Button onClick={onVoltar} disabled={enviando}>
          Voltar
        </Button>

        <div style={{ display: "flex", gap: 8 }}>
          <Button
            variant="outlined"
            color="primary"
            onClick={() => onEnviar(numero)}
            disabled={!numero || enviando}
          >
            {enviando ? "Enviando…" : "Enviar teste"}
          </Button>

          {/* Só libera a finalização depois de um envio aceito. Marcar como
              pronta sem isso criaria conexão que parece funcionar e não
              funciona — o pior estado possível. */}
          <Button
            variant="contained"
            color="primary"
            onClick={onFinalizar}
            disabled={!resultado?.sucesso}
          >
            Recebi, finalizar
          </Button>
        </div>
      </div>
    </Paper>
  );
};

export default PassoTeste;
