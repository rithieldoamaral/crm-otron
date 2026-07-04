/**
 * Página: Financeiro — Analytics de Receita (Fase 7)
 *
 * Exibe KPIs financeiros derivados de ServiceHistory:
 *   - Cards: Receita Total, Nº Transações, Ticket Médio, Crescimento, Período
 *   - Gráfico de linha: Receita por dia
 *   - Gráfico de barras: Receita por dia da semana
 *   - Tabela: Top clientes por receita
 *   - Tabela: Top serviços por receita
 *
 * Fonte de dados: endpoint GET /finance/* (FinanceController)
 * Apenas registros de ServiceHistory com value > 0 são considerados.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Grid,
  Paper,
  Typography,
  TextField,
  CircularProgress,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
} from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  FiTrendingUp,
  FiTrendingDown,
  FiDollarSign,
  FiActivity,
  FiShoppingBag,
} from "react-icons/fi";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import Title from "../../components/Title";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";

// ── Estilos ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  mainPaper: {
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  kpiCard: {
    padding: theme.spacing(2.5),
    borderRadius: theme.shape.borderRadius,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(0.5),
    height: "100%",
  },
  kpiLabel: {
    fontSize: "0.78rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: theme.palette.text.secondary,
  },
  kpiValue: {
    fontSize: "1.8rem",
    fontWeight: 700,
    color: theme.palette.text.primary,
    lineHeight: 1.2,
  },
  kpiSub: {
    fontSize: "0.8rem",
    color: theme.palette.text.secondary,
    marginTop: theme.spacing(0.5),
  },
  growthPositive: {
    color: theme.palette.success.main,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  growthNegative: {
    color: theme.palette.error.main,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  sectionTitle: {
    fontWeight: 600,
    marginBottom: theme.spacing(1.5),
    color: theme.palette.text.primary,
  },
  chartPaper: {
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  tablePaper: {
    padding: theme.spacing(2),
  },
  filterRow: {
    display: "flex",
    gap: theme.spacing(2),
    alignItems: "center",
  },
  loadingCenter: {
    display: "flex",
    justifyContent: "center",
    padding: theme.spacing(4),
  },
  emptyText: {
    color: theme.palette.text.secondary,
    textAlign: "center",
    padding: theme.spacing(2),
  },
  revenueChip: {
    fontWeight: 600,
    backgroundColor: theme.palette.primary.light,
    color: theme.palette.primary.contrastText,
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatBRL = (value) =>
  Number(value ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const formatBRLShort = (value) => {
  const n = Number(value ?? 0);
  if (n >= 1000) return `R$ ${(n / 1000).toFixed(1)}k`;
  return `R$ ${n.toFixed(0)}`;
};

// Data padrão: início do mês atual
const getDefaultStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

const getDefaultEnd = () => new Date().toISOString().split("T")[0];

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, color }) {
  const classes = useStyles();
  return (
    <Paper className={classes.kpiCard} variant="outlined">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Typography className={classes.kpiLabel}>{label}</Typography>
        {Icon && <Icon size={18} color={color || "#666"} />}
      </div>
      <Typography className={classes.kpiValue}>{value}</Typography>
      {sub && (
        <Typography className={classes.kpiSub}>{sub}</Typography>
      )}
    </Paper>
  );
}

// ── Página Principal ──────────────────────────────────────────────────────────

const Finance = () => {
  const classes = useStyles();

  const [startDate, setStartDate] = useState(getDefaultStart());
  const [endDate, setEndDate] = useState(getDefaultEnd());

  const [summary, setSummary] = useState(null);
  const [byDay, setByDay] = useState([]);
  const [byWeekday, setByWeekday] = useState([]);
  const [topClients, setTopClients] = useState([]);
  const [topServices, setTopServices] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = { startDate, endDate };
      // Top N: limit precisa estar DENTRO de params para virar query string (?limit=10).
      // Antes: { params, limit: 10 } → limit ficava fora do axios config, ignorado.
      const paramsTop = { ...params, limit: 10 };
      const [s, d, w, c, sv] = await Promise.all([
        api.get("/finance/summary", { params }),
        api.get("/finance/revenue-by-day", { params }),
        api.get("/finance/revenue-by-weekday", { params }),
        api.get("/finance/top-clients", { params: paramsTop }),
        api.get("/finance/top-services", { params: paramsTop }),
      ]);
      setSummary(s.data);
      setByDay(d.data);
      setByWeekday(w.data);
      setTopClients(c.data);
      setTopServices(sv.data);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    const delay = setTimeout(fetchAll, 500);
    return () => clearTimeout(delay);
  }, [fetchAll]);

  const growthRate = summary?.growthRate;
  const isPositive = growthRate !== null && growthRate >= 0;

  return (
    <MainContainer>
      <MainHeader>
        <Title>Financeiro</Title>
        <MainHeaderButtonsWrapper>
          <div className={classes.filterRow}>
            <TextField
              label="De"
              type="date"
              size="small"
              variant="outlined"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Até"
              type="date"
              size="small"
              variant="outlined"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </div>
        </MainHeaderButtonsWrapper>
      </MainHeader>

      {loading ? (
        <div className={classes.loadingCenter}>
          <CircularProgress />
        </div>
      ) : (
        <>
          {/* ── KPI Cards ───────────────────────────────────────────────── */}
          <Grid container spacing={2} style={{ marginBottom: 16 }}>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="Receita Total"
                value={formatBRL(summary?.totalRevenue)}
                sub={`${summary?.transactionCount ?? 0} transações`}
                icon={FiDollarSign}
                color="#1976d2"
              />
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="Ticket Médio"
                value={
                  summary?.averageTicket != null
                    ? formatBRL(summary.averageTicket)
                    : "—"
                }
                sub="por transação"
                icon={FiShoppingBag}
                color="#7b1fa2"
              />
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <Paper className={classes.kpiCard} variant="outlined">
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography className={classes.kpiLabel}>Crescimento</Typography>
                  {growthRate !== null ? (
                    isPositive ? (
                      <FiTrendingUp size={18} color="#2e7d32" />
                    ) : (
                      <FiTrendingDown size={18} color="#c62828" />
                    )
                  ) : (
                    <FiActivity size={18} color="#666" />
                  )}
                </div>
                <Typography
                  className={
                    growthRate === null
                      ? classes.kpiValue
                      : isPositive
                      ? classes.growthPositive
                      : classes.growthNegative
                  }
                  style={{ fontSize: "1.8rem" }}
                >
                  {growthRate === null
                    ? "—"
                    : `${isPositive ? "+" : ""}${growthRate}%`}
                </Typography>
                <Typography className={classes.kpiSub}>
                  vs período anterior ({formatBRL(summary?.previousRevenue)})
                </Typography>
              </Paper>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="Período"
                value={summary?.transactionCount ?? 0}
                sub={`${summary?.startDate ?? ""} → ${summary?.endDate ?? ""}`}
                icon={FiActivity}
                color="#f57c00"
              />
            </Grid>
          </Grid>

          {/* ── Gráfico: Receita por Dia ─────────────────────────────────── */}
          <Paper className={classes.chartPaper} variant="outlined">
            <Typography variant="subtitle1" className={classes.sectionTitle}>
              Receita por Dia
            </Typography>
            {byDay.length === 0 ? (
              <Typography className={classes.emptyText}>
                Sem dados no período selecionado.
              </Typography>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={byDay}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => d.slice(5)} // "05-01"
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    tickFormatter={formatBRLShort}
                    tick={{ fontSize: 11 }}
                    width={60}
                  />
                  <Tooltip
                    formatter={(value) => [formatBRL(value), "Receita"]}
                    labelFormatter={(label) => `Data: ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#1976d2"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Paper>

          {/* ── Gráfico: Receita por Dia da Semana ──────────────────────── */}
          <Paper className={classes.chartPaper} variant="outlined">
            <Typography variant="subtitle1" className={classes.sectionTitle}>
              Receita por Dia da Semana
            </Typography>
            {byWeekday.length === 0 ? (
              <Typography className={classes.emptyText}>
                Sem dados no período selecionado.
              </Typography>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={byWeekday}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="weekday" tick={{ fontSize: 11 }} />
                  <YAxis
                    tickFormatter={formatBRLShort}
                    tick={{ fontSize: 11 }}
                    width={60}
                  />
                  <Tooltip
                    formatter={(value) => [formatBRL(value), "Receita"]}
                  />
                  <Bar dataKey="revenue" fill="#7b1fa2" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Paper>

          {/* ── Tabelas: Top Clientes + Top Serviços ─────────────────────── */}
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Paper className={classes.tablePaper} variant="outlined">
                <Typography variant="subtitle1" className={classes.sectionTitle}>
                  Top Clientes
                </Typography>
                {topClients.length === 0 ? (
                  <Typography className={classes.emptyText}>
                    Sem dados no período.
                  </Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>#</TableCell>
                        <TableCell>Cliente</TableCell>
                        <TableCell align="right">Transações</TableCell>
                        <TableCell align="right">Receita</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {topClients.map((c, i) => (
                        <TableRow key={c.contactId} hover>
                          <TableCell>
                            <Typography variant="caption" color="textSecondary">
                              {i + 1}
                            </Typography>
                          </TableCell>
                          <TableCell>{c.name}</TableCell>
                          <TableCell align="right">{c.transactionCount}</TableCell>
                          <TableCell align="right">
                            <Chip
                              label={formatBRL(c.revenue)}
                              size="small"
                              className={classes.revenueChip}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Paper>
            </Grid>

            <Grid item xs={12} md={6}>
              <Paper className={classes.tablePaper} variant="outlined">
                <Typography variant="subtitle1" className={classes.sectionTitle}>
                  Top Serviços
                </Typography>
                {topServices.length === 0 ? (
                  <Typography className={classes.emptyText}>
                    Sem dados no período.
                  </Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>#</TableCell>
                        <TableCell>Serviço</TableCell>
                        <TableCell align="right">Atend.</TableCell>
                        <TableCell align="right">Receita</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {topServices.map((s, i) => (
                        <TableRow key={s.serviceType} hover>
                          <TableCell>
                            <Typography variant="caption" color="textSecondary">
                              {i + 1}
                            </Typography>
                          </TableCell>
                          <TableCell>{s.serviceType}</TableCell>
                          <TableCell align="right">{s.count}</TableCell>
                          <TableCell align="right">
                            <Chip
                              label={formatBRL(s.revenue)}
                              size="small"
                              className={classes.revenueChip}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Paper>
            </Grid>
          </Grid>
        </>
      )}
    </MainContainer>
  );
};

export default Finance;
