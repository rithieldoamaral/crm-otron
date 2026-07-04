/**
 * Dashboard 2.0 — redesign BI-quality
 *
 * Estrutura em 3 zonas:
 *   1. Barra de filtros  — presets rápidos + período personalizado + fila
 *   2. KPI Cards         — ao vivo (cinza) e do período (coloridos por semântica)
 *   3. Equipe & Análise  — tabela de atendentes + gráficos
 *
 * Backend: usa /dashboard/v2 que suporta queue_id e user_id adicionais.
 * Fallback ao v1 se v2 não estiver disponível ainda.
 */

import React, { useContext, useState, useEffect, useCallback } from "react";
import {
  Box,
  Button,
  ButtonGroup,
  Chip,
  CircularProgress,
  Container,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography
} from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import { green, orange, blue, purple, teal, grey } from "@material-ui/core/colors";
import { toast } from "react-toastify";
import moment from "moment";
import { isArray } from "lodash";

// Ícones
import AccessAlarmIcon from "@material-ui/icons/AccessAlarm";
import CallIcon from "@material-ui/icons/Call";
import CheckCircleIcon from "@material-ui/icons/CheckCircle";
import FilterListIcon from "@material-ui/icons/FilterList";
import GroupAddIcon from "@material-ui/icons/GroupAdd";
import HourglassEmptyIcon from "@material-ui/icons/HourglassEmpty";
import MobileFriendlyIcon from "@material-ui/icons/MobileFriendly";
import RefreshIcon from "@material-ui/icons/Refresh";
import StoreIcon from "@material-ui/icons/Store";
import TimerIcon from "@material-ui/icons/Timer";
import TrendingUpIcon from "@material-ui/icons/TrendingUp";

// Componentes e contexto
import { AuthContext } from "../../context/Auth/AuthContext";
import { i18n } from "../../translate/i18n";
import TableAttendantsStatus from "../../components/Dashboard/TableAttendantsStatus";
import { ChatsUser } from "./ChartsUser";
import { ChartsDate } from "./ChartsDate";
import ChartsAppointmentsAtendent from "./ChartsAppointmentsAtendent";
import ChartsRushHour from "./ChartsRushHour";
import ChartsDepartamentRatings from "./ChartsDepartamentRatings";
import api from "../../services/api";

// ─── Estilos ────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  root: {
    paddingTop: theme.spacing(3),
    paddingBottom: theme.spacing(6),
  },
  sectionLabel: {
    fontSize: "0.7rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "1px",
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(1.5),
    marginTop: theme.spacing(3),
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  sectionDivider: {
    marginBottom: theme.spacing(2),
  },

  // ── Filtros ─────────────────────────────────────────────────────────────
  filterPaper: {
    padding: theme.spacing(2),
    marginBottom: theme.spacing(1),
    borderRadius: theme.shape.borderRadius * 2,
  },
  presetGroup: {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
  presetChip: {
    cursor: "pointer",
    fontWeight: 500,
    "&.active": {
      backgroundColor: theme.palette.primary.main,
      color: theme.palette.primary.contrastText,
    }
  },

  // ── Cards ────────────────────────────────────────────────────────────────
  card: {
    padding: theme.spacing(2),
    borderRadius: 14,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    "&:hover": {
      transform: "translateY(-2px)",
    }
  },
  cardTitle: {
    fontSize: "0.78rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: theme.spacing(1),
    opacity: 0.85,
  },
  cardValue: {
    fontSize: "2rem",
    fontWeight: 800,
    lineHeight: 1,
  },
  cardIcon: {
    fontSize: "2rem",
    opacity: 0.6,
    alignSelf: "flex-end",
  },
  cardRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },

  // Variantes de cor por semântica
  cardLive: {
    background: theme.palette.type === "dark"
      ? `linear-gradient(135deg, #1565C0 0%, #0D47A1 100%)`
      : `linear-gradient(135deg, ${blue[500]} 0%, ${blue[700]} 100%)`,
    color: "#fff",
    boxShadow: `0 4px 14px rgba(21, 101, 192, 0.3)`,
  },
  cardWarning: {
    background: theme.palette.type === "dark"
      ? `linear-gradient(135deg, #E65100 0%, #BF360C 100%)`
      : `linear-gradient(135deg, ${orange[500]} 0%, ${orange[700]} 100%)`,
    color: "#fff",
    boxShadow: `0 4px 14px rgba(230, 81, 0, 0.3)`,
  },
  cardSuccess: {
    background: theme.palette.type === "dark"
      ? `linear-gradient(135deg, #2E7D32 0%, #1B5E20 100%)`
      : `linear-gradient(135deg, ${green[500]} 0%, ${green[700]} 100%)`,
    color: "#fff",
    boxShadow: `0 4px 14px rgba(46, 125, 50, 0.3)`,
  },
  cardPurple: {
    background: `linear-gradient(135deg, ${purple[400]} 0%, ${purple[700]} 100%)`,
    color: "#fff",
    boxShadow: `0 4px 14px rgba(156, 39, 176, 0.25)`,
  },
  cardTeal: {
    background: `linear-gradient(135deg, ${teal[400]} 0%, ${teal[700]} 100%)`,
    color: "#fff",
    boxShadow: `0 4px 14px rgba(0, 150, 136, 0.25)`,
  },
  cardGrey: {
    background: theme.palette.type === "dark"
      ? `linear-gradient(135deg, #424242 0%, #212121 100%)`
      : `linear-gradient(135deg, ${grey[400]} 0%, ${grey[600]} 100%)`,
    color: "#fff",
    boxShadow: `0 4px 14px rgba(97, 97, 97, 0.2)`,
  },

  // ── Charts ───────────────────────────────────────────────────────────────
  chartPaper: {
    padding: theme.spacing(3),
    borderRadius: theme.shape.borderRadius * 2,
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
}));

// ─── Presets de período ──────────────────────────────────────────────────────

const PRESETS = [
  {
    label: "Hoje",
    dateFrom: () => moment().format("YYYY-MM-DD"),
    dateTo: () => moment().format("YYYY-MM-DD"),
  },
  {
    label: "Ontem",
    dateFrom: () => moment().subtract(1, "days").format("YYYY-MM-DD"),
    dateTo: () => moment().subtract(1, "days").format("YYYY-MM-DD"),
  },
  {
    label: "7 dias",
    dateFrom: () => moment().subtract(6, "days").format("YYYY-MM-DD"),
    dateTo: () => moment().format("YYYY-MM-DD"),
  },
  {
    label: "30 dias",
    dateFrom: () => moment().subtract(29, "days").format("YYYY-MM-DD"),
    dateTo: () => moment().format("YYYY-MM-DD"),
  },
  {
    label: "Este mês",
    dateFrom: () => moment().startOf("month").format("YYYY-MM-DD"),
    dateTo: () => moment().format("YYYY-MM-DD"),
  },
  {
    label: "Mês anterior",
    dateFrom: () => moment().subtract(1, "month").startOf("month").format("YYYY-MM-DD"),
    dateTo: () => moment().subtract(1, "month").endOf("month").format("YYYY-MM-DD"),
  },
];

// ─── Card KPI ────────────────────────────────────────────────────────────────

function KpiCard({ title, value, icon: Icon, colorClass }) {
  const classes = useStyles();
  return (
    <Paper className={`${classes.card} ${classes[colorClass]}`} elevation={0}>
      <Typography className={classes.cardTitle}>{title}</Typography>
      <div className={classes.cardRow}>
        <Typography className={classes.cardValue}>{value ?? 0}</Typography>
        {Icon && <Icon className={classes.cardIcon} />}
      </div>
    </Paper>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

const Dashboard = () => {
  const classes = useStyles();
  const { user } = useContext(AuthContext);

  const [counters, setCounters] = useState({});
  const [attendants, setAttendants] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filtros
  const [dateFrom, setDateFrom] = useState(moment().format("YYYY-MM-DD"));
  const [dateTo, setDateTo] = useState(moment().format("YYYY-MM-DD"));
  const [activePreset, setActivePreset] = useState("Hoje");
  const [queueId, setQueueId] = useState("");
  const [queues, setQueues] = useState([]);
  const [queuesLoading, setQueuesLoading] = useState(false);

  // Carrega filas para o filtro
  useEffect(() => {
    setQueuesLoading(true);
    api.get("/queue").then(({ data }) => {
      setQueues(isArray(data) ? data : []);
    }).catch(() => {
      // Silencia erro — fila só é visual, não quebra o dashboard
    }).finally(() => setQueuesLoading(false));
  }, []);

  const fetchData = useCallback(async (from = dateFrom, to = dateTo, queue = queueId) => {
    if (!from || !to) {
      toast.error("Selecione um período válido.");
      return;
    }

    setLoading(true);
    try {
      const params = {
        date_from: from,
        date_to: to,
        ...(queue ? { queue_id: queue } : {})
      };

      const { data } = await api.get("/dashboard/v2", { params });
      setCounters(data.counters ?? {});
      setAttendants(isArray(data.attendants) ? data.attendants : []);
    } catch (err) {
      // Fallback ao v1 se v2 não estiver disponível (migração ainda não rodou)
      try {
        const { data } = await api.get("/dashboard", {
          params: { date_from: from, date_to: to }
        });
        setCounters(data.counters ?? {});
        setAttendants(isArray(data.attendants) ? data.attendants : []);
      } catch {
        toast.error("Erro ao carregar dados do dashboard.");
      }
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, queueId]);

  // Carrega com preset "Hoje" na inicialização
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(preset) {
    const from = preset.dateFrom();
    const to = preset.dateTo();
    setDateFrom(from);
    setDateTo(to);
    setActivePreset(preset.label);
    fetchData(from, to, queueId);
  }

  function handleFilter() {
    setActivePreset("Personalizado");
    fetchData(dateFrom, dateTo, queueId);
  }

  function handleQueueChange(e) {
    setQueueId(e.target.value);
    fetchData(dateFrom, dateTo, e.target.value);
  }

  function formatTime(minutes) {
    if (!minutes || minutes === 0) return "0h 00m";
    return moment().startOf("day").add(minutes, "minutes").format("H[h] mm[m]");
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Container maxWidth="xl" className={classes.root}>
      <Grid container spacing={3}>

        {/* ── Barra de Filtros ───────────────────────────────────────────── */}
        <Grid item xs={12}>
          <Paper className={classes.filterPaper} elevation={1}>
            {/* Presets rápidos */}
            <div className={classes.presetGroup}>
              <Typography
                variant="caption"
                style={{ alignSelf: "center", fontWeight: 600, marginRight: 4, color: "inherit" }}
              >
                <FilterListIcon style={{ fontSize: 14, marginRight: 4, verticalAlign: "middle" }} />
                Período:
              </Typography>
              {PRESETS.map((p) => (
                <Chip
                  key={p.label}
                  label={p.label}
                  size="small"
                  clickable
                  color={activePreset === p.label ? "primary" : "default"}
                  onClick={() => applyPreset(p)}
                  style={{ fontWeight: activePreset === p.label ? 700 : 400 }}
                />
              ))}
            </div>

            {/* Personalizado + Fila */}
            <Grid container spacing={2} alignItems="flex-end">
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="De"
                  type="date"
                  variant="outlined"
                  size="small"
                  fullWidth
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setActivePreset("Personalizado"); }}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="Até"
                  type="date"
                  variant="outlined"
                  size="small"
                  fullWidth
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setActivePreset("Personalizado"); }}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <FormControl variant="outlined" size="small" fullWidth>
                  <InputLabel>Departamento</InputLabel>
                  <Select
                    value={queueId}
                    onChange={handleQueueChange}
                    label="Departamento"
                    disabled={queuesLoading}
                  >
                    <MenuItem value="">Todos os departamentos</MenuItem>
                    {queues.map((q) => (
                      <MenuItem key={q.id} value={q.id}>{q.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Button
                  variant="contained"
                  color="primary"
                  size="medium"
                  fullWidth
                  onClick={handleFilter}
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                >
                  {loading ? "Carregando..." : "Atualizar"}
                </Button>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        {/* ── Zona 1: KPIs ao vivo ──────────────────────────────────────── */}
        <Grid item xs={12}>
          <div className={classes.sectionLabel}>
            📡 Ao vivo — agora
          </div>
          <Divider className={classes.sectionDivider} />
        </Grid>

        <Grid item xs={6} sm={4} md={3} lg={2}>
          <KpiCard
            title="Em Atendimento"
            value={counters.supportHappening}
            icon={CallIcon}
            colorClass="cardLive"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3} lg={2}>
          <KpiCard
            title="Aguardando"
            value={counters.supportPending}
            icon={HourglassEmptyIcon}
            colorClass="cardWarning"
          />
        </Grid>
        {user.super && (
          <Grid item xs={6} sm={4} md={3} lg={2}>
            <KpiCard
              title="Conexões Ativas"
              value={counters.totalWhatsappSessions}
              icon={MobileFriendlyIcon}
              colorClass="cardGrey"
            />
          </Grid>
        )}
        {user.super && (
          <Grid item xs={6} sm={4} md={3} lg={2}>
            <KpiCard
              title="Empresas"
              value={counters.totalCompanies}
              icon={StoreIcon}
              colorClass="cardGrey"
            />
          </Grid>
        )}

        {/* ── Zona 2: KPIs do período ───────────────────────────────────── */}
        <Grid item xs={12}>
          <div className={classes.sectionLabel} style={{ marginTop: 24 }}>
            📊 Métricas do período selecionado
          </div>
          <Divider className={classes.sectionDivider} />
        </Grid>

        <Grid item xs={6} sm={4} md={3} lg={2}>
          <KpiCard
            title="Finalizados"
            value={counters.supportFinished}
            icon={CheckCircleIcon}
            colorClass="cardSuccess"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3} lg={2}>
          <KpiCard
            title="Novos Leads"
            value={counters.leads}
            icon={GroupAddIcon}
            colorClass="cardTeal"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3} lg={2}>
          <KpiCard
            title="T.M. Atendimento"
            value={formatTime(counters.avgSupportTime)}
            icon={AccessAlarmIcon}
            colorClass="cardPurple"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3} lg={2}>
          <KpiCard
            title="T.M. Espera"
            value={formatTime(counters.avgWaitTime)}
            icon={TimerIcon}
            colorClass="cardPurple"
          />
        </Grid>

        {/* ── Zona 3: Equipe & Análise ──────────────────────────────────── */}
        <Grid item xs={12}>
          <div className={classes.sectionLabel} style={{ marginTop: 24 }}>
            👥 Equipe & Análise
          </div>
          <Divider className={classes.sectionDivider} />
        </Grid>

        {attendants.length > 0 && (
          <Grid item xs={12}>
            <Paper className={classes.chartPaper} elevation={1}>
              <TableAttendantsStatus attendants={attendants} loading={loading} />
            </Paper>
          </Grid>
        )}

        <Grid item xs={12}>
          <Paper className={classes.chartPaper} elevation={1}>
            <ChatsUser />
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper className={classes.chartPaper} elevation={1}>
            <ChartsDate />
          </Paper>
        </Grid>

        <ChartsAppointmentsAtendent />
        <ChartsRushHour />
        <ChartsDepartamentRatings />

      </Grid>
    </Container>
  );
};

export default Dashboard;
