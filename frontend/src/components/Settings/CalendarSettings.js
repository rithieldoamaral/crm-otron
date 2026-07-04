import React, { useEffect, useState } from "react";
import Paper from "@material-ui/core/Paper";
import Typography from "@material-ui/core/Typography";
import Button from "@material-ui/core/Button";
import Grid from "@material-ui/core/Grid";
import CircularProgress from "@material-ui/core/CircularProgress";
import Table from "@material-ui/core/Table";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import TableCell from "@material-ui/core/TableCell";
import TableBody from "@material-ui/core/TableBody";
import Select from "@material-ui/core/Select";
import MenuItem from "@material-ui/core/MenuItem";
import TextField from "@material-ui/core/TextField";
import Switch from "@material-ui/core/Switch";
import FormControlLabel from "@material-ui/core/FormControlLabel";
import Chip from "@material-ui/core/Chip";
import Divider from "@material-ui/core/Divider";
import IconButton from "@material-ui/core/IconButton";
import Dialog from "@material-ui/core/Dialog";
import DialogTitle from "@material-ui/core/DialogTitle";
import DialogContent from "@material-ui/core/DialogContent";
import DialogActions from "@material-ui/core/DialogActions";
import LinkIcon from "@material-ui/icons/Link";
import LinkOffIcon from "@material-ui/icons/LinkOff";
import CheckCircleIcon from "@material-ui/icons/CheckCircle";
import ErrorIcon from "@material-ui/icons/Error";
import WarningIcon from "@material-ui/icons/Warning";
import EditIcon from "@material-ui/icons/Edit";
import DeleteIcon from "@material-ui/icons/Delete";
import AddIcon from "@material-ui/icons/Add";
import { makeStyles } from "@material-ui/core/styles";
import { toast } from "react-toastify";
import api from "../../services/api";

const DAYS = [
  { day: 0, label: "Domingo" },
  { day: 1, label: "Segunda-feira" },
  { day: 2, label: "Terça-feira" },
  { day: 3, label: "Quarta-feira" },
  { day: 4, label: "Quinta-feira" },
  { day: 5, label: "Sexta-feira" },
  { day: 6, label: "Sábado" },
];

const DEFAULT_HOURS = DAYS.map(({ day }) => ({
  dayOfWeek: day,
  startTime: "09:00",
  endTime: "18:00",
  isWorking: day >= 1 && day <= 5,
}));

const useStyles = makeStyles((theme) => ({
  paper: { padding: theme.spacing(2), marginBottom: theme.spacing(2) },
  sectionTitle: { marginBottom: theme.spacing(1), marginTop: theme.spacing(2) },
  connectedChip: { backgroundColor: "#4caf50", color: "#fff" },
  disconnectedChip: { backgroundColor: "#f44336", color: "#fff" },
  hoursRow: { alignItems: "center" },
  timeField: { width: 120 },
  warningBanner: {
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
    backgroundColor: "#fff3e0",
    borderLeft: `4px solid ${theme.palette.warning?.main ?? "#ff9800"}`,
    display: "flex",
    alignItems: "flex-start",
    gap: theme.spacing(1),
  },
  warningIcon: { color: theme.palette.warning?.main ?? "#ff9800", flexShrink: 0 },
  addRow: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  },
  typeChip: {
    fontSize: 10,
    height: 18,
    marginLeft: theme.spacing(0.5),
  },
}));

const CalendarSettings = () => {
  const classes = useStyles();

  // ── Connection status (platform users + standalone professionals merged) ──
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  // ── Working hours ──
  // selectedUser format: "type:id" — ex: "user:3" ou "professional:1"
  const [selectedUser, setSelectedUser] = useState("");
  const [workingHours, setWorkingHours] = useState(DEFAULT_HOURS);
  const [savingHours, setSavingHours] = useState(false);

  // ── Standalone professionals management ──
  const [professionals, setProfessionals] = useState([]);

  // Dialog: add new professional
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newProfName, setNewProfName] = useState("");
  const [savingProf, setSavingProf] = useState(false);

  // Dialog: edit professional name
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProf, setEditingProf] = useState(null); // { id, name }
  const [editProfName, setEditProfName] = useState("");

  // ── Data loading ──

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/google-calendar/status");
      setUsers(data);
    } catch (err) {
      toast.error("Erro ao carregar status do Google Calendar");
    }
    setLoading(false);
  };

  const loadProfessionals = async () => {
    try {
      const { data } = await api.get("/google-calendar/professionals");
      setProfessionals(data);
    } catch (err) {
      // Se o endpoint não existir ainda (ex: migrations pendentes) falha silenciosamente
      console.warn("[CalendarSettings] Erro ao carregar profissionais:", err?.response?.status);
    }
  };

  const loadWorkingHours = async (userId, type) => {
    try {
      const params = type === "professional" ? "?type=professional" : "";
      const { data } = await api.get(`/google-calendar/working-hours/${userId}${params}`);
      if (data.length > 0) {
        const merged = DEFAULT_HOURS.map((def) => {
          const saved = data.find((d) => d.dayOfWeek === def.dayOfWeek);
          return saved
            ? { dayOfWeek: def.dayOfWeek, startTime: saved.startTime, endTime: saved.endTime, isWorking: saved.isWorking }
            : def;
        });
        setWorkingHours(merged);
      } else {
        setWorkingHours(DEFAULT_HOURS);
      }
    } catch (err) {
      setWorkingHours(DEFAULT_HOURS);
    }
  };

  useEffect(() => {
    loadUsers();
    loadProfessionals();
  }, []);

  useEffect(() => {
    if (selectedUser) {
      const [type, id] = selectedUser.split(":");
      loadWorkingHours(id, type);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUser]);

  // ── OAuth connect / disconnect ──

  const handleConnect = async (userId, type) => {
    try {
      const param = type === "professional"
        ? `professionalId=${userId}`
        : `userId=${userId}`;
      const { data } = await api.get(`/google-calendar/auth-url?${param}`);
      const popup = window.open(data.url, "_blank", "width=500,height=600");
      toast.info("Complete a autorização na janela aberta.");
      const interval = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(interval);
          loadUsers();
        }
      }, 800);
    } catch (err) {
      toast.error("Erro ao gerar URL de autorização");
    }
  };

  const handleDisconnect = async (userId, type) => {
    if (!window.confirm("Desconectar Google Calendar deste profissional?")) return;
    try {
      const param = type === "professional" ? "?type=professional" : "";
      await api.delete(`/google-calendar/disconnect/${userId}${param}`);
      toast.success("Google Calendar desconectado");
      loadUsers();
    } catch (err) {
      toast.error("Erro ao desconectar");
    }
  };

  // ── OAuth postMessage listener ──

  useEffect(() => {
    const handleMessage = (event) => {
      const { type, connected, error, errorCode } = event.data || {};
      if (type !== "GOOGLE_CALENDAR_OAUTH") return;
      if (connected) {
        toast.success("Google Calendar conectado com sucesso!");
        loadUsers();
        return;
      }
      if (!error) return;
      if (errorCode === "MISSING_CALENDAR_SCOPE") {
        toast.error(
          "Faltou autorizar o Google Calendar. Ao conectar, MARQUE TODAS as " +
          "permissões na tela do Google (especialmente \"Ver, editar, criar " +
          "e excluir eventos\"). Tente conectar novamente.",
          { autoClose: 12000 }
        );
      } else if (errorCode === "USER_DENIED") {
        toast.warning("Você cancelou a autorização do Google Calendar.");
      } else {
        toast.error("Erro ao conectar Google Calendar. Tente novamente.");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Working hours ──

  const updateHourField = (dayOfWeek, field, value) => {
    setWorkingHours((prev) =>
      prev.map((h) => (h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h))
    );
  };

  const handleSaveHours = async () => {
    if (!selectedUser) { toast.warning("Selecione um profissional"); return; }
    setSavingHours(true);
    try {
      const [type, id] = selectedUser.split(":");
      const params = type === "professional" ? "?type=professional" : "";
      await api.put(`/google-calendar/working-hours/${id}${params}`, workingHours);
      toast.success("Horários salvos");
    } catch (err) {
      toast.error("Erro ao salvar horários");
    }
    setSavingHours(false);
  };

  // ── Professionals CRUD ──

  const handleAddProfessional = async () => {
    const name = newProfName.trim();
    if (!name) { toast.warning("Informe o nome do profissional"); return; }
    setSavingProf(true);
    try {
      await api.post("/google-calendar/professionals", { name });
      toast.success(`Profissional "${name}" adicionado`);
      setNewProfName("");
      setAddDialogOpen(false);
      await loadProfessionals();
      await loadUsers(); // atualiza a lista de conexão também
    } catch (err) {
      toast.error(err?.response?.data?.error || "Erro ao adicionar profissional");
    }
    setSavingProf(false);
  };

  // editingProf carrega { id, name, type } — "professional" ou "user"
  const handleOpenEdit = (entry) => {
    setEditingProf(entry);
    setEditProfName(entry.name);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    const name = editProfName.trim();
    if (!name) { toast.warning("Informe o nome"); return; }
    setSavingProf(true);
    try {
      // Endpoint unificado — type=user|professional, companyId vem do JWT no backend
      await api.put(`/google-calendar/rename/${editingProf.id}?type=${editingProf.type}`, { name });
      toast.success("Nome atualizado");
      setEditDialogOpen(false);
      await loadProfessionals();
      await loadUsers();
    } catch (err) {
      console.error("[CalendarSettings] handleSaveEdit falhou:", err?.response?.data || err?.message || err);
      toast.error(err?.response?.data?.error || "Erro ao atualizar nome");
    }
    setSavingProf(false);
  };

  const handleDeleteProfessional = async (prof) => {
    if (!window.confirm(`Remover "${prof.name}"? Esta ação também apaga os horários e desconecta o calendário.`)) return;
    try {
      await api.delete(`/google-calendar/professionals/${prof.id}`);
      toast.success(`Profissional "${prof.name}" removido`);
      await loadProfessionals();
      await loadUsers();
    } catch (err) {
      toast.error(err?.response?.data?.error || "Erro ao remover profissional");
    }
  };

  // ── Render ──

  if (loading) return <CircularProgress />;

  const desconectados = users.filter((u) => !u.connected);
  const algumDesconectado = users.length > 0 && desconectados.length > 0;

  // Opções para o Select de horário (todos os profissionais: users + standalone)
  const hoursSelectOptions = users;

  return (
    <>
      {/* Banner de alerta */}
      {algumDesconectado && (
        <Paper className={classes.warningBanner} elevation={1}>
          <WarningIcon className={classes.warningIcon} />
          <div>
            <Typography variant="subtitle1" style={{ fontWeight: 600 }}>
              Atenção: o agente de IA não consegue agendar para{" "}
              {desconectados.map((u) => u.name).join(", ")}
            </Typography>
            <Typography variant="body2" style={{ marginTop: 4 }}>
              Sem o Google Calendar conectado, o agente não vê disponibilidade nem cria eventos —
              clientes ouvem "tive um problema técnico" e o atendimento vai para humano.
              Clique em <strong>Conectar</strong> abaixo e, na tela do Google,{" "}
              <strong>marque TODAS as permissões</strong> (incluindo "Ver, editar, criar e excluir
              eventos do Google Agenda").
            </Typography>
          </div>
        </Paper>
      )}

      {/* ── Gerenciar Profissionais ── */}
      <Paper className={classes.paper} elevation={2}>
        {/* Título na primeira linha; botão alinhado à direita — sem texto longo concorrendo */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <Typography variant="h6">Profissionais sem conta CRM</Typography>
          <Button
            variant="contained"
            color="primary"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => { setNewProfName(""); setAddDialogOpen(true); }}
          >
            Adicionar
          </Button>
        </div>
        {/* Descrição em linha separada — evita o botão de ser empurrado para fora */}
        <Typography variant="body2" color="textSecondary" style={{ marginBottom: 8 }}>
          Cadastre colaboradores externos que não precisam de login na plataforma mas cujo
          calendário deve ser gerenciado pelo agente. Usuários com conta CRM aparecem
          automaticamente na tabela de conexão abaixo.
        </Typography>

        {professionals.length === 0 ? (
          <Typography variant="body2" color="textSecondary" style={{ marginTop: 8 }}>
            Nenhum profissional autônomo cadastrado ainda.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Nome</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {professionals.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => handleOpenEdit({ id: p.id, name: p.name, type: "professional" })} title="Renomear">
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleDeleteProfessional(p)} title="Remover">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      {/* ── Conexão Google Calendar ── */}
      <Paper className={classes.paper} elevation={2}>
        <Typography variant="h6" gutterBottom>Google Calendar — Conexão por Profissional</Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Cada profissional conecta seu próprio Google Calendar para que o agente possa verificar
          disponibilidade e criar eventos.
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Profissional</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Conta Google</TableCell>
              <TableCell align="right">Calendário</TableCell>
              <TableCell align="center">Renomear</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u) => (
              <TableRow key={`${u.type}-${u.userId}`}>
                <TableCell>
                  {u.name}
                  {u.type === "professional" && (
                    <Chip label="externo" size="small" className={classes.typeChip} />
                  )}
                </TableCell>
                <TableCell>
                  {u.connected ? (
                    <Chip icon={<CheckCircleIcon />} label="Conectado" size="small" className={classes.connectedChip} />
                  ) : (
                    <Chip icon={<ErrorIcon />} label="Desconectado" size="small" className={classes.disconnectedChip} />
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="textSecondary">
                    {u.googleAccountEmail ?? "—"}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {u.connected ? (
                    <Button
                      size="small"
                      startIcon={<LinkOffIcon />}
                      onClick={() => handleDisconnect(u.userId, u.type)}
                      color="secondary"
                    >
                      Desconectar
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      startIcon={<LinkIcon />}
                      variant="outlined"
                      color="primary"
                      onClick={() => handleConnect(u.userId, u.type)}
                    >
                      Conectar
                    </Button>
                  )}
                </TableCell>
                {/* Botão renomear disponível para todos: usuários CRM e externos */}
                <TableCell align="center">
                  <IconButton
                    size="small"
                    title="Renomear"
                    onClick={() => handleOpenEdit({ id: u.userId, name: u.name, type: u.type })}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography variant="body2" color="textSecondary">
                    Nenhum profissional encontrado. Adicione um acima ou cadastre usuários no sistema.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {/* ── Horário de Trabalho ── */}
      <Paper className={classes.paper} elevation={2}>
        <Typography variant="h6" gutterBottom>Horário de Trabalho por Profissional</Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Configure os dias e horários disponíveis para agendamento de cada profissional.
        </Typography>

        <Grid container spacing={2} style={{ marginBottom: 16 }}>
          <Grid item xs={12} sm={6}>
            {/*
              Usa chave composta "type:userId" para evitar colisão entre IDs de
              platform users e CalendarProfessionals (tabelas separadas, IDs independentes).
            */}
            <Select
              fullWidth
              value={selectedUser}
              variant="outlined"
              displayEmpty
              onChange={(e) => setSelectedUser(e.target.value)}
            >
              <MenuItem value="" disabled>Selecione um profissional</MenuItem>
              {hoursSelectOptions.map((u) => (
                <MenuItem key={`${u.type}-${u.userId}`} value={`${u.type}:${u.userId}`}>
                  {u.name}
                  {u.type === "professional" ? " (autônomo)" : ""}
                </MenuItem>
              ))}
            </Select>
          </Grid>
        </Grid>

        {selectedUser && (
          <>
            <Divider style={{ marginBottom: 16 }} />
            <Grid container spacing={1}>
              {workingHours.map((h) => {
                const dayLabel = DAYS.find((d) => d.day === h.dayOfWeek)?.label ?? "";
                return (
                  <Grid item xs={12} key={h.dayOfWeek}>
                    <Grid container spacing={2} alignItems="center" className={classes.hoursRow}>
                      <Grid item xs={12} sm={2}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={h.isWorking}
                              color="primary"
                              size="small"
                              onChange={(e) => updateHourField(h.dayOfWeek, "isWorking", e.target.checked)}
                            />
                          }
                          label={<Typography variant="body2">{dayLabel}</Typography>}
                        />
                      </Grid>
                      <Grid item xs={6} sm={2}>
                        <TextField
                          label="Início"
                          type="time"
                          size="small"
                          variant="outlined"
                          className={classes.timeField}
                          disabled={!h.isWorking}
                          value={h.startTime}
                          onChange={(e) => updateHourField(h.dayOfWeek, "startTime", e.target.value)}
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                      <Grid item xs={6} sm={2}>
                        <TextField
                          label="Fim"
                          type="time"
                          size="small"
                          variant="outlined"
                          className={classes.timeField}
                          disabled={!h.isWorking}
                          value={h.endTime}
                          onChange={(e) => updateHourField(h.dayOfWeek, "endTime", e.target.value)}
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                    </Grid>
                  </Grid>
                );
              })}
            </Grid>
            <Button
              variant="contained"
              color="primary"
              style={{ marginTop: 16 }}
              onClick={handleSaveHours}
              disabled={savingHours}
            >
              {savingHours ? <CircularProgress size={20} /> : "Salvar Horários"}
            </Button>
          </>
        )}
      </Paper>

      {/* ── Dialog: Adicionar Profissional ── */}
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Adicionar Profissional</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Nome do profissional"
            fullWidth
            variant="outlined"
            size="small"
            value={newProfName}
            onChange={(e) => setNewProfName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddProfessional(); }}
            placeholder="Ex: Ana Carla, Dr. João..."
            style={{ marginTop: 8 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialogOpen(false)} disabled={savingProf}>
            Cancelar
          </Button>
          <Button
            onClick={handleAddProfessional}
            color="primary"
            variant="contained"
            disabled={savingProf || !newProfName.trim()}
          >
            {savingProf ? <CircularProgress size={18} /> : "Adicionar"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Dialog: Renomear ── */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          Renomear {editingProf?.type === "user" ? "usuário" : "profissional"}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Novo nome"
            fullWidth
            variant="outlined"
            size="small"
            value={editProfName}
            onChange={(e) => setEditProfName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); }}
            style={{ marginTop: 8 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)} disabled={savingProf}>
            Cancelar
          </Button>
          <Button
            onClick={handleSaveEdit}
            color="primary"
            variant="contained"
            disabled={savingProf || !editProfName.trim()}
          >
            {savingProf ? <CircularProgress size={18} /> : "Salvar"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default CalendarSettings;
