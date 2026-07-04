/**
 * IntegrationSettings — configurações globais de integrações para super admin.
 *
 * Exibe dois painéis:
 *   1. LLM — Agente de Atendimento (globalAgentProvider/ApiKey/Model)
 *   2. LLM — Secretária IA         (globalSecretaryProvider/ApiKey/Model)
 *
 * Atenção: mudanças aqui afetam TODAS as empresas da plataforma.
 * Apenas super admins têm acesso a esta tela.
 */

import React, { useEffect, useState, useCallback } from "react";
import Grid from "@material-ui/core/Grid";
import Paper from "@material-ui/core/Paper";
import TextField from "@material-ui/core/TextField";
import FormControl from "@material-ui/core/FormControl";
import InputLabel from "@material-ui/core/InputLabel";
import Select from "@material-ui/core/Select";
import MenuItem from "@material-ui/core/MenuItem";
import Button from "@material-ui/core/Button";
import IconButton from "@material-ui/core/IconButton";
import CircularProgress from "@material-ui/core/CircularProgress";
import Tooltip from "@material-ui/core/Tooltip";
import Typography from "@material-ui/core/Typography";
import RefreshIcon from "@material-ui/icons/Refresh";
import { makeStyles } from "@material-ui/core/styles";
import { toast } from "react-toastify";
import api from "../../services/api";

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "groq", label: "Groq (Llama / Mixtral)" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "openai", label: "OpenAI (GPT)" },
  { value: "minimax", label: "MiniMax" },
];

const WHISPER_PROVIDERS = [
  { value: "openai", label: "OpenAI Whisper" },
  { value: "groq", label: "Groq Whisper (mais rápido e barato)" },
];

const DEFAULT_WHISPER_MODELS = {
  openai: [{ id: "whisper-1", label: "whisper-1" }],
  groq: [
    { id: "whisper-large-v3", label: "whisper-large-v3 (mais preciso)" },
    { id: "distil-whisper-large-v3-en", label: "distil-whisper-large-v3-en (mais rápido)" },
  ],
};

const DEFAULT_MODELS = {
  anthropic: [
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — rápido, econômico" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — equilibrado (recomendado)" },
    { id: "claude-opus-4-7", label: "Claude Opus 4.7 — mais poderoso" },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recomendado)" },
    { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (ultra rápido)" },
  ],
  openrouter: [
    { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet via OpenRouter" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B via OpenRouter" },
  ],
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o Mini — rápido, econômico" },
    { id: "gpt-4o", label: "GPT-4o — mais poderoso" },
  ],
  minimax: [
    { id: "abab6.5s-chat", label: "ABAB 6.5s (recomendado)" },
    { id: "abab5.5s-chat", label: "ABAB 5.5s" },
  ],
};

const useStyles = makeStyles((theme) => ({
  root: { width: "100%" },
  section: { padding: theme.spacing(3), marginBottom: theme.spacing(3) },
  sectionTitle: {
    fontWeight: 600,
    marginBottom: theme.spacing(2),
    borderBottom: `2px solid ${theme.palette.primary.main}`,
    paddingBottom: theme.spacing(1),
  },
  warning: {
    background: theme.palette.warning.light,
    color: theme.palette.warning.contrastText,
    padding: theme.spacing(1.5),
    borderRadius: 4,
    marginBottom: theme.spacing(2),
    fontSize: "0.85rem",
  },
  field: { width: "100%", marginBottom: theme.spacing(1) },
  hint: { fontSize: "0.75rem", color: theme.palette.text.secondary, marginTop: 4 },
  modelRow: { display: "flex", alignItems: "center", gap: theme.spacing(1) },
  refreshBtn: { marginTop: 4 },
  saveBtn: { marginTop: theme.spacing(2) },
}));

/** Painel reutilizável para configurar um LLM (atendimento ou secretária) */
function LLMPanel({ title, providerKey, apiKeyKey, modelKey, values, onChange, classes }) {
  const [fetchingModels, setFetchingModels] = useState(false);
  const [dynamicModels, setDynamicModels] = useState([]);

  const provider = values[providerKey] || "anthropic";
  const apiKey = values[apiKeyKey] || "";
  const model = values[modelKey] || "";

  const availableModels =
    dynamicModels.length > 0 ? dynamicModels : (DEFAULT_MODELS[provider] ?? []);

  const handleRefreshModels = useCallback(async () => {
    if (!apiKey || apiKey === "••••") {
      toast.warning("Salve a API Key antes de buscar modelos.");
      return;
    }
    setFetchingModels(true);
    try {
      const { data } = await api.post("/agent/models", { provider, apiKey, type: "llm" });
      setDynamicModels(data.models ?? []);
      toast.success("Modelos atualizados!");
    } catch {
      toast.error("Não foi possível carregar os modelos. Verifique a API Key.");
    } finally {
      setFetchingModels(false);
    }
  }, [provider, apiKey]);

  // Resetar modelos dinâmicos ao trocar de provedor
  useEffect(() => {
    setDynamicModels([]);
  }, [provider]);

  return (
    <Paper className={classes.section} elevation={1}>
      <Typography variant="subtitle1" className={classes.sectionTitle}>
        {title}
      </Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={4}>
          <FormControl variant="outlined" size="small" className={classes.field}>
            <InputLabel>Provedor</InputLabel>
            <Select
              value={provider}
              onChange={(e) => onChange(providerKey, e.target.value)}
              label="Provedor"
            >
              {PROVIDERS.map((p) => (
                <MenuItem key={p.value} value={p.value}>
                  {p.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} sm={8}>
          <TextField
            className={classes.field}
            label="API Key"
            variant="outlined"
            size="small"
            type="password"
            value={apiKey}
            onChange={(e) => onChange(apiKeyKey, e.target.value)}
            placeholder="sk-..."
          />
          <p className={classes.hint}>
            A chave é mascarada após salva. Cole a nova para substituir.
          </p>
        </Grid>
        <Grid item xs={12}>
          <div className={classes.modelRow}>
            <FormControl
              variant="outlined"
              size="small"
              style={{ flex: 1 }}
            >
              <InputLabel>Modelo</InputLabel>
              <Select
                value={model}
                onChange={(e) => onChange(modelKey, e.target.value)}
                label="Modelo"
                disabled={fetchingModels}
              >
                {availableModels.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    {m.label || m.id}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Tooltip title="Buscar modelos atualizados do provedor">
              <span>
                <IconButton
                  size="small"
                  className={classes.refreshBtn}
                  onClick={handleRefreshModels}
                  disabled={fetchingModels || !apiKey || apiKey === "••••"}
                >
                  {fetchingModels ? (
                    <CircularProgress size={16} />
                  ) : (
                    <RefreshIcon fontSize="small" />
                  )}
                </IconButton>
              </span>
            </Tooltip>
          </div>
          <p className={classes.hint}>
            Clique em ↻ para carregar modelos atualizados do provedor.
          </p>
        </Grid>
      </Grid>
    </Paper>
  );
}

/** Painel reutilizável para configurar Whisper (transcrição de áudio) */
function WhisperPanel({ values, onChange, classes }) {
  const [fetchingModels, setFetchingModels] = useState(false);
  const [dynamicModels, setDynamicModels] = useState([]);

  const provider = values.globalWhisperProvider || "openai";
  const apiKey = values.globalWhisperApiKey || "";
  const model = values.globalWhisperModel || "";

  const availableModels =
    dynamicModels.length > 0 ? dynamicModels : (DEFAULT_WHISPER_MODELS[provider] ?? []);

  const handleRefreshModels = useCallback(async () => {
    if (!apiKey || apiKey === "••••") {
      toast.warning("Salve a API Key antes de buscar modelos.");
      return;
    }
    setFetchingModels(true);
    try {
      const { data } = await api.post("/agent/models", { provider, apiKey, type: "transcription" });
      setDynamicModels(data.models ?? []);
      toast.success("Modelos Whisper atualizados!");
    } catch {
      toast.error("Não foi possível carregar os modelos. Verifique a API Key.");
    } finally {
      setFetchingModels(false);
    }
  }, [provider, apiKey]);

  useEffect(() => { setDynamicModels([]); }, [provider]);

  return (
    <Paper className={classes.section} elevation={1}>
      <Typography variant="subtitle1" className={classes.sectionTitle}>
        🎙️ Transcrição de Áudio — Whisper
      </Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={4}>
          <FormControl variant="outlined" size="small" className={classes.field}>
            <InputLabel>Provedor Whisper</InputLabel>
            <Select
              value={provider}
              onChange={(e) => onChange("globalWhisperProvider", e.target.value)}
              label="Provedor Whisper"
            >
              {WHISPER_PROVIDERS.map((p) => (
                <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} sm={8}>
          <TextField
            className={classes.field}
            label="API Key Whisper"
            variant="outlined"
            size="small"
            type="password"
            value={apiKey}
            onChange={(e) => onChange("globalWhisperApiKey", e.target.value)}
            placeholder="sk-... ou gsk-..."
          />
          <p className={classes.hint}>
            Independente do LLM de atendimento. Deixe em branco para desativar transcrição de áudio.
          </p>
        </Grid>
        <Grid item xs={12}>
          <div className={classes.modelRow}>
            <FormControl variant="outlined" size="small" style={{ flex: 1 }}>
              <InputLabel>Modelo Whisper</InputLabel>
              <Select
                value={model}
                onChange={(e) => onChange("globalWhisperModel", e.target.value)}
                label="Modelo Whisper"
                disabled={fetchingModels}
              >
                {availableModels.map((m) => (
                  <MenuItem key={m.id} value={m.id}>{m.label || m.id}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Tooltip title="Buscar modelos Whisper disponíveis do provedor">
              <span>
                <IconButton
                  size="small"
                  className={classes.refreshBtn}
                  onClick={handleRefreshModels}
                  disabled={fetchingModels || !apiKey || apiKey === "••••"}
                >
                  {fetchingModels ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          </div>
          <p className={classes.hint}>Clique em ↻ para carregar modelos atualizados do provedor.</p>
        </Grid>
      </Grid>
    </Paper>
  );
}

export default function IntegrationSettings() {
  const classes = useStyles();
  const [values, setValues] = useState({
    globalAgentProvider: "anthropic",
    globalAgentApiKey: "",
    globalAgentModel: "claude-haiku-4-5-20251001",
    globalSecretaryProvider: "anthropic",
    globalSecretaryApiKey: "",
    globalSecretaryModel: "claude-sonnet-4-6",
    globalWhisperProvider: "openai",
    globalWhisperApiKey: "",
    globalWhisperModel: "whisper-1",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Carregar settings globais atuais
  useEffect(() => {
    const fetchGlobal = async () => {
      try {
        const { data } = await api.get("/global-settings");
        setValues((prev) => ({ ...prev, ...data }));
      } catch {
        toast.error("Erro ao carregar configurações globais.");
      } finally {
        setLoading(false);
      }
    };
    fetchGlobal();
  }, []);

  const handleChange = useCallback((key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put("/global-settings", values);
      toast.success("Configurações globais salvas! Todas as empresas serão atualizadas em até 30s.");
    } catch {
      toast.error("Erro ao salvar configurações globais.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <CircularProgress />
      </div>
    );
  }

  return (
    <div className={classes.root}>
      <div className={classes.warning}>
        ⚠️ <strong>Atenção:</strong> Alterações aqui afetam <strong>todas as empresas</strong>{" "}
        da plataforma simultaneamente. O efeito ocorre em até 30 segundos.
      </div>

      <LLMPanel
        title="🤖 LLM — Agente de Atendimento (WhatsApp)"
        providerKey="globalAgentProvider"
        apiKeyKey="globalAgentApiKey"
        modelKey="globalAgentModel"
        values={values}
        onChange={handleChange}
        classes={classes}
      />

      <LLMPanel
        title="🗂️ LLM — Secretária IA (Gestão e Análises)"
        providerKey="globalSecretaryProvider"
        apiKeyKey="globalSecretaryApiKey"
        modelKey="globalSecretaryModel"
        values={values}
        onChange={handleChange}
        classes={classes}
      />

      <WhisperPanel
        values={values}
        onChange={handleChange}
        classes={classes}
      />

      <Button
        variant="contained"
        color="primary"
        className={classes.saveBtn}
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? <CircularProgress size={20} /> : "SALVAR CONFIGURAÇÕES GLOBAIS"}
      </Button>
    </div>
  );
}
