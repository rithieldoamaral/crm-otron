/**
 * Retencao — página do Módulo de Retenção de Clientes.
 *
 * 3 abas:
 *   1. Adormecidos  — contatos que precisam de atenção (D+, adormecido, perdido)
 *   2. Aniversários — toques automáticos (D-3, D-0, D+7) + próximos aniversários
 *   3. Cupons       — cupons gerados + taxa de resgate
 *
 * Todos os dados vêm de endpoints do backend Módulo de Retenção.
 * Dados de aniversário: GET /retention/birthday-stats
 * Dados de adormecidos: GET /retention/dormant
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  makeStyles,
  Paper,
  Tabs,
  Tab,
  Typography,
  Box,
  Chip,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  IconButton,
} from "@material-ui/core";
import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import Title from "../../components/Title";
import toastError from "../../errors/toastError";
import api from "../../services/api";
import { FiRefreshCw, FiGift, FiCalendar, FiUsers, FiBell, FiAward, FiHeart, FiPieChart, FiShoppingBag, FiShare2 } from "react-icons/fi";

// ── Estilos ────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  root: {
    padding: theme.spacing(2),
  },
  tabPanel: {
    padding: theme.spacing(2, 0),
  },
  statsRow: {
    display: "flex",
    gap: theme.spacing(2),
    flexWrap: "wrap",
    marginBottom: theme.spacing(3),
  },
  statCard: {
    background: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 12,
    padding: theme.spacing(2, 3),
    minWidth: 140,
    textAlign: "center",
  },
  statValue: {
    fontSize: 28,
    fontWeight: 700,
    color: theme.palette.primary.main,
  },
  statLabel: {
    fontSize: 12,
    color: theme.palette.text.secondary,
    marginTop: 4,
  },
  sectionTitle: {
    fontWeight: 600,
    marginBottom: theme.spacing(1),
    marginTop: theme.spacing(2),
  },
  table: {
    minWidth: 500,
  },
  chip: {
    fontWeight: 600,
    fontSize: 11,
  },
  refreshBtn: {
    marginLeft: "auto",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    marginBottom: theme.spacing(1),
  },
  loadingBox: {
    display: "flex",
    justifyContent: "center",
    padding: theme.spacing(4),
  },
  emptyBox: {
    textAlign: "center",
    color: theme.palette.text.secondary,
    padding: theme.spacing(4),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────

const STATUS_COLOR = {
  atrasado: "#f59e0b",
  adormecido: "#ef4444",
  perdido: "#7c3aed",
  quase_na_hora: "#3b82f6",
  em_dia: "#22c55e",
  novo: "#64748b",
};

const STATUS_LABEL = {
  atrasado: "Atrasado",
  adormecido: "Adormecido",
  perdido: "Perdido",
  quase_na_hora: "Quase na hora",
  em_dia: "Em dia",
  novo: "Novo",
};

function TabPanel({ children, value, index }) {
  return value === index ? (
    <Box>{children}</Box>
  ) : null;
}

function StatCard({ value, label }) {
  const classes = useStyles();
  return (
    <div className={classes.statCard}>
      <div className={classes.statValue}>{value}</div>
      <div className={classes.statLabel}>{label}</div>
    </div>
  );
}

// ── Aba 1: Adormecidos ────────────────────────────────────────────

function TabAdormecidos() {
  const classes = useStyles();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get("/retention/dormant?limit=50");
      setData(res);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Box className={classes.loadingBox}><CircularProgress /></Box>;
  if (!data) return null;

  const { items = [], total = 0, summary = {} } = data;

  return (
    <div>
      {/* Cards de resumo */}
      <div className={classes.statsRow}>
        <StatCard value={summary.atrasado ?? 0} label="Atrasados" />
        <StatCard value={summary.adormecido ?? 0} label="Adormecidos" />
        <StatCard value={summary.perdido ?? 0} label="Perdidos" />
        <StatCard value={total} label="Total" />
      </div>

      {/* Tabela */}
      <div className={classes.headerRow}>
        <Typography className={classes.sectionTitle}>
          Contatos que precisam de atenção
        </Typography>
        <Tooltip title="Atualizar">
          <IconButton size="small" className={classes.refreshBtn} onClick={load}>
            <FiRefreshCw size={16} />
          </IconButton>
        </Tooltip>
      </div>

      {items.length === 0 ? (
        <div className={classes.emptyBox}>
          <FiUsers size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
          <Typography>Nenhum contato dormente encontrado.</Typography>
        </div>
      ) : (
        <Paper variant="outlined">
          <Table className={classes.table} size="small">
            <TableHead>
              <TableRow>
                <TableCell>Contato</TableCell>
                <TableCell>Número</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Dias sem serviço</TableCell>
                <TableCell align="right">Serviços</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map(({ contact, dormant }) => (
                <TableRow key={contact?.id} hover>
                  <TableCell>{contact?.name || "—"}</TableCell>
                  <TableCell>{contact?.number || "—"}</TableCell>
                  <TableCell>
                    <Chip
                      label={STATUS_LABEL[dormant.status] || dormant.status}
                      size="small"
                      className={classes.chip}
                      style={{
                        background: STATUS_COLOR[dormant.status] ?? "#64748b",
                        color: "#fff",
                      }}
                    />
                  </TableCell>
                  <TableCell align="right">{dormant.daysSinceLastService}</TableCell>
                  <TableCell align="right">{dormant.totalServices}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </div>
  );
}

// ── Aba 2: Aniversários ───────────────────────────────────────────

function TabAniversarios() {
  const classes = useStyles();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get("/retention/birthday-stats");
      setData(res);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Box className={classes.loadingBox}><CircularProgress /></Box>;
  if (!data) return null;

  const {
    touchStats = {},
    couponStats = {},
    upcomingBirthdays = [],
    recentBirthdays = [],
    year,
  } = data;

  return (
    <div>
      {/* Toques enviados */}
      <div className={classes.headerRow}>
        <Typography className={classes.sectionTitle}>
          Toques enviados em {year}
        </Typography>
        <Tooltip title="Atualizar">
          <IconButton size="small" className={classes.refreshBtn} onClick={load}>
            <FiRefreshCw size={16} />
          </IconButton>
        </Tooltip>
      </div>
      <div className={classes.statsRow}>
        <StatCard value={touchStats.dm3 ?? 0} label="D-3 Antecipação" />
        <StatCard value={touchStats.d0 ?? 0} label="D-0 Parabéns" />
        <StatCard value={touchStats.dp7 ?? 0} label="D+7 Follow-up" />
        <StatCard value={couponStats.generated ?? 0} label="Cupons gerados" />
        <StatCard value={`${couponStats.redemptionRate ?? 0}%`} label="Taxa de resgate" />
      </div>

      {/* Próximos aniversários */}
      <Typography className={classes.sectionTitle} style={{ marginTop: 16 }}>
        Próximos aniversários (7 dias)
      </Typography>
      {upcomingBirthdays.length === 0 ? (
        <div className={classes.emptyBox}>
          <FiCalendar size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
          <Typography variant="body2">Nenhum aniversário nos próximos 7 dias.</Typography>
        </div>
      ) : (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Contato</TableCell>
                <TableCell>Número</TableCell>
                <TableCell align="right">Dias faltando</TableCell>
                <TableCell>Toques enviados</TableCell>
                <TableCell>Opt-out</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {upcomingBirthdays.map(({ contact, daysUntil, touchesSent }) => (
                <TableRow key={contact.id} hover>
                  <TableCell>{contact.name}</TableCell>
                  <TableCell>{contact.number}</TableCell>
                  <TableCell align="right">
                    <Chip
                      label={daysUntil === 0 ? "Hoje! 🎂" : `${daysUntil} dias`}
                      size="small"
                      className={classes.chip}
                      style={{ background: daysUntil <= 1 ? "#22c55e" : "#3b82f6", color: "#fff" }}
                    />
                  </TableCell>
                  <TableCell>
                    {touchesSent.length > 0
                      ? touchesSent.map(t => (
                          <Chip key={t} label={t} size="small" style={{ marginRight: 4, fontSize: 10 }} />
                        ))
                      : <Typography variant="caption" color="textSecondary">nenhum</Typography>
                    }
                  </TableCell>
                  <TableCell>
                    {contact.marketingOptOut
                      ? <Chip label="Opt-out" size="small" color="secondary" />
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Aniversários recentes (janela D+7) */}
      <Typography className={classes.sectionTitle} style={{ marginTop: 24 }}>
        Aniversários recentes — janela D+7
      </Typography>
      {recentBirthdays.length === 0 ? (
        <div className={classes.emptyBox}>
          <Typography variant="body2">Nenhum aniversário nos últimos 7 dias.</Typography>
        </div>
      ) : (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Contato</TableCell>
                <TableCell>Número</TableCell>
                <TableCell align="right">Dias desde aniversário</TableCell>
                <TableCell>Toques enviados</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recentBirthdays.map(({ contact, daysUntil: daysSince, touchesSent }) => (
                <TableRow key={contact.id} hover>
                  <TableCell>{contact.name}</TableCell>
                  <TableCell>{contact.number}</TableCell>
                  <TableCell align="right">{daysSince === 0 ? "Hoje 🎂" : daysSince}</TableCell>
                  <TableCell>
                    {touchesSent.length > 0
                      ? touchesSent.map(t => (
                          <Chip key={t} label={t} size="small" style={{ marginRight: 4, fontSize: 10 }} />
                        ))
                      : <Typography variant="caption" color="textSecondary">nenhum</Typography>
                    }
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </div>
  );
}

// ── Aba 3: Cupons ─────────────────────────────────────────────────

function TabCupons() {
  const classes = useStyles();
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Lista cupons de aniversário da empresa (via birthday-stats já temos o count;
      // aqui pedimos os recentes via endpoint de admin se existir, senão mostramos o resumo)
      const { data } = await api.get("/retention/birthday-stats");
      // Reutiliza os dados do birthday-stats para mostrar cupons recentes
      setCoupons(data?.couponStats ?? {});
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Box className={classes.loadingBox}><CircularProgress /></Box>;

  return (
    <div>
      <div className={classes.headerRow}>
        <Typography className={classes.sectionTitle}>
          Resumo de cupons de aniversário
        </Typography>
        <Tooltip title="Atualizar">
          <IconButton size="small" className={classes.refreshBtn} onClick={load}>
            <FiRefreshCw size={16} />
          </IconButton>
        </Tooltip>
      </div>

      <div className={classes.statsRow}>
        <StatCard value={coupons.generated ?? 0} label="Cupons gerados" />
        <StatCard value={coupons.redeemed ?? 0} label="Resgatados" />
        <StatCard value={`${coupons.redemptionRate ?? 0}%`} label="Taxa de resgate" />
        <StatCard value={(coupons.generated ?? 0) - (coupons.redeemed ?? 0)} label="Disponíveis" />
      </div>

      <Box className={classes.emptyBox} style={{ marginTop: 24 }}>
        <FiGift size={40} style={{ opacity: 0.2, marginBottom: 8 }} />
        <Typography variant="body2">
          Detalhamento individual de cupons será exibido aqui em breve.
        </Typography>
        <Typography variant="caption" color="textSecondary">
          Os cupons são gerados automaticamente no toque D-0 de cada aniversariante.
        </Typography>
      </Box>
    </div>
  );
}

// ── Aba 4: Preventivo (Fase 3A) ───────────────────────────────────

function TabPreventivo() {
  const classes = useStyles();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get("/retention/preventive-stats?days=30");
      setData(res);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Box className={classes.loadingBox}><CircularProgress /></Box>;
  if (!data) return null;

  return (
    <div>
      <div className={classes.headerRow}>
        <Typography className={classes.sectionTitle}>
          Lembrete preventivo — últimos {data.windowDays} dias
        </Typography>
        <Tooltip title="Atualizar">
          <IconButton size="small" className={classes.refreshBtn} onClick={load}>
            <FiRefreshCw size={16} />
          </IconButton>
        </Tooltip>
      </div>
      <div className={classes.statsRow}>
        <StatCard value={data.totalSent} label="Toques enviados" />
        <StatCard value={data.returnedCount} label="Clientes que voltaram" />
        <StatCard value={`${data.returnRate}%`} label="Taxa de retorno" />
      </div>
      <Box className={classes.emptyBox} style={{ marginTop: 24 }}>
        <FiBell size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
        <Typography variant="caption" color="textSecondary">
          Dispara automaticamente quando o cliente atinge ~80% do seu intervalo médio sem voltar.
        </Typography>
      </Box>
    </div>
  );
}

// ── Aba 5: Fidelidade (Fase 3B) ───────────────────────────────────

function TabFidelidade() {
  const classes = useStyles();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get("/retention/loyalty-stats");
      setData(res);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Box className={classes.loadingBox}><CircularProgress /></Box>;
  if (!data) return null;

  const milestones = data.byMilestone || {};
  const sortedMilestones = Object.keys(milestones).sort((a, b) => Number(a) - Number(b));

  return (
    <div>
      <div className={classes.headerRow}>
        <Typography className={classes.sectionTitle}>Programa de fidelidade</Typography>
        <Tooltip title="Atualizar">
          <IconButton size="small" className={classes.refreshBtn} onClick={load}>
            <FiRefreshCw size={16} />
          </IconButton>
        </Tooltip>
      </div>
      <div className={classes.statsRow}>
        <StatCard value={data.totalAwarded} label="Recompensas entregues" />
        <StatCard value={data.totalRedeemed} label="Resgatadas" />
        <StatCard value={`${data.redemptionRate}%`} label="Taxa de resgate" />
      </div>

      {sortedMilestones.length > 0 && (
        <>
          <Typography className={classes.sectionTitle} style={{ marginTop: 16 }}>
            Distribuição por marco
          </Typography>
          <div className={classes.statsRow}>
            {sortedMilestones.map(m => (
              <StatCard key={m} value={milestones[m]} label={`Marco ${m}`} />
            ))}
          </div>
        </>
      )}

      <Box className={classes.emptyBox} style={{ marginTop: 24 }}>
        <FiAward size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
        <Typography variant="caption" color="textSecondary">
          Cupons entregues automaticamente quando o cliente completa marcos (5, 10, 20...).
        </Typography>
      </Box>
    </div>
  );
}

// ── Aba 6: Win-back (Fase 3C) ─────────────────────────────────────

function TabWinback() {
  const classes = useStyles();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get("/retention/winback-stats?days=180");
      setData(res);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Box className={classes.loadingBox}><CircularProgress /></Box>;
  if (!data) return null;

  return (
    <div>
      <div className={classes.headerRow}>
        <Typography className={classes.sectionTitle}>
          Win-back — últimos {data.windowDays} dias
        </Typography>
        <Tooltip title="Atualizar">
          <IconButton size="small" className={classes.refreshBtn} onClick={load}>
            <FiRefreshCw size={16} />
          </IconButton>
        </Tooltip>
      </div>
      <div className={classes.statsRow}>
        <StatCard value={data.totalSent} label="Tentativas" />
        <StatCard value={data.converted} label="Convertidas" />
        <StatCard value={data.pending} label="Pendentes" />
        <StatCard value={`${data.conversionRate}%`} label="Taxa de conversão" />
      </div>
      <Box className={classes.emptyBox} style={{ marginTop: 24 }}>
        <FiHeart size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
        <Typography variant="caption" color="textSecondary">
          Reativação automática de clientes "adormecidos" e "perdidos" com cupom de alto valor.
        </Typography>
      </Box>
    </div>
  );
}

// ── Aba 7: RFM (Fase 4A) ──────────────────────────────────────────

function TabRFM() {
  const classes = useStyles();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get("/retention/rfm-segments");
      setData(res);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Box className={classes.loadingBox}><CircularProgress /></Box>;
  if (!data) return null;

  return (
    <div>
      <div className={classes.headerRow}>
        <Typography className={classes.sectionTitle}>Segmentação RFM</Typography>
        <Tooltip title="Atualizar">
          <IconButton size="small" className={classes.refreshBtn} onClick={load}>
            <FiRefreshCw size={16} />
          </IconButton>
        </Tooltip>
      </div>
      <Typography variant="caption" color="textSecondary" style={{ display: "block", marginBottom: 12 }}>
        Total: {data.total} clientes analisados (Recência, Frequência, Valor Monetário)
      </Typography>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Segmento</TableCell>
              <TableCell align="right">Quantidade</TableCell>
              <TableCell align="right">% da base</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data.distribution || []).map(seg => (
              <TableRow key={seg.segment} hover>
                <TableCell>{seg.label}</TableCell>
                <TableCell align="right">{seg.count}</TableCell>
                <TableCell align="right">{seg.percentage}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </div>
  );
}

// ── Aba 8: Cross-sell (Fase 4B) ───────────────────────────────────

function TabCrossSell() {
  const classes = useStyles();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get("/retention/cross-sell/pairs?limit=20");
      setData(res);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Box className={classes.loadingBox}><CircularProgress /></Box>;
  if (!data) return null;

  return (
    <div>
      <div className={classes.headerRow}>
        <Typography className={classes.sectionTitle}>Pares de serviços frequentes</Typography>
        <Tooltip title="Atualizar">
          <IconButton size="small" className={classes.refreshBtn} onClick={load}>
            <FiRefreshCw size={16} />
          </IconButton>
        </Tooltip>
      </div>
      <Typography variant="caption" color="textSecondary" style={{ display: "block", marginBottom: 12 }}>
        Identifica oportunidades de combo: serviços frequentemente comprados juntos
      </Typography>

      {(data.pairs || []).length === 0 ? (
        <div className={classes.emptyBox}>
          <FiShoppingBag size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
          <Typography variant="body2">Ainda não há dados suficientes para identificar pares.</Typography>
          <Typography variant="caption" color="textSecondary">
            Cadastre serviços nos atendimentos (campo `serviceType`) para alimentar a análise.
          </Typography>
        </div>
      ) : (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Serviço A</TableCell>
                <TableCell>Serviço B</TableCell>
                <TableCell align="right">Clientes em comum</TableCell>
                <TableCell align="right">A → B</TableCell>
                <TableCell align="right">B → A</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.pairs.map((p, i) => (
                <TableRow key={i} hover>
                  <TableCell>{p.a}</TableCell>
                  <TableCell>{p.b}</TableCell>
                  <TableCell align="right">{p.cooccurrence}</TableCell>
                  <TableCell align="right">{p.confidenceAtoB}%</TableCell>
                  <TableCell align="right">{p.confidenceBtoA}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </div>
  );
}

// ── Aba 9: Indicações (Fase 4C) ───────────────────────────────────

function TabIndicacoes() {
  const classes = useStyles();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get("/retention/referral-stats");
      setData(res);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Box className={classes.loadingBox}><CircularProgress /></Box>;
  if (!data) return null;

  return (
    <div>
      <div className={classes.headerRow}>
        <Typography className={classes.sectionTitle}>Programa de indicação</Typography>
        <Tooltip title="Atualizar">
          <IconButton size="small" className={classes.refreshBtn} onClick={load}>
            <FiRefreshCw size={16} />
          </IconButton>
        </Tooltip>
      </div>
      <div className={classes.statsRow}>
        <StatCard value={data.total} label="Total indicações" />
        <StatCard value={data.converted} label="Convertidas" />
        <StatCard value={data.pending} label="Pendentes" />
        <StatCard value={`${data.conversionRate}%`} label="Taxa de conversão" />
      </div>
      <Box className={classes.emptyBox} style={{ marginTop: 24 }}>
        <FiShare2 size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
        <Typography variant="caption" color="textSecondary">
          Cada contato tem um código único. Quando o indicado completa o 1º serviço, ambos ganham cupom.
        </Typography>
      </Box>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────

const Retencao = () => {
  const classes = useStyles();
  const [tab, setTab] = useState(0);

  return (
    <MainContainer>
      <MainHeader>
        <Title>
          <FiRefreshCw size={20} style={{ marginRight: 8, verticalAlign: "middle" }} />
          Retenção de Clientes
        </Title>
      </MainHeader>

      <Paper className={classes.root}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label={<span><FiUsers size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />Adormecidos</span>} />
          <Tab label={<span><FiCalendar size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />Aniversários</span>} />
          <Tab label={<span><FiBell size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />Preventivo</span>} />
          <Tab label={<span><FiAward size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />Fidelidade</span>} />
          <Tab label={<span><FiHeart size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />Win-back</span>} />
          <Tab label={<span><FiPieChart size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />RFM</span>} />
          <Tab label={<span><FiShoppingBag size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />Cross-sell</span>} />
          <Tab label={<span><FiShare2 size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />Indicações</span>} />
          <Tab label={<span><FiGift size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />Cupons</span>} />
        </Tabs>

        <div className={classes.tabPanel}>
          <TabPanel value={tab} index={0}><TabAdormecidos /></TabPanel>
          <TabPanel value={tab} index={1}><TabAniversarios /></TabPanel>
          <TabPanel value={tab} index={2}><TabPreventivo /></TabPanel>
          <TabPanel value={tab} index={3}><TabFidelidade /></TabPanel>
          <TabPanel value={tab} index={4}><TabWinback /></TabPanel>
          <TabPanel value={tab} index={5}><TabRFM /></TabPanel>
          <TabPanel value={tab} index={6}><TabCrossSell /></TabPanel>
          <TabPanel value={tab} index={7}><TabIndicacoes /></TabPanel>
          <TabPanel value={tab} index={8}><TabCupons /></TabPanel>
        </div>
      </Paper>
    </MainContainer>
  );
};

export default Retencao;
