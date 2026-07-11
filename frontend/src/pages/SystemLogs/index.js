/**
 * SystemLogs — página de auditoria do sistema (superadmin only).
 *
 * Acesso: apenas usuários com super = true.
 * Se não-superadmin tentar acessar diretamente via URL, o middleware isSuper
 * do backend retorna 401 e o frontend exibe mensagem de erro.
 *
 * Features:
 * - Tabela paginada de logs (50/página)
 * - Filtros: empresa, tipo de ação, período (dateFrom / dateTo)
 * - Badge colorido por categoria de ação
 * - Collapse de detalhes JSON inline
 * - Exportação CSV simples
 */

import React, { useState, useEffect, useCallback, useContext } from "react";
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TablePagination,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Grid,
  Chip,
  Collapse,
  IconButton,
  CircularProgress,
  Button,
  Tooltip
} from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import { KeyboardArrowDown, KeyboardArrowUp, GetApp as DownloadIcon, Refresh as RefreshIcon } from "@material-ui/icons";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import api from "../../services/api";
import { AuthContext } from "../../context/Auth/AuthContext";
import { useHistory } from "react-router-dom";
import { toast } from "react-toastify";

// ─── Estilos ────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  root: {
    padding: theme.spacing(3),
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing(3),
  },
  filterPaper: {
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  filterRow: {
    display: "flex",
    gap: theme.spacing(2),
    flexWrap: "wrap",
    alignItems: "flex-end",
  },
  filterField: {
    minWidth: 160,
    flex: "1 1 160px",
  },
  tablePaper: {
    overflowX: "auto",
  },
  tableHead: {
    backgroundColor: theme.palette.type === "dark"
      ? theme.palette.grey[800]
      : theme.palette.grey[100],
  },
  actionChip: {
    fontSize: "0.7rem",
    height: 22,
  },
  detailsCell: {
    paddingBottom: 0,
    paddingTop: 0,
    backgroundColor: theme.palette.type === "dark"
      ? theme.palette.grey[900]
      : theme.palette.grey[50],
  },
  detailsJson: {
    fontFamily: "monospace",
    fontSize: "0.8rem",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    maxHeight: 200,
    overflowY: "auto",
    padding: theme.spacing(1),
  },
  emptyState: {
    textAlign: "center",
    padding: theme.spacing(6),
    color: theme.palette.text.secondary,
  },
  actionsBar: {
    display: "flex",
    gap: theme.spacing(1),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

// Mapeia prefixos de ação para cor do chip
function getActionColor(action) {
  if (!action) return "default";
  if (action.startsWith("user.login")) return "primary";
  if (action.startsWith("user.")) return "default";
  if (action.startsWith("ticket.")) return "secondary";
  if (action.startsWith("setting.")) return "default";
  if (action.startsWith("agent.")) return "primary";
  if (action.startsWith("company.") || action.startsWith("backup.")) return "default";
  return "default";
}

function formatDateTime(iso) {
  try {
    return format(parseISO(iso), "dd/MM/yyyy HH:mm:ss", { locale: ptBR });
  } catch {
    return iso ?? "—";
  }
}

// ─── Linha da tabela com detalhes expansíveis ────────────────────────────────

function LogRow({ log }) {
  const classes = useStyles();
  const [open, setOpen] = useState(false);
  const hasDetails = log.details && Object.keys(log.details).length > 0;

  return (
    <>
      <TableRow hover>
        <TableCell padding="checkbox">
          {hasDetails && (
            <IconButton size="small" onClick={() => setOpen(!open)}>
              {open ? <KeyboardArrowUp fontSize="small" /> : <KeyboardArrowDown fontSize="small" />}
            </IconButton>
          )}
        </TableCell>
        <TableCell>
          <Typography variant="caption" style={{ whiteSpace: "nowrap" }}>
            {formatDateTime(log.createdAt)}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2" noWrap style={{ maxWidth: 140 }}>
            {log.company?.name ?? <em style={{ color: "#aaa" }}>—</em>}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2" noWrap style={{ maxWidth: 140 }}>
            {log.user?.name ?? <em style={{ color: "#aaa" }}>sistema</em>}
          </Typography>
        </TableCell>
        <TableCell>
          <Chip
            label={log.action}
            size="small"
            color={getActionColor(log.action)}
            className={classes.actionChip}
          />
        </TableCell>
        <TableCell>
          <Typography variant="body2">
            {log.entity ? `${log.entity}${log.entityId ? ` #${log.entityId}` : ""}` : "—"}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography variant="caption" style={{ color: "#aaa" }}>
            {log.ip ?? "—"}
          </Typography>
        </TableCell>
      </TableRow>

      {hasDetails && (
        <TableRow>
          <TableCell colSpan={7} className={classes.detailsCell}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <pre className={classes.detailsJson}>
                {JSON.stringify(log.details, null, 2)}
              </pre>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Ações pré-definidas para o filtro ───────────────────────────────────────

const ACTION_OPTIONS = [
  { value: "", label: "Todas as ações" },
  { value: "user.login", label: "Login" },
  { value: "user.login_failed", label: "Login falhou" },
  { value: "user.logout", label: "Logout" },
  { value: "user.created", label: "Usuário criado" },
  { value: "user.updated", label: "Usuário atualizado" },
  { value: "user.deleted", label: "Usuário deletado" },
  { value: "ticket.created", label: "Ticket criado" },
  { value: "ticket.closed", label: "Ticket fechado" },
  { value: "ticket.transferred", label: "Ticket transferido" },
  { value: "setting.updated", label: "Configuração alterada" },
  { value: "agent.tool_call", label: "Agente: tool call" },
  { value: "agent.session_start", label: "Agente: sessão iniciada" },
  { value: "company.created", label: "Empresa criada" },
  { value: "backup.created", label: "Backup criado" },
];

// ─── Componente principal ────────────────────────────────────────────────────

const SystemLogs = () => {
  const classes = useStyles();
  const { user } = useContext(AuthContext);
  const history = useHistory();

  // Redireciona se não é superadmin
  useEffect(() => {
    if (user && !user.super) {
      history.push("/");
    }
  }, [user, history]);

  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState([]);

  // Filtros
  const [companyId, setCompanyId] = useState("");
  const [action, setAction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Paginação
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page: page + 1,
        limit: rowsPerPage,
        ...(companyId && { companyId }),
        ...(action && { action }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
      };

      const { data } = await api.get("/logs", { params });
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      toast.error("Erro ao carregar logs. Verifique suas permissões.");
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, companyId, action, dateFrom, dateTo]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Carrega a lista de empresas uma vez, para o dropdown de filtro (evita o
  // usuário ter que decorar/digitar o ID numérico da empresa).
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/companies/list");
        setCompanies(data);
      } catch (err) {
        toast.error("Erro ao carregar lista de empresas.");
      }
    })();
  }, []);

  // Reset de página ao mudar filtros
  const handleFilterChange = (setter) => (e) => {
    setter(e.target.value);
    setPage(0);
  };

  // Exportação CSV simples dos dados já carregados na página
  const handleExportCSV = () => {
    const header = ["Data/Hora", "Empresa", "Usuário", "Ação", "Entidade", "EntityID", "IP"];
    const rows = logs.map((l) => [
      formatDateTime(l.createdAt),
      l.company?.name ?? "",
      l.user?.name ?? "sistema",
      l.action,
      l.entity ?? "",
      l.entityId ?? "",
      l.ip ?? "",
    ]);

    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box className={classes.root}>
      {/* Cabeçalho */}
      <div className={classes.header}>
        <Typography variant="h5" style={{ fontWeight: 600 }}>
          Logs de Auditoria
        </Typography>
        <div className={classes.actionsBar}>
          <Tooltip title="Exportar página atual como CSV">
            <Button
              variant="outlined"
              size="small"
              startIcon={<DownloadIcon />}
              onClick={handleExportCSV}
              disabled={logs.length === 0}
            >
              Exportar CSV
            </Button>
          </Tooltip>
          <Tooltip title="Recarregar">
            <IconButton size="small" onClick={fetchLogs} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {/* Filtros */}
      <Paper className={classes.filterPaper} elevation={1}>
        <Grid container spacing={2} alignItems="flex-end">
          <Grid item className={classes.filterField}>
            <FormControl variant="outlined" size="small" fullWidth>
              <InputLabel>Empresa</InputLabel>
              <Select
                value={companyId}
                onChange={handleFilterChange(setCompanyId)}
                label="Empresa"
              >
                <MenuItem value="">Todas as empresas</MenuItem>
                {companies.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item className={classes.filterField}>
            <FormControl variant="outlined" size="small" fullWidth>
              <InputLabel>Ação</InputLabel>
              <Select
                value={action}
                onChange={handleFilterChange(setAction)}
                label="Ação"
              >
                {ACTION_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item className={classes.filterField}>
            <TextField
              label="Data inicial"
              type="date"
              variant="outlined"
              size="small"
              fullWidth
              value={dateFrom}
              onChange={handleFilterChange(setDateFrom)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item className={classes.filterField}>
            <TextField
              label="Data final"
              type="date"
              variant="outlined"
              size="small"
              fullWidth
              value={dateTo}
              onChange={handleFilterChange(setDateTo)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item>
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                setCompanyId("");
                setAction("");
                setDateFrom("");
                setDateTo("");
                setPage(0);
              }}
            >
              Limpar
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Tabela */}
      <Paper className={classes.tablePaper} elevation={1}>
        {loading && (
          <Box display="flex" justifyContent="center" padding={3}>
            <CircularProgress size={28} />
          </Box>
        )}

        {!loading && (
          <Table size="small">
            <TableHead className={classes.tableHead}>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell><strong>Data/Hora</strong></TableCell>
                <TableCell><strong>Empresa</strong></TableCell>
                <TableCell><strong>Usuário</strong></TableCell>
                <TableCell><strong>Ação</strong></TableCell>
                <TableCell><strong>Entidade</strong></TableCell>
                <TableCell><strong>IP</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className={classes.emptyState}>
                      <Typography variant="body2">
                        Nenhum log encontrado para os filtros selecionados.
                      </Typography>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => <LogRow key={log.id} log={log} />)
              )}
            </TableBody>
          </Table>
        )}

        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100, 200]}
          labelRowsPerPage="Por página:"
          labelDisplayedRows={({ from, to, count }) =>
            `${from}–${to} de ${count !== -1 ? count : `mais de ${to}`}`
          }
        />
      </Paper>
    </Box>
  );
};

export default SystemLogs;
