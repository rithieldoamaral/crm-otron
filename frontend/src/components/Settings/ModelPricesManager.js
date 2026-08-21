import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  makeStyles
} from "@material-ui/core";
import EditIcon from "@material-ui/icons/Edit";
import AddIcon from "@material-ui/icons/Add";
import WarningIcon from "@material-ui/icons/WarningRounded";
import { toast } from "react-toastify";

import api from "../../services/api";

/**
 * Cadastro de preços dos modelos LLM — SOMENTE superadmin.
 *
 * POR QUE O PREÇO É MANUAL: nenhum provedor expõe preço por API. O endpoint
 * `/agent/models` — e por trás dele as APIs de Anthropic, OpenAI, DeepSeek e
 * afins — devolve apenas `{ id, label }`. A tabela de preços vive em página
 * web, não em API. Prometer "puxa o custo automaticamente" seria promessa
 * falsa; o que dá para automatizar é a DETECÇÃO de modelo sem preço.
 *
 * Como o cadastro sabe o que falta: o relatório `by-model` marca
 * `pricingMissing` para todo modelo que gerou consumo sem preço cadastrado.
 * Esses são os que importam — gasto real que não está sendo medido.
 *
 * Alterar um preço aqui NÃO reescreve consumo já registrado: cada linha de
 * `TokenUsages` congelou o preço vigente no momento do uso.
 */

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (GPT)" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "minimax", label: "MiniMax" },
  { value: "qwen", label: "Qwen (Alibaba)" }
];

const useStyles = makeStyles((theme) => ({
  bloco: { padding: theme.spacing(3), marginBottom: theme.spacing(2) },
  titulo: {
    fontSize: "0.95rem",
    fontWeight: 700,
    margin: 0,
    color: theme.palette.primary.main
  },
  descricao: {
    fontSize: "0.8rem",
    color: theme.palette.text.secondary,
    margin: "2px 0 16px"
  },
  alerta: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: theme.spacing(1.5, 2),
    marginBottom: theme.spacing(2),
    borderRadius: 6,
    borderLeft: "3px solid " + theme.palette.error.main,
    backgroundColor:
      theme.palette.type === "light" ? "#FDECEA" : "rgba(255,255,255,0.06)"
  },
  alertaIcone: { color: theme.palette.error.main, flexShrink: 0, fontSize: 20 },
  vazio: {
    padding: theme.spacing(4, 2),
    textAlign: "center",
    color: theme.palette.text.secondary
  },
  numero: { textAlign: "right", whiteSpace: "nowrap" },
  fonte: {
    fontSize: "0.7rem",
    color: theme.palette.text.secondary,
    maxWidth: 220,
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  }
}));

const FORM_VAZIO = {
  provider: "anthropic",
  model: "",
  inputPricePerMillion: "",
  outputPricePerMillion: "",
  cachedInputPricePerMillion: "",
  source: ""
};

/** Formata USD por milhão de tokens, com casas extras para modelos baratos. */
const usd = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "—";
  return "$" + n.toFixed(n < 1 ? 3 : 2);
};

const ModelPricesManager = () => {
  const classes = useStyles();

  const [precos, setPrecos] = useState([]);
  const [semPreco, setSemPreco] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [dialogo, setDialogo] = useState({ open: false, editando: false });
  const [form, setForm] = useState(FORM_VAZIO);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      // Período proposital de ponta a ponta: aqui o objetivo não é medir
      // consumo, e sim encontrar TODO modelo que já rodou sem preço —
      // inclusive o usado uma única vez, meses atrás.
      const params = { startDate: "2020-01-01", endDate: "2999-12-31" };
      const [respPrecos, respModelos] = await Promise.all([
        api.get("/token-governance/prices"),
        api.get("/token-governance/by-model", { params })
      ]);

      setPrecos(respPrecos.data.prices || []);
      setSemPreco((respModelos.data.models || []).filter((m) => m.pricingMissing));
    } catch (err) {
      const detalhe = err?.response?.data?.error || err?.message;
      toast.error("Não foi possível carregar os preços: " + detalhe);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const abrirNovo = (provider, model) => {
    setForm({
      ...FORM_VAZIO,
      provider: provider || "anthropic",
      model: model || ""
    });
    setDialogo({ open: true, editando: false });
  };

  const abrirEdicao = (preco) => {
    setForm({
      provider: preco.provider,
      model: preco.model,
      inputPricePerMillion: String(preco.inputPricePerMillion ?? ""),
      outputPricePerMillion: String(preco.outputPricePerMillion ?? ""),
      cachedInputPricePerMillion: String(preco.cachedInputPricePerMillion ?? ""),
      source: preco.source || ""
    });
    setDialogo({ open: true, editando: true });
  };

  const alterar = (campo) => (e) =>
    setForm((f) => ({ ...f, [campo]: e.target.value }));

  const salvar = async () => {
    if (!form.provider || !form.model.trim()) {
      toast.warning("Provedor e modelo são obrigatórios.");
      return;
    }

    setSalvando(true);
    try {
      await api.put("/token-governance/prices", {
        provider: form.provider,
        model: form.model.trim(),
        inputPricePerMillion: Number(form.inputPricePerMillion) || 0,
        outputPricePerMillion: Number(form.outputPricePerMillion) || 0,
        cachedInputPricePerMillion: Number(form.cachedInputPricePerMillion) || 0,
        source: form.source.trim() || undefined
      });

      toast.success("Preço salvo. O consumo já registrado não muda.");
      setDialogo({ open: false, editando: false });
      await carregar();
    } catch (err) {
      const detalhe = err?.response?.data?.error || err?.message;
      toast.error("Não foi possível salvar: " + detalhe);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      {semPreco.length > 0 && (
        <Paper className={classes.alerta} elevation={0}>
          <WarningIcon className={classes.alertaIcone} />
          <div style={{ width: "100%" }}>
            <Typography variant="body2">
              <strong>
                {semPreco.length}{" "}
                {semPreco.length === 1
                  ? "modelo em uso"
                  : "modelos em uso"}{" "}
                sem preço cadastrado.
              </strong>{" "}
              O consumo deles aparece como custo zero no painel — o gasto é
              real, só não está sendo medido.
            </Typography>
            <Table size="small" style={{ marginTop: 8 }}>
              <TableBody>
                {semPreco.map((m) => (
                  <TableRow key={m.provider + "-" + m.model}>
                    <TableCell>{m.provider}</TableCell>
                    <TableCell>{m.model}</TableCell>
                    <TableCell className={classes.numero}>
                      {Number(m.totalCalls).toLocaleString("pt-BR")} chamadas
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        color="primary"
                        variant="outlined"
                        onClick={() => abrirNovo(m.provider, m.model)}
                      >
                        Cadastrar preço
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Paper>
      )}

      <Paper className={classes.bloco} elevation={1}>
        <Grid container justifyContent="space-between" alignItems="flex-start">
          <Grid item xs={12} sm={8}>
            <h3 className={classes.titulo}>Preços por modelo</h3>
            <p className={classes.descricao}>
              Valores em dólar por 1 milhão de tokens. Nenhum provedor publica
              preço por API — a tabela deles fica em página web —, por isso o
              cadastro é manual. Alterar um preço aqui não reescreve o consumo
              já registrado.
            </p>
          </Grid>
          <Grid item>
            <Button
              color="primary"
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => abrirNovo()}
            >
              Novo modelo
            </Button>
          </Grid>
        </Grid>

        {carregando && (
          <div className={classes.vazio}>
            <Typography variant="body2">Carregando…</Typography>
          </div>
        )}

        {!carregando && precos.length === 0 && (
          <div className={classes.vazio}>
            <Typography variant="body2">
              Nenhum preço cadastrado ainda.
            </Typography>
          </div>
        )}

        {!carregando && precos.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Provedor</TableCell>
                <TableCell>Modelo</TableCell>
                <TableCell className={classes.numero}>Entrada</TableCell>
                <TableCell className={classes.numero}>Saída</TableCell>
                <TableCell className={classes.numero}>Cache</TableCell>
                <TableCell>Fonte</TableCell>
                <TableCell align="right">Ação</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {precos.map((p) => (
                <TableRow key={p.id || p.provider + "-" + p.model}>
                  <TableCell>{p.provider}</TableCell>
                  <TableCell>{p.model}</TableCell>
                  <TableCell className={classes.numero}>
                    {usd(p.inputPricePerMillion)}
                  </TableCell>
                  <TableCell className={classes.numero}>
                    {usd(p.outputPricePerMillion)}
                  </TableCell>
                  <TableCell className={classes.numero}>
                    {usd(p.cachedInputPricePerMillion)}
                  </TableCell>
                  <TableCell>
                    <Tooltip title={p.source || ""}>
                      <span className={classes.fonte}>{p.source || "—"}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => abrirEdicao(p)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Dialog
        open={dialogo.open}
        onClose={() => setDialogo({ open: false, editando: false })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {dialogo.editando ? "Editar preço" : "Cadastrar modelo"}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} style={{ marginTop: 4 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                label="Provedor"
                variant="outlined"
                size="small"
                value={form.provider}
                onChange={alterar("provider")}
                disabled={dialogo.editando}
              >
                {PROVIDERS.map((p) => (
                  <MenuItem key={p.value} value={p.value}>
                    {p.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Modelo"
                variant="outlined"
                size="small"
                value={form.model}
                onChange={alterar("model")}
                placeholder="claude-sonnet-4-20250514"
                disabled={dialogo.editando}
                helperText={
                  dialogo.editando
                    ? "Provedor e modelo identificam o registro e não mudam"
                    : "Use o id exato do provedor"
                }
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                type="number"
                label="Entrada (USD / 1M)"
                variant="outlined"
                size="small"
                value={form.inputPricePerMillion}
                onChange={alterar("inputPricePerMillion")}
                placeholder="3.00"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                type="number"
                label="Saída (USD / 1M)"
                variant="outlined"
                size="small"
                value={form.outputPricePerMillion}
                onChange={alterar("outputPricePerMillion")}
                placeholder="15.00"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                type="number"
                label="Cache (USD / 1M)"
                variant="outlined"
                size="small"
                value={form.cachedInputPricePerMillion}
                onChange={alterar("cachedInputPricePerMillion")}
                placeholder="0.30"
                helperText="0 se não usa cache"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Fonte (opcional)"
                variant="outlined"
                size="small"
                value={form.source}
                onChange={alterar("source")}
                placeholder="anthropic.com/pricing — conferido em 21/08/2026"
                helperText="Anote de onde veio o número e quando. Preço de LLM muda, e sem isso ninguém sabe se o valor está velho."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDialogo({ open: false, editando: false })}
            disabled={salvando}
          >
            Cancelar
          </Button>
          <Button
            onClick={salvar}
            color="primary"
            variant="contained"
            disabled={salvando}
          >
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ModelPricesManager;
