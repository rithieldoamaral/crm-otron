import React, { useState } from "react";
import {
  Button,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  TextField,
  Tooltip,
  Typography,
  makeStyles
} from "@material-ui/core";
import CheckCircleIcon from "@material-ui/icons/CheckCircle";
import ErrorIcon from "@material-ui/icons/ErrorOutline";
import HelpIcon from "@material-ui/icons/HelpOutline";
import AssignmentIcon from "@material-ui/icons/Assignment";

import { CAMPOS_POR_CANAL } from "./camposPorCanal";

/**
 * Etapa 2 — credenciais, UM CAMPO POR VEZ.
 *
 * POR QUE NÃO UM FORMULÁRIO COM TODOS OS CAMPOS: seis campos vazios de uma vez,
 * com nomes que a pessoa nunca viu, é o desenho que faz alguém sem
 * conhecimento técnico fechar a tela. Um por vez, com instrução específica e
 * confirmação a cada passo, transforma a mesma tarefa numa sequência simples.
 *
 * O botão "Colar" existe porque token de acesso tem mais de 100 caracteres:
 * digitar é inviável e colar errado é comum.
 */

const useStyles = makeStyles(theme => ({
  caixa: { padding: theme.spacing(3) },
  progresso: { marginBottom: theme.spacing(2) },
  contador: {
    fontSize: "0.75rem",
    color: theme.palette.text.secondary,
    marginBottom: 4
  },
  rotulo: {
    fontSize: "1.1rem",
    fontWeight: 700,
    margin: "0 0 4px",
    color: theme.palette.primary.main
  },
  ajuda: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    padding: theme.spacing(1.5, 2),
    borderRadius: 6,
    marginBottom: theme.spacing(2),
    backgroundColor:
      theme.palette.type === "light" ? "#F4F2EC" : "rgba(255,255,255,0.06)"
  },
  ajudaIcone: { color: theme.palette.primary.main, fontSize: 18, flexShrink: 0 },
  resultado: {
    display: "flex",
    alignItems: "center",
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

const PassoCredenciais = ({
  channelType,
  valores,
  onMudar,
  onValidar,
  onVoltar,
  onConcluir,
  validando,
  resultado
}) => {
  const classes = useStyles();
  const campos = CAMPOS_POR_CANAL[channelType] || [];
  const [indice, setIndice] = useState(0);

  const campo = campos[indice];
  const ultimo = indice === campos.length - 1;
  const preenchido = Boolean(valores[campo?.nome]);

  const colar = async () => {
    try {
      const texto = await navigator.clipboard.readText();
      onMudar(campo.nome, texto.trim());
    } catch {
      // Navegador pode negar acesso à área de transferência (permissão ou
      // contexto inseguro). Não é erro do usuário e não vale interromper o
      // fluxo: ele simplesmente cola com Ctrl+V.
    }
  };

  const avancar = () => {
    if (ultimo) {
      onValidar();
      return;
    }
    setIndice(i => i + 1);
  };

  const voltar = () => {
    if (indice === 0) {
      onVoltar();
      return;
    }
    setIndice(i => i - 1);
  };

  if (!campo) return null;

  return (
    <Paper className={classes.caixa} elevation={1}>
      <LinearProgress
        className={classes.progresso}
        variant="determinate"
        value={((indice + 1) / campos.length) * 100}
      />

      <div className={classes.contador}>
        Passo {indice + 1} de {campos.length}
      </div>
      <h3 className={classes.rotulo}>{campo.rotulo}</h3>

      <div className={classes.ajuda}>
        <HelpIcon className={classes.ajudaIcone} />
        <Typography variant="body2">
          <strong>Onde encontro isso?</strong> {campo.ondeEncontrar}
        </Typography>
      </div>

      <TextField
        fullWidth
        autoFocus
        variant="outlined"
        size="small"
        label={campo.rotulo}
        placeholder={campo.exemplo}
        // Segredo fica mascarado na tela para não vazar em gravação de tela ou
        // em alguém olhando por cima do ombro.
        type={campo.segredo ? "password" : "text"}
        value={valores[campo.nome] || ""}
        onChange={e => onMudar(campo.nome, e.target.value)}
        onKeyPress={e => {
          if (e.key === "Enter" && preenchido) avancar();
        }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title="Colar da área de transferência">
                <IconButton size="small" onClick={colar}>
                  <AssignmentIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          )
        }}
      />

      {resultado && (
        <div
          className={`${classes.resultado} ${
            resultado.valido ? classes.ok : classes.erro
          }`}
        >
          {resultado.valido ? <CheckCircleIcon /> : <ErrorIcon />}
          <Typography variant="body2">{resultado.mensagem}</Typography>
        </div>
      )}

      <div className={classes.acoes}>
        <Button onClick={voltar} disabled={validando}>
          Voltar
        </Button>

        {resultado?.valido ? (
          <Button color="primary" variant="contained" onClick={onConcluir}>
            Continuar
          </Button>
        ) : (
          <Button
            color="primary"
            variant="contained"
            onClick={avancar}
            disabled={!preenchido || validando}
          >
            {/* O último passo dispara a validação contra a API real: é aqui
                que credencial "bonita mas inválida" é pega. */}
            {validando ? "Validando…" : ultimo ? "Validar conexão" : "Próximo"}
          </Button>
        )}
      </div>
    </Paper>
  );
};

export default PassoCredenciais;
