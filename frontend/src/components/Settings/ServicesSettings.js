/**
 * ServicesSettings — Painel de serviços nas configurações de Agendamentos.
 *
 * MODO SOMENTE-LEITURA — UX Unification 2026-05-24.
 *
 * O CRUD de serviços foi unificado na página "Serviços" (menu lateral),
 * que é a única fonte de verdade. Este painel exibe o catálogo atual
 * (com profissionais vinculados) e direciona o usuário ao local correto
 * para criar/editar serviços — eliminando a duplicação de pontos de cadastro.
 *
 * Decisão: decisions_log.md — 2026-05-24.
 */

import React, { useEffect, useState } from "react";
import Paper from "@material-ui/core/Paper";
import Typography from "@material-ui/core/Typography";
import CircularProgress from "@material-ui/core/CircularProgress";
import Table from "@material-ui/core/Table";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import TableCell from "@material-ui/core/TableCell";
import TableBody from "@material-ui/core/TableBody";
import Chip from "@material-ui/core/Chip";
import Button from "@material-ui/core/Button";
import Box from "@material-ui/core/Box";
import { makeStyles } from "@material-ui/core/styles";
import InfoOutlinedIcon from "@material-ui/icons/InfoOutlined";
import OpenInNewIcon from "@material-ui/icons/OpenInNew";
import { useHistory } from "react-router-dom";
import { toast } from "react-toastify";
import api from "../../services/api";

const useStyles = makeStyles((theme) => ({
  paper: { padding: theme.spacing(2), marginBottom: theme.spacing(2) },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: theme.spacing(2),
    flexWrap: "wrap",
    gap: theme.spacing(1),
  },
  infoBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: theme.spacing(1),
    background: theme.palette.info.light + "22",
    border: `1px solid ${theme.palette.info.light}`,
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(1.5),
    marginBottom: theme.spacing(2),
  },
  infoIcon: {
    color: theme.palette.info.main,
    marginTop: 2,
    flexShrink: 0,
  },
  tableRow: { "&:hover": { backgroundColor: theme.palette.action.hover } },
  professionalChip: {
    margin: "2px",
    backgroundColor: theme.palette.primary.light,
    color: "#fff",
    fontSize: "0.72rem",
    height: 22,
  },
  priceChip: {
    fontWeight: 600,
    backgroundColor: theme.palette.success.light,
    color: theme.palette.success.contrastText,
    fontSize: "0.72rem",
    height: 22,
  },
  noPriceChip: {
    backgroundColor: theme.palette.grey[200],
    fontSize: "0.72rem",
    height: 22,
  },
  activeChip: {
    fontSize: "0.72rem",
    height: 22,
  },
  manageButton: {
    whiteSpace: "nowrap",
  },
  emptyCell: {
    textAlign: "center",
    padding: theme.spacing(3),
  },
}));

const ServicesSettings = () => {
  const classes = useStyles();
  const history = useHistory();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);

  // Carrega todos os serviços (incluindo inativos) do catálogo para exibição
  const loadData = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/service-catalog", {
        params: { includeInactive: "true" },
      });
      setServices(data);
    } catch {
      toast.error("Erro ao carregar serviços do catálogo");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const formatDuration = (minutes) => {
    if (!minutes) return "—";
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h${m}` : `${h}h`;
  };

  const formatPrice = (price) => {
    if (price == null) return null;
    return Number(price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  if (loading) return <CircularProgress size={28} />;

  return (
    <Paper className={classes.paper} elevation={2}>
      <div className={classes.header}>
        <div>
          <Typography variant="h6">Serviços para Agendamento</Typography>
          <Typography variant="body2" color="textSecondary">
            Serviços atualmente disponíveis para agendamento via calendário.
          </Typography>
        </div>
        <Button
          variant="outlined"
          color="primary"
          size="small"
          className={classes.manageButton}
          endIcon={<OpenInNewIcon fontSize="small" />}
          onClick={() => history.push("/services")}
        >
          Gerenciar Serviços
        </Button>
      </div>

      {/* Aviso informativo — orienta o usuário ao ponto correto de cadastro */}
      <Box className={classes.infoBox}>
        <InfoOutlinedIcon className={classes.infoIcon} fontSize="small" />
        <Typography variant="body2" color="textSecondary">
          Para criar, editar ou remover serviços, acesse{" "}
          <strong
            style={{ cursor: "pointer", textDecoration: "underline" }}
            onClick={() => history.push("/services")}
          >
            Serviços
          </strong>{" "}
          no menu lateral. Lá você também define o preço, categoria e os
          profissionais que realizam cada serviço.
        </Typography>
      </Box>

      {/* Tabela somente-leitura do catálogo atual */}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Nome</TableCell>
            <TableCell>Duração</TableCell>
            <TableCell align="center">Preço</TableCell>
            <TableCell>Profissionais</TableCell>
            <TableCell align="center">Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {services.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className={classes.emptyCell}>
                <Typography variant="body2" color="textSecondary">
                  Nenhum serviço cadastrado.{" "}
                  <strong
                    style={{ cursor: "pointer", textDecoration: "underline" }}
                    onClick={() => history.push("/services")}
                  >
                    Clique aqui para adicionar.
                  </strong>
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            services.map((s) => (
              <TableRow key={s.id} className={classes.tableRow}>
                <TableCell>
                  <Typography variant="body2" style={{ fontWeight: 500 }}>
                    {s.name}
                  </Typography>
                  {s.category && (
                    <Typography variant="caption" color="textSecondary" display="block">
                      {s.category}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>{formatDuration(s.durationMinutes)}</TableCell>
                <TableCell align="center">
                  {s.price != null ? (
                    <Chip
                      label={formatPrice(s.price)}
                      size="small"
                      className={classes.priceChip}
                    />
                  ) : (
                    <Chip label="A combinar" size="small" className={classes.noPriceChip} />
                  )}
                </TableCell>
                <TableCell>
                  {(s.serviceProfessionals ?? []).length > 0 ? (
                    (s.serviceProfessionals ?? []).map((sp) => (
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
                  <Chip
                    label={s.isActive ? "Ativo" : "Inativo"}
                    size="small"
                    color={s.isActive ? "primary" : "default"}
                    className={classes.activeChip}
                  />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Paper>
  );
};

export default ServicesSettings;
