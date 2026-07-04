/**
 * Página: Catálogo de Serviços (Fase 5 + UX Unification 2026-05-24)
 *
 * Fonte única de verdade para todos os serviços da empresa:
 *   - Nome, categoria, duração e preço de cada serviço
 *   - Profissionais vinculados (realizam este serviço no calendário)
 *   - Ativar/desativar sem excluir (preserva histórico)
 *   - Apenas admins podem criar/editar/remover
 *
 * O preço cadastrado aqui é automaticamente gravado em ServiceHistory.value
 * quando um atendimento é registrado com o serviceId correspondente.
 *
 * Decisão de unificação: o painel de Configurações → Agendamentos → Serviços
 * foi convertido para modo somente-leitura que referencia este catálogo.
 * Ref: decisions_log.md — 2026-05-24.
 */

import React, { useState, useEffect, useCallback, useContext } from "react";
import {
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  IconButton,
  Switch,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  CircularProgress,
  Tooltip,
  InputAdornment,
  Chip,
  Checkbox,
  Divider,
  Box,
} from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import { FiEdit2, FiTrash2, FiPlus, FiSearch, FiUser } from "react-icons/fi";
import { toast } from "react-toastify";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import { AuthContext } from "../../context/Auth/AuthContext";
import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import Title from "../../components/Title";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";

const useStyles = makeStyles((theme) => ({
  mainPaper: {
    flex: 1,
    padding: theme.spacing(2),
    overflowY: "scroll",
    ...theme.scrollbarStyles,
  },
  table: {
    minWidth: 500,
  },
  priceChip: {
    fontWeight: 600,
    backgroundColor: theme.palette.success.light,
    color: theme.palette.success.contrastText,
  },
  noPriceChip: {
    backgroundColor: theme.palette.grey[200],
  },
  categoryText: {
    color: theme.palette.text.secondary,
    fontSize: "0.85rem",
  },
  addButton: {
    marginLeft: theme.spacing(1),
  },
  searchField: {
    marginRight: theme.spacing(2),
  },
  loadingContainer: {
    display: "flex",
    justifyContent: "center",
    padding: theme.spacing(4),
  },
  emptyRow: {
    textAlign: "center",
    color: theme.palette.text.secondary,
    padding: theme.spacing(3),
  },
  dialogField: {
    marginBottom: theme.spacing(2),
  },
  professionalSection: {
    marginTop: theme.spacing(1),
  },
  professionalLabel: {
    fontWeight: 600,
    marginBottom: theme.spacing(0.5),
  },
  professionalChip: {
    margin: theme.spacing(0.25),
    backgroundColor: theme.palette.primary.light,
    color: "#fff",
    fontSize: "0.75rem",
  },
  professionalsCell: {
    maxWidth: 220,
  },
  sectionDivider: {
    margin: theme.spacing(2, 0, 1),
  },
}));

// ── Modal de Criação / Edição ────────────────────────────────────────────────

const EMPTY_FORM = {
  name: "",
  category: "",
  durationMinutes: "",
  price: "",
  description: "",
  professionalIds: [],
};

/**
 * Modal de criação/edição de serviço.
 * Inclui checkboxes para vincular profissionais ao serviço.
 *
 * @param {object}   service   - Serviço em edição (null = criação)
 * @param {Array}    users     - Lista de usuários da empresa para checkboxes
 * @param {Function} onSaved   - Callback após salvar com sucesso
 */
function ServiceModal({ open, onClose, service, users, onSaved }) {
  const classes = useStyles();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Preenche form ao abrir em modo edição
  useEffect(() => {
    if (service) {
      setForm({
        name: service.name ?? "",
        category: service.category ?? "",
        durationMinutes: service.durationMinutes ?? "",
        price: service.price != null ? String(service.price) : "",
        description: service.description ?? "",
        // Extrai IDs dos profissionais já vinculados
        professionalIds: (service.serviceProfessionals ?? []).map((sp) => sp.userId),
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [service, open]);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const toggleProfessional = (userId) => {
    setForm((prev) => ({
      ...prev,
      professionalIds: prev.professionalIds.includes(userId)
        ? prev.professionalIds.filter((id) => id !== userId)
        : [...prev.professionalIds, userId],
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Nome do serviço é obrigatório.");
      return;
    }

    setSaving(true);
    try {
      // Normaliza preço: substitui vírgula por ponto antes de enviar
      const priceRaw = form.price.trim().replace(",", ".");
      const price = priceRaw === "" ? null : parseFloat(priceRaw);

      const payload = {
        name: form.name.trim(),
        category: form.category.trim() || null,
        durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
        price: isNaN(price) ? null : price,
        description: form.description.trim() || null,
        professionalIds: form.professionalIds,
      };

      if (service) {
        await api.put(`/service-catalog/${service.id}`, payload);
        toast.success("Serviço atualizado.");
      } else {
        await api.post("/service-catalog", payload);
        toast.success("Serviço criado.");
      }

      onSaved();
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {service ? "Editar Serviço" : "Novo Serviço"}
      </DialogTitle>
      <DialogContent>
        {/* ── Campos principais ── */}
        <TextField
          className={classes.dialogField}
          label="Nome do serviço *"
          fullWidth
          variant="outlined"
          value={form.name}
          onChange={handleChange("name")}
          placeholder="Ex: Depilação a Laser (pernas)"
        />
        <TextField
          className={classes.dialogField}
          label="Categoria"
          fullWidth
          variant="outlined"
          value={form.category}
          onChange={handleChange("category")}
          placeholder="Ex: Depilação, Coloração, Corte"
          helperText="Usada para agrupar serviços nos relatórios financeiros"
        />
        <TextField
          className={classes.dialogField}
          label="Preço (R$)"
          fullWidth
          variant="outlined"
          value={form.price}
          onChange={handleChange("price")}
          placeholder="40.00"
          type="number"
          inputProps={{ min: 0, step: "0.01" }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">R$</InputAdornment>
            ),
          }}
          helperText="Deixe em branco para 'a combinar'"
        />
        <TextField
          className={classes.dialogField}
          label="Duração (minutos)"
          fullWidth
          variant="outlined"
          value={form.durationMinutes}
          onChange={handleChange("durationMinutes")}
          placeholder="60"
          type="number"
          inputProps={{ min: 1 }}
        />
        <TextField
          className={classes.dialogField}
          label="Descrição"
          fullWidth
          multiline
          rows={3}
          variant="outlined"
          value={form.description}
          onChange={handleChange("description")}
          placeholder="Detalhes adicionais sobre o serviço..."
        />

        {/* ── Profissionais ── */}
        <Divider className={classes.sectionDivider} />
        <Box className={classes.professionalSection}>
          <Typography variant="subtitle2" className={classes.professionalLabel}>
            <FiUser size={14} style={{ marginRight: 4, verticalAlign: "middle" }} />
            Profissionais que realizam este serviço
          </Typography>
          <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
            Estes profissionais ficam disponíveis para agendamento deste serviço no calendário.
          </Typography>
          {users.length === 0 ? (
            <Typography variant="caption" color="textSecondary">
              Nenhum usuário cadastrado na empresa.
            </Typography>
          ) : (
            users.map((u) => (
              <FormControlLabel
                key={u.id}
                control={
                  <Checkbox
                    checked={form.professionalIds.includes(u.id)}
                    onChange={() => toggleProfessional(u.id)}
                    color="primary"
                    size="small"
                  />
                }
                label={u.name}
              />
            ))
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="default" disabled={saving}>
          Cancelar
        </Button>
        <Button
          onClick={handleSave}
          color="primary"
          variant="contained"
          disabled={saving}
        >
          {saving ? <CircularProgress size={20} /> : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Página Principal ─────────────────────────────────────────────────────────

const Services = () => {
  const classes = useStyles();
  const { user } = useContext(AuthContext);
  const isAdmin = user.profile === "admin";

  const [services, setServices] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchParam, setSearchParam] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState(null);

  // Busca lista de usuários da empresa uma única vez (para checkboxes de profissionais)
  useEffect(() => {
    api
      .get("/users")
      .then(({ data }) => setUsers(data?.users ?? data ?? []))
      .catch(() => {
        // Não-fatal: modal funciona sem profissionais (checkboxes ficam vazios)
      });
  }, []);

  // Busca serviços do backend
  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/service-catalog", {
        params: { searchParam, includeInactive: includeInactive ? "true" : undefined },
      });
      setServices(data);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, [searchParam, includeInactive]);

  useEffect(() => {
    const delay = setTimeout(fetchServices, 400);
    return () => clearTimeout(delay);
  }, [fetchServices]);

  const handleOpenCreate = () => {
    setEditingService(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (service) => {
    setEditingService(service);
    setModalOpen(true);
  };

  const handleToggleActive = async (service) => {
    try {
      await api.put(`/service-catalog/${service.id}`, {
        isActive: !service.isActive,
      });
      toast.success(
        service.isActive ? "Serviço desativado." : "Serviço reativado."
      );
      fetchServices();
    } catch (err) {
      toastError(err);
    }
  };

  const handleRemove = async (service) => {
    if (
      !window.confirm(
        `Remover "${service.name}" permanentemente? O histórico de atendimentos é preservado.`
      )
    )
      return;

    try {
      await api.delete(`/service-catalog/${service.id}`);
      toast.success("Serviço removido.");
      fetchServices();
    } catch (err) {
      toastError(err);
    }
  };

  const formatDuration = (minutes) => {
    if (!minutes) return "—";
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h${m}min` : `${h}h`;
  };

  const formatPrice = (price) => {
    if (price == null) return null;
    return Number(price).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  };

  return (
    <MainContainer>
      <ServiceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        service={editingService}
        users={users}
        onSaved={fetchServices}
      />

      <MainHeader>
        <Title>Catálogo de Serviços</Title>
        <MainHeaderButtonsWrapper>
          <TextField
            className={classes.searchField}
            placeholder="Buscar serviço..."
            value={searchParam}
            onChange={(e) => setSearchParam(e.target.value)}
            size="small"
            variant="outlined"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <FiSearch size={16} />
                </InputAdornment>
              ),
            }}
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                color="primary"
              />
            }
            label="Mostrar inativos"
          />
          {isAdmin && (
            <Button
              className={classes.addButton}
              variant="contained"
              color="primary"
              onClick={handleOpenCreate}
              startIcon={<FiPlus size={16} />}
            >
              Novo Serviço
            </Button>
          )}
        </MainHeaderButtonsWrapper>
      </MainHeader>

      <Paper className={classes.mainPaper} variant="outlined">
        {loading ? (
          <div className={classes.loadingContainer}>
            <CircularProgress />
          </div>
        ) : (
          <Table className={classes.table} size="small">
            <TableHead>
              <TableRow>
                <TableCell>Nome</TableCell>
                <TableCell>Categoria</TableCell>
                <TableCell align="center">Duração</TableCell>
                <TableCell align="center">Preço</TableCell>
                <TableCell>Profissionais</TableCell>
                <TableCell align="center">Ativo</TableCell>
                {isAdmin && (
                  <TableCell align="center">Ações</TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {services.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 7 : 6}>
                    <Typography className={classes.emptyRow}>
                      {searchParam
                        ? `Nenhum serviço encontrado para "${searchParam}".`
                        : 'Nenhum serviço cadastrado. Clique em "Novo Serviço" para começar.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                services.map((service) => (
                  <TableRow key={service.id} hover>
                    <TableCell>
                      <Typography variant="body2" style={{ fontWeight: 500 }}>
                        {service.name}
                      </Typography>
                      {service.description && (
                        <Typography
                          variant="caption"
                          className={classes.categoryText}
                          display="block"
                        >
                          {service.description.length > 60
                            ? service.description.slice(0, 60) + "…"
                            : service.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {service.category ? (
                        <Typography className={classes.categoryText}>
                          {service.category}
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="textSecondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {formatDuration(service.durationMinutes)}
                    </TableCell>
                    <TableCell align="center">
                      {service.price != null ? (
                        <Chip
                          label={formatPrice(service.price)}
                          size="small"
                          className={classes.priceChip}
                        />
                      ) : (
                        <Chip
                          label="A combinar"
                          size="small"
                          className={classes.noPriceChip}
                        />
                      )}
                    </TableCell>
                    <TableCell className={classes.professionalsCell}>
                      {(service.serviceProfessionals ?? []).length > 0 ? (
                        (service.serviceProfessionals ?? []).map((sp) => (
                          <Chip
                            key={sp.userId}
                            label={sp.user?.name ?? `#${sp.userId}`}
                            size="small"
                            className={classes.professionalChip}
                          />
                        ))
                      ) : (
                        <Typography variant="caption" color="textSecondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {isAdmin ? (
                        <Tooltip
                          title={
                            service.isActive ? "Clique para desativar" : "Clique para reativar"
                          }
                        >
                          <Switch
                            size="small"
                            checked={service.isActive}
                            onChange={() => handleToggleActive(service)}
                            color="primary"
                          />
                        </Tooltip>
                      ) : (
                        <Chip
                          label={service.isActive ? "Ativo" : "Inativo"}
                          size="small"
                          color={service.isActive ? "primary" : "default"}
                        />
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell align="center">
                        <Tooltip title="Editar">
                          <IconButton
                            size="small"
                            onClick={() => handleOpenEdit(service)}
                          >
                            <FiEdit2 size={16} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remover">
                          <IconButton
                            size="small"
                            onClick={() => handleRemove(service)}
                            style={{ color: "#e57373", marginLeft: 4 }}
                          >
                            <FiTrash2 size={16} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Paper>
    </MainContainer>
  );
};

export default Services;
