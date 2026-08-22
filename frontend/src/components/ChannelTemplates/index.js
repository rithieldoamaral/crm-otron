import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  makeStyles
} from "@material-ui/core";
import SyncIcon from "@material-ui/icons/Sync";
import InfoOutlinedIcon from "@material-ui/icons/InfoOutlined";
import { toast } from "react-toastify";

import api from "../../services/api";

/**
 * Mensagens pré-aprovadas (templates) de uma conexão oficial.
 *
 * POR QUE SÓ LEITURA: a aprovação acontece no painel da Meta, que é onde ela
 * aconteceria de qualquer forma. Duplicar o formulário aqui daria a impressão
 * de que o CRM aprova — e ele não aprova, só espelha o que já foi aprovado.
 *
 * O TEXTO EVITA A PALAVRA "TEMPLATE". Para quem não é técnico, "mensagem
 * pré-aprovada" diz o que é e por que existe; "template" não diz nada.
 */

const useStyles = makeStyles(theme => ({
  aviso: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: theme.spacing(1.5, 2),
    marginBottom: theme.spacing(2),
    borderRadius: 6,
    borderLeft: `3px solid ${theme.palette.primary.main}`,
    backgroundColor:
      theme.palette.type === "light" ? "#F4F2EC" : "rgba(255,255,255,0.06)"
  },
  avisoIcone: { color: theme.palette.primary.main, fontSize: 18, flexShrink: 0 },
  vazio: {
    padding: theme.spacing(5, 2),
    textAlign: "center",
    color: theme.palette.text.secondary
  },
  corpo: {
    fontSize: "0.78rem",
    color: theme.palette.text.secondary,
    maxWidth: 380,
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  }
}));

/** Cor do chip conforme o status de aprovação na Meta. */
const CORES = {
  APPROVED: { label: "Aprovada", color: "primary" },
  PENDING: { label: "Em análise", color: "default" },
  REJECTED: { label: "Recusada", color: "secondary" }
};

const ChannelTemplates = ({ open, onClose, whatsappId, nomeConexao }) => {
  const classes = useStyles();

  const [templates, setTemplates] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  const carregar = useCallback(async () => {
    if (!whatsappId) return;

    setCarregando(true);
    try {
      const { data } = await api.get(`/whatsapp-templates/${whatsappId}`);
      setTemplates(data.templates || []);
    } catch (err) {
      toast.error(
        err?.response?.data?.error || "Não foi possível carregar as mensagens."
      );
    } finally {
      setCarregando(false);
    }
  }, [whatsappId]);

  useEffect(() => {
    if (open) carregar();
  }, [open, carregar]);

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const { data } = await api.post(`/whatsapp-templates/${whatsappId}/sync`);
      setTemplates(data.templates || []);
      toast.success(
        `${data.total} ${
          data.total === 1 ? "mensagem encontrada" : "mensagens encontradas"
        } no provedor.`
      );
    } catch (err) {
      toast.error(
        err?.response?.data?.error || "Não foi possível buscar no provedor."
      );
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Mensagens pré-aprovadas
        {nomeConexao ? ` — ${nomeConexao}` : ""}
      </DialogTitle>

      <DialogContent>
        <Paper className={classes.aviso} elevation={0}>
          <InfoOutlinedIcon className={classes.avisoIcone} />
          <Typography variant="body2" component="div">
            Quando o cliente não escreve há mais de 24 horas, a Meta só permite
            enviar mensagens <strong>previamente aprovadas por ela</strong>. O
            sistema escolhe uma automaticamente nesses casos.
            <br />
            Para criar ou editar, use o painel da Meta — a aprovação acontece lá.
            Aqui você vê o que já está aprovado e disponível para uso.
          </Typography>
        </Paper>

        {carregando && (
          <div className={classes.vazio}>
            <Typography variant="body2">Carregando…</Typography>
          </div>
        )}

        {!carregando && templates.length === 0 && (
          <div className={classes.vazio}>
            <Typography variant="body2">
              Nenhuma mensagem pré-aprovada encontrada.
            </Typography>
            <Typography variant="caption">
              Clique em “Buscar no provedor” para trazer as que já existem na
              sua conta.
            </Typography>
          </div>
        )}

        {!carregando && templates.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Nome</TableCell>
                <TableCell>Idioma</TableCell>
                <TableCell>Situação</TableCell>
                <TableCell align="center">Campos</TableCell>
                <TableCell>Texto</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {templates.map(t => {
                const estilo = CORES[t.status] || {
                  label: t.status,
                  color: "default"
                };

                return (
                  <TableRow key={t.id}>
                    <TableCell>{t.name}</TableCell>
                    <TableCell>{t.language}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={estilo.label}
                        color={estilo.color}
                      />
                    </TableCell>
                    <TableCell align="center">{t.variableCount}</TableCell>
                    <TableCell>
                      <span className={classes.corpo} title={t.bodyText || ""}>
                        {t.bodyText || "—"}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        <Button
          color="primary"
          variant="contained"
          startIcon={<SyncIcon />}
          onClick={sincronizar}
          disabled={sincronizando}
        >
          {sincronizando ? "Buscando…" : "Buscar no provedor"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ChannelTemplates;
