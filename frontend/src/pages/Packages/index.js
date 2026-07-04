/**
 * Página: Pacotes de Serviços (Fase 6)
 *
 * CRUD admin para templates de pacotes + fluxo de venda para clientes:
 *   - Nome, serviço vinculado, número de sessões e preço do pacote
 *   - Exibe desconto percentual vs preço avulso (se serviço tiver preço)
 *   - Ativar/inativar sem excluir (preserva histórico de vendas)
 *   - Botão "Vender" → registra compra para um cliente (por ID ou número de contato)
 *   - Apenas admins podem criar/editar/inativar e vender
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
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import { FiEdit2, FiPlus, FiSearch, FiShoppingCart } from "react-icons/fi";
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
    minWidth: 600,
  },
  priceChip: {
    fontWeight: 600,
    backgroundColor: theme.palette.primary.light,
    color: theme.palette.primary.contrastText,
  },
  discountChip: {
    fontWeight: 600,
    backgroundColor: theme.palette.success.light,
    color: theme.palette.success.contrastText,
    marginLeft: theme.spacing(0.5),
  },
  sessionsBadge: {
    fontWeight: 700,
    fontSize: "1rem",
    color: theme.palette.primary.main,
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
  sellButton: {
    color: theme.palette.success.main,
    marginLeft: theme.spacing(0.5),
  },
}));

// ── Modal de Criação / Edição de Template ────────────────────────────────────

const EMPTY_FORM = {
  name: "",
  serviceId: "",
  totalSessions: "",
  totalPrice: "",
  description: "",
};

function PackageModal({ open, onClose, pkg, services, onSaved }) {
  const classes = useStyles();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (pkg) {
      setForm({
        name: pkg.name ?? "",
        serviceId: pkg.serviceId ? String(pkg.serviceId) : "",
        totalSessions: pkg.totalSessions ?? "",
        totalPrice: pkg.totalPrice != null ? String(pkg.totalPrice) : "",
        description: pkg.description ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [pkg, open]);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Nome do pacote é obrigatório.");
      return;
    }
    // Serviço vinculado obrigatório: o agente usa o serviço do pacote para
    // entender qual procedimento oferecer ao cliente no WhatsApp.
    if (!form.serviceId) {
      toast.error("Serviço vinculado é obrigatório.");
      return;
    }
    const sessions = Number(form.totalSessions);
    const price = parseFloat(String(form.totalPrice).replace(",", "."));

    if (!sessions || sessions < 1) {
      toast.error("Número de sessões deve ser maior que zero.");
      return;
    }
    if (isNaN(price) || price < 0) {
      toast.error("Preço inválido.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        serviceId: Number(form.serviceId),
        totalSessions: sessions,
        totalPrice: price,
        description: form.description.trim() || null,
      };

      if (pkg) {
        await api.put(`/packages/${pkg.id}`, payload);
        toast.success("Pacote atualizado.");
      } else {
        await api.post("/packages", payload);
        toast.success("Pacote criado.");
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
      <DialogTitle>{pkg ? "Editar Pacote" : "Novo Pacote"}</DialogTitle>
      <DialogContent>
        <TextField
          className={classes.dialogField}
          label="Nome do pacote *"
          fullWidth
          variant="outlined"
          value={form.name}
          onChange={handleChange("name")}
          placeholder="Ex: Pacote 10 Sessões Laser"
        />

        <FormControl
          className={classes.dialogField}
          variant="outlined"
          fullWidth
          required
        >
          <InputLabel>Serviço vinculado *</InputLabel>
          <Select
            value={form.serviceId}
            onChange={handleChange("serviceId")}
            label="Serviço vinculado *"
          >
            <MenuItem value="">
              <em>Selecione um serviço...</em>
            </MenuItem>
            {services.map((s) => (
              <MenuItem key={s.id} value={String(s.id)}>
                {s.name}
                {s.price != null && ` (R$ ${Number(s.price).toFixed(2)} avulso)`}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          className={classes.dialogField}
          label="Número de sessões *"
          fullWidth
          variant="outlined"
          value={form.totalSessions}
          onChange={handleChange("totalSessions")}
          type="number"
          inputProps={{ min: 1 }}
          placeholder="10"
        />

        <TextField
          className={classes.dialogField}
          label="Preço do pacote (R$) *"
          fullWidth
          variant="outlined"
          value={form.totalPrice}
          onChange={handleChange("totalPrice")}
          type="number"
          inputProps={{ min: 0, step: "0.01" }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">R$</InputAdornment>
            ),
          }}
          placeholder="300.00"
        />

        <TextField
          label="Descrição"
          fullWidth
          multiline
          rows={3}
          variant="outlined"
          value={form.description}
          onChange={handleChange("description")}
          placeholder="Informações adicionais exibidas nas mensagens WhatsApp..."
        />
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

// ── Modal de Venda ────────────────────────────────────────────────────────────

function SellModal({ open, onClose, pkg }) {
  const classes = useStyles();
  const [contactId, setContactId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setContactId("");
      setExpiresAt("");
    }
  }, [open]);

  const handleSell = async () => {
    const cid = Number(contactId);
    if (!cid || cid < 1) {
      toast.error("Informe um ID de contato válido.");
      return;
    }

    setSaving(true);
    try {
      await api.post(`/packages/${pkg.id}/purchase/${cid}`, {
        expiresAt: expiresAt || null,
      });
      toast.success(
        `Pacote "${pkg.name}" vendido com sucesso! Mensagem WhatsApp enviada ao cliente.`
      );
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Vender Pacote</DialogTitle>
      <DialogContent>
        {pkg && (
          <Typography variant="body2" color="textSecondary" gutterBottom>
            {pkg.name} — {pkg.totalSessions} sessões por R${" "}
            {Number(pkg.totalPrice).toFixed(2)}
          </Typography>
        )}

        <TextField
          className={classes.dialogField}
          label="ID do Contato (cliente) *"
          fullWidth
          variant="outlined"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          type="number"
          inputProps={{ min: 1 }}
          helperText="ID numérico do cliente na aba Contatos"
          style={{ marginTop: 16 }}
        />

        <TextField
          label="Data de validade (opcional)"
          fullWidth
          variant="outlined"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          type="date"
          InputLabelProps={{ shrink: true }}
          helperText="Deixe em branco para pacote sem data de expiração"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="default" disabled={saving}>
          Cancelar
        </Button>
        <Button
          onClick={handleSell}
          color="primary"
          variant="contained"
          disabled={saving}
        >
          {saving ? <CircularProgress size={20} /> : "Confirmar Venda"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Página Principal ──────────────────────────────────────────────────────────

const Packages = () => {
  const classes = useStyles();
  const { user } = useContext(AuthContext);
  const isAdmin = user.profile === "admin";

  const [packages, setPackages] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchParam, setSearchParam] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState(null);
  const [sellingPkg, setSellingPkg] = useState(null);

  // Busca serviços para o dropdown do modal (campo obrigatório)
  useEffect(() => {
    api
      .get("/service-catalog")
      .then(({ data }) => setServices(data))
      .catch((err) => {
        console.warn("Não foi possível carregar serviços para o dropdown:", err?.response?.status);
      });
  }, []);

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/packages", {
        params: {
          searchParam,
          includeInactive: includeInactive ? "true" : undefined,
        },
      });
      setPackages(data);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, [searchParam, includeInactive]);

  useEffect(() => {
    const delay = setTimeout(fetchPackages, 400);
    return () => clearTimeout(delay);
  }, [fetchPackages]);

  const handleOpenCreate = () => {
    setEditingPkg(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (pkg) => {
    setEditingPkg(pkg);
    setModalOpen(true);
  };

  const handleOpenSell = (pkg) => {
    setSellingPkg(pkg);
    setSellModalOpen(true);
  };

  const handleToggleActive = async (pkg) => {
    try {
      await api.put(`/packages/${pkg.id}`, { isActive: !pkg.isActive });
      toast.success(pkg.isActive ? "Pacote inativado." : "Pacote reativado.");
      fetchPackages();
    } catch (err) {
      toastError(err);
    }
  };

  /** Calcula desconto % se o serviço tiver preço avulso cadastrado */
  const getDiscount = (pkg) => {
    if (!pkg.service || pkg.service.price == null) return null;
    const regular = Number(pkg.service.price) * pkg.totalSessions;
    const pkgPrice = Number(pkg.totalPrice);
    if (pkgPrice >= regular) return null;
    return Math.round(((regular - pkgPrice) / regular) * 100);
  };

  const formatPrice = (val) =>
    Number(val).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

  return (
    <MainContainer>
      <PackageModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        pkg={editingPkg}
        services={services}
        onSaved={fetchPackages}
      />
      <SellModal
        open={sellModalOpen}
        onClose={() => setSellModalOpen(false)}
        pkg={sellingPkg}
      />

      <MainHeader>
        <Title>Pacotes de Serviços</Title>
        <MainHeaderButtonsWrapper>
          <TextField
            className={classes.searchField}
            placeholder="Buscar pacote..."
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
              Novo Pacote
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
                <TableCell>Serviço</TableCell>
                <TableCell align="center">Sessões</TableCell>
                <TableCell align="center">Preço</TableCell>
                <TableCell align="center">Ativo</TableCell>
                {isAdmin && <TableCell align="center">Ações</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {packages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 6 : 5}>
                    <Typography className={classes.emptyRow}>
                      {searchParam
                        ? `Nenhum pacote encontrado para "${searchParam}".`
                        : 'Nenhum pacote cadastrado. Clique em "Novo Pacote" para começar.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                packages.map((pkg) => {
                  const discount = getDiscount(pkg);
                  return (
                    <TableRow key={pkg.id} hover>
                      <TableCell>
                        <Typography
                          variant="body2"
                          style={{ fontWeight: 500 }}
                        >
                          {pkg.name}
                        </Typography>
                        {pkg.description && (
                          <Typography
                            variant="caption"
                            color="textSecondary"
                            display="block"
                          >
                            {pkg.description.length > 70
                              ? pkg.description.slice(0, 70) + "…"
                              : pkg.description}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {pkg.service ? (
                          <Typography variant="body2">
                            {pkg.service.name}
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="textSecondary">
                            —
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        <Typography className={classes.sessionsBadge}>
                          {pkg.totalSessions}×
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={formatPrice(pkg.totalPrice)}
                          size="small"
                          className={classes.priceChip}
                        />
                        {discount && (
                          <Chip
                            label={`-${discount}%`}
                            size="small"
                            className={classes.discountChip}
                          />
                        )}
                      </TableCell>
                      <TableCell align="center">
                        {isAdmin ? (
                          <Tooltip
                            title={
                              pkg.isActive
                                ? "Clique para inativar"
                                : "Clique para reativar"
                            }
                          >
                            <Switch
                              size="small"
                              checked={pkg.isActive}
                              onChange={() => handleToggleActive(pkg)}
                              color="primary"
                            />
                          </Tooltip>
                        ) : (
                          <Chip
                            label={pkg.isActive ? "Ativo" : "Inativo"}
                            size="small"
                            color={pkg.isActive ? "primary" : "default"}
                          />
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell align="center">
                          <Tooltip title="Vender para cliente">
                            <IconButton
                              size="small"
                              className={classes.sellButton}
                              onClick={() => handleOpenSell(pkg)}
                              disabled={!pkg.isActive}
                            >
                              <FiShoppingCart size={16} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Editar">
                            <IconButton
                              size="small"
                              onClick={() => handleOpenEdit(pkg)}
                              style={{ marginLeft: 4 }}
                            >
                              <FiEdit2 size={16} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </Paper>
    </MainContainer>
  );
};

export default Packages;
