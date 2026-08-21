import React, { useCallback, useEffect, useState } from "react";

import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import WarningIcon from "@material-ui/icons/Warning";

import api from "../../services/api";
import ModelPricesManager from "./ModelPricesManager";
import toastError from "../../errors/toastError";
import { toast } from "react-toastify";

/**
 * Painel de governança de tokens — SOMENTE superadmin.
 *
 * A aba é escondida para não-super, mas isso é UX: o bloqueio real é o
 * middleware `isSuper` no backend (CLAUDE.md XV.1). Consumo e custo revelam a
 * margem da plataforma e o volume de cada cliente.
 *
 * DECISÃO DE PRODUTO: a métrica em destaque é CUSTO POR ATENDIMENTO, não
 * total de tokens. Token é unidade interna; o número que denuncia problema é
 * quanto custa cada conversa — é ele que revela empresa com conversa
 * anormalmente longa, que é o driver real de custo nesta arquitetura.
 */

const useStyles = makeStyles(theme => ({
  root: { width: "100%" },
  card: {
    padding: theme.spacing(2),
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center"
  },
  cardLabel: {
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: theme.palette.text.secondary,
    fontWeight: 600
  },
  cardValue: {
    fontSize: "1.6rem",
    fontWeight: 700,
    lineHeight: 1.2
  },
  cardHint: {
    fontSize: "0.75rem",
    color: theme.palette.text.secondary,
    marginTop: theme.spacing(0.5)
  },
  filters: {
    display: "flex",
    gap: theme.spacing(2),
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: theme.spacing(2)
  },
  tableWrapper: {
    // Tabela larga não pode empurrar a página inteira na horizontal.
    overflowX: "auto",
    marginTop: theme.spacing(2)
  },
  sectionTitle: {
    marginTop: theme.spacing(3),
    marginBottom: theme.spacing(1),
    fontWeight: 600
  },
  loading: {
    display: "flex",
    justifyContent: "center",
    padding: theme.spacing(4)
  },
  warnChip: { marginLeft: theme.spacing(1) }
}));

const brl = value =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    // 4 casas: com markup 0 e volume baixo, 2 casas exibiriam R$ 0,00 para
    // consumo real e passaria a impressão de que não custa nada.
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(Number(value) || 0);

const intFmt = value =>
  new Intl.NumberFormat("pt-BR").format(Math.round(Number(value) || 0));

/** Data de hoje / N dias atrás em YYYY-MM-DD, que é o formato aceito pela API. */
const isoDaysAgo = days => {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
};

const TokenGovernance = () => {
  const classes = useStyles();

  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(isoDaysAgo(30));
  const [endDate, setEndDate] = useState(isoDaysAgo(0));

  const [overview, setOverview] = useState({ totals: {}, companies: [] });
  const [models, setModels] = useState([]);

  const [creditDialog, setCreditDialog] = useState({ open: false, company: null });
  const [creditAmount, setCreditAmount] = useState("");
  const [creditDescription, setCreditDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { startDate, endDate };
      const [overviewRes, modelsRes] = await Promise.all([
        api.get("/token-governance/overview", { params }),
        api.get("/token-governance/by-model", { params })
      ]);
      setOverview(overviewRes.data);
      setModels(modelsRes.data.models || []);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleGrantCredit = async () => {
    const amount = Number(String(creditAmount).replace(",", "."));
    if (!(amount > 0)) {
      toast.error("Informe um valor maior que zero.");
      return;
    }
    if (!creditDescription.trim()) {
      toast.error("Descreva o motivo do crédito (fica no extrato).");
      return;
    }

    setSaving(true);
    try {
      await api.post(`/token-governance/credits/${creditDialog.company.companyId}`, {
        amountBrl: amount,
        description: creditDescription.trim()
      });
      toast.success("Crédito lançado.");
      setCreditDialog({ open: false, company: null });
      setCreditAmount("");
      setCreditDescription("");
      fetchData();
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  const totals = overview.totals || {};
  const companies = overview.companies || [];
  const hasPricingGaps = companies.some(c => c.hasPricingGaps);

  return (
    <div className={classes.root}>
      <div className={classes.filters}>
        <TextField
          label="De"
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          size="small"
          variant="outlined"
        />
        <TextField
          label="Até"
          type="date"
          value={endDate}
          onChange={e => setEndDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          size="small"
          variant="outlined"
        />
        <Button variant="outlined" color="primary" onClick={fetchData}>
          Atualizar
        </Button>
      </div>

      {hasPricingGaps && (
        <Paper className={classes.card} style={{ marginBottom: 16 }}>
          <Typography variant="body2">
            <WarningIcon fontSize="small" style={{ verticalAlign: "middle" }} />{" "}
            Há modelos em uso <strong>sem preço cadastrado</strong>. O consumo
            deles aparece com custo zero — não é "barato", é desconhecido.
            Cadastre o preço para o total ficar correto.
          </Typography>
        </Paper>
      )}

      {loading ? (
        <div className={classes.loading}>
          <CircularProgress />
        </div>
      ) : (
        <>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <Paper className={classes.card}>
                <span className={classes.cardLabel}>Custo total</span>
                <span className={classes.cardValue}>{brl(totals.costBrl)}</span>
                <span className={classes.cardHint}>
                  o que a operação custou no período
                </span>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper className={classes.card}>
                <span className={classes.cardLabel}>Custo por atendimento</span>
                <span className={classes.cardValue}>
                  {brl(totals.costPerTicketBrl)}
                </span>
                <span className={classes.cardHint}>
                  média entre todas as empresas
                </span>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper className={classes.card}>
                <span className={classes.cardLabel}>Atendimentos</span>
                <span className={classes.cardValue}>
                  {intFmt(totals.distinctTickets)}
                </span>
                <span className={classes.cardHint}>
                  {intFmt(totals.totalCalls)} chamadas ao modelo
                </span>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper className={classes.card}>
                <span className={classes.cardLabel}>Margem</span>
                <span className={classes.cardValue}>{brl(totals.marginBrl)}</span>
                <span className={classes.cardHint}>
                  {Number(totals.marginBrl) === 0
                    ? "markup 0 — você absorve o custo"
                    : "cobrado menos custo"}
                </span>
              </Paper>
            </Grid>
          </Grid>

          <Typography className={classes.sectionTitle}>
            Consumo por empresa
          </Typography>

          <Paper className={classes.tableWrapper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Empresa</TableCell>
                  <TableCell align="right">Custo</TableCell>
                  <TableCell align="right">Atendimentos</TableCell>
                  <TableCell align="right">Custo/atendimento</TableCell>
                  <TableCell align="right">Tokens/atendimento</TableCell>
                  <TableCell align="right">Cache</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {companies.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      Nenhum consumo registrado no período.
                    </TableCell>
                  </TableRow>
                )}
                {companies.map(c => (
                  <TableRow key={c.companyId}>
                    <TableCell>
                      {c.companyName}
                      {c.hasPricingGaps && (
                        <Tooltip title="Algum modelo usado por esta empresa está sem preço cadastrado — o custo exibido está incompleto.">
                          <Chip
                            className={classes.warnChip}
                            size="small"
                            label="preço faltando"
                          />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell align="right">{brl(c.costBrl)}</TableCell>
                    <TableCell align="right">
                      {intFmt(c.distinctTickets)}
                    </TableCell>
                    <TableCell align="right">
                      <strong>{brl(c.costPerTicketBrl)}</strong>
                    </TableCell>
                    <TableCell align="right">
                      {intFmt(c.tokensPerTicket)}
                    </TableCell>
                    <TableCell align="right">
                      {`${(Number(c.cacheHitPercent) || 0).toFixed(0)}%`}
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        onClick={() =>
                          setCreditDialog({ open: true, company: c })
                        }
                      >
                        Creditar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Typography className={classes.sectionTitle}>
            Consumo por modelo
          </Typography>

          <Paper className={classes.tableWrapper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Provider</TableCell>
                  <TableCell>Modelo</TableCell>
                  <TableCell align="right">Chamadas</TableCell>
                  <TableCell align="right">Tokens entrada</TableCell>
                  <TableCell align="right">Tokens saída</TableCell>
                  <TableCell align="right">Custo</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {models.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      Nenhum consumo registrado no período.
                    </TableCell>
                  </TableRow>
                )}
                {models.map(m => (
                  <TableRow key={`${m.provider}-${m.model}`}>
                    <TableCell>{m.provider}</TableCell>
                    <TableCell>
                      {m.model}
                      {m.pricingMissing && (
                        <Chip
                          className={classes.warnChip}
                          size="small"
                          label="sem preço"
                        />
                      )}
                    </TableCell>
                    <TableCell align="right">{intFmt(m.totalCalls)}</TableCell>
                    <TableCell align="right">{intFmt(m.inputTokens)}</TableCell>
                    <TableCell align="right">{intFmt(m.outputTokens)}</TableCell>
                    <TableCell align="right">{brl(m.costBrl)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Box mt={2}>
            <Typography variant="caption" color="textSecondary">
              O consumo é medido por chamada ao modelo. Empresas sem crédito
              cadastrado não são bloqueadas — a trava comercial existe, mas está
              desligada de propósito: bloquear deixaria o cliente final sem
              resposta no meio da conversa.
            </Typography>
          </Box>
        </>
      )}

      <Dialog
        open={creditDialog.open}
        onClose={() => setCreditDialog({ open: false, company: null })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          Creditar {creditDialog.company?.companyName || ""}
        </DialogTitle>
        <DialogContent>
          <TextField
            label="Valor (R$)"
            value={creditAmount}
            onChange={e => setCreditAmount(e.target.value)}
            fullWidth
            margin="dense"
            variant="outlined"
            autoFocus
          />
          <TextField
            label="Motivo"
            value={creditDescription}
            onChange={e => setCreditDescription(e.target.value)}
            fullWidth
            margin="dense"
            variant="outlined"
            helperText="Fica registrado no extrato — descreva de forma que faça sentido daqui a seis meses."
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setCreditDialog({ open: false, company: null })}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleGrantCredit}
            color="primary"
            variant="contained"
            disabled={saving}
          >
            {saving ? "Salvando..." : "Lançar crédito"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Cadastro de precos: fica nesta aba porque e aqui que o custo e
          lido. Separar em outra aba obrigaria a ir e voltar toda vez que o
          painel sinalizasse um modelo sem preco. */}
      <ModelPricesManager />
    </div>
  );
};

export default TokenGovernance;
