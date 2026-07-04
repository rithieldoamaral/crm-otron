import React, { useEffect, useState, useCallback } from "react";
import Grid from "@material-ui/core/Grid";
import MenuItem from "@material-ui/core/MenuItem";
import FormControl from "@material-ui/core/FormControl";
import InputLabel from "@material-ui/core/InputLabel";
import Select from "@material-ui/core/Select";
import TextField from "@material-ui/core/TextField";
import Typography from "@material-ui/core/Typography";
import Paper from "@material-ui/core/Paper";
import Button from "@material-ui/core/Button";
import IconButton from "@material-ui/core/IconButton";
import CircularProgress from "@material-ui/core/CircularProgress";
import Tooltip from "@material-ui/core/Tooltip";
import Tabs from "@material-ui/core/Tabs";
import Tab from "@material-ui/core/Tab";
import Box from "@material-ui/core/Box";
import RefreshIcon from "@material-ui/icons/Refresh";
import { makeStyles } from "@material-ui/core/styles";
import { toast } from "react-toastify";
import useSettings from "../../hooks/useSettings";
import useAuth from "../../hooks/useAuth.js";
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

const PERSONALITIES = [
  { value: "atencioso", label: "Atencioso — foco em resolver problemas, tom acolhedor" },
  { value: "vendedor", label: "Vendedor — proativo, destaca benefícios, cria urgência" },
  { value: "híbrido", label: "Híbrido — equilíbrio entre empatia e vendas (recomendado)" },
];

const DEFAULT_LLM_MODELS = {
  anthropic: [
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (recomendado)" },
    { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
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
    { id: "gpt-4o-mini", label: "GPT-4o Mini (recomendado)" },
    { id: "gpt-4o", label: "GPT-4o" },
  ],
  minimax: [
    { id: "abab6.5s-chat", label: "ABAB 6.5s (recomendado)" },
    { id: "abab5.5s-chat", label: "ABAB 5.5s" },
  ],
};

const DEFAULT_WHISPER_MODELS = {
  openai: [{ id: "whisper-1", label: "whisper-1" }],
  groq: [
    { id: "whisper-large-v3", label: "whisper-large-v3 (mais preciso)" },
    { id: "distil-whisper-large-v3-en", label: "distil-whisper-large-v3-en (mais rápido)" },
  ],
};

const SETTING_KEYS = [
  "agentProvider", "agentApiKey", "agentModel",
  "agentName", "agentPersonality",
  "agentBusinessName", "agentHours",
  "agentFAQ", "agentInstructions", "agentRestrictions",
  "agentOwnerNumber",
  // agentWhisperApiKey/Provider/Model removidos: Whisper agora é configuração
  // global do super admin (aba Integrações → Áudio / Transcrição).
  "secretaryAdminNumbers", "secretaryAlertWaitMinutes", "secretaryAlertAgentError",
  "secretaryBriefingTime", "secretaryResponseTimeGoal",
];

/**
 * Normaliza uma lista de números de admin (separados por vírgula) para o formato
 * de armazenamento: apenas dígitos, com código de país "55" (Brasil) adicionado
 * quando o usuário digita só DDD + número.
 *
 * O usuário digita "48988368758" ou "4888368758" (DDD + número); o sistema
 * persiste "5548988368758". Números que já vêm com 12-13 dígitos (já contendo
 * o "55") ou internacionais são mantidos como estão.
 *
 * @param {string} raw - valor cru do campo (ex: "48988368758, 11999990002")
 * @returns {string} números normalizados separados por vírgula
 */
const normalizeAdminNumbers = (raw) => {
  if (!raw || !raw.trim()) return "";
  return raw
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    .filter(Boolean)
    .map((digits) => {
      // 10 díg (DDD + fixo) ou 11 díg (DDD + 9 + celular) → prepend 55.
      if (digits.length === 10 || digits.length === 11) return `55${digits}`;
      return digits;
    })
    .join(",");
};

const useStyles = makeStyles((theme) => ({
  root: { width: "100%" },
  paper: { padding: theme.spacing(3), marginBottom: theme.spacing(2) },
  tabsRoot: {
    borderBottom: `1px solid ${theme.palette.divider}`,
    marginBottom: theme.spacing(2),
  },
  tab: {
    textTransform: "none",
    fontWeight: 500,
    minWidth: 100,
  },
  tabPanel: { paddingTop: theme.spacing(1) },
  field: { width: "100%", marginBottom: theme.spacing(1) },
  saveBtn: { marginTop: theme.spacing(2) },
  hint: { fontSize: "0.75rem", color: theme.palette.text.secondary, marginTop: 4 },
  modelRow: { display: "flex", alignItems: "center", gap: theme.spacing(1) },
  refreshBtn: { marginTop: 4 },
  sandboxChat: {
    display: "flex",
    flexDirection: "column",
    height: 420,
  },
  sandboxMessages: {
    flex: 1,
    overflowY: "auto",
    padding: theme.spacing(1),
    background: theme.palette.background.default,
    borderRadius: 4,
    marginBottom: theme.spacing(1),
    border: `1px solid ${theme.palette.divider}`,
  },
  sandboxBubble: {
    maxWidth: "80%",
    padding: "6px 12px",
    borderRadius: 12,
    marginBottom: 6,
    fontSize: "0.875rem",
    whiteSpace: "pre-wrap",
  },
  sandboxUser: {
    marginLeft: "auto",
    background: theme.palette.primary.main,
    color: "#fff",
    borderBottomRightRadius: 2,
  },
  sandboxAgent: {
    background: theme.palette.grey[200],
    color: theme.palette.text.primary,
    borderBottomLeftRadius: 2,
  },
  sandboxInputRow: {
    display: "flex",
    gap: theme.spacing(1),
    alignItems: "flex-end",
  },
}));

const TabPanel = ({ children, value, index }) => (
  <div hidden={value !== index} role="tabpanel">
    {value === index && <Box>{children}</Box>}
  </div>
);

const AgentSettings = ({ settings }) => {
  const classes = useStyles();
  const { update, getAll } = useSettings();
  const { getCurrentUserInfo } = useAuth();
  const isSuper = getCurrentUserInfo()?.super ?? false;
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(isSuper ? 0 : 1);

  const [values, setValues] = useState({
    agentProvider: "anthropic",
    agentApiKey: "",
    agentModel: "claude-sonnet-4-6",
    agentName: "Assistente",
    agentPersonality: "híbrido",
    agentBusinessName: "",
    agentHours: "",
    agentFAQ: "",
    agentInstructions: "",
    agentRestrictions: "",
    agentOwnerNumber: "",
    secretaryAdminNumbers: "",
    secretaryAlertWaitMinutes: "0",
    secretaryAlertAgentError: "disabled",
    secretaryBriefingTime: "08:00",
    secretaryResponseTimeGoal: "15",
  });

  const [llmModels, setLlmModels] = useState([]);
  const [fetchingLlm, setFetchingLlm] = useState(false);

  const [sandboxMessages, setSandboxMessages] = useState([]);
  const [sandboxInput, setSandboxInput] = useState("");
  const [sandboxLoading, setSandboxLoading] = useState(false);

  const fetchProviderModels = useCallback(async (type, provider, apiKey) => {
    if (!provider || !apiKey || apiKey.length < 10) return null;
    try {
      const { data } = await api.post("/agent/models", { provider, apiKey, type });
      return data.models?.length > 0 ? data.models : null;
    } catch {
      return null;
    }
  }, []);

  const handleRefreshLlm = useCallback(async () => {
    setFetchingLlm(true);
    const models = await fetchProviderModels("llm", values.agentProvider, values.agentApiKey);
    if (models) {
      setLlmModels(models);
      toast.success(`${models.length} modelos carregados`);
    } else {
      toast.warning("Não foi possível carregar modelos. Verifique a chave API.");
    }
    setFetchingLlm(false);
  }, [values.agentProvider, values.agentApiKey, fetchProviderModels]);

  useEffect(() => {
    if (!settings || !Array.isArray(settings)) return;
    const mapped = {};
    SETTING_KEYS.forEach((key) => {
      const found = settings.find((s) => s.key === key);
      if (found) mapped[key] = found.value;
    });
    setValues((prev) => ({ ...prev, ...mapped }));

    const provider = mapped.agentProvider || "anthropic";
    const apiKey = mapped.agentApiKey || "";
    if (apiKey.length > 10) {
      fetchProviderModels("llm", provider, apiKey).then(m => { if (m) setLlmModels(m); });
    }
  }, [settings, fetchProviderModels]);

  useEffect(() => {
    if (values.agentApiKey?.length > 10) {
      fetchProviderModels("llm", values.agentProvider, values.agentApiKey).then(m => {
        if (m) setLlmModels(m);
      });
    }
  }, [values.agentProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (key) => (e) => {
    const val = e.target.value;
    setValues((prev) => {
      if (key === "agentProvider") {
        const defaultModel = DEFAULT_LLM_MODELS[val]?.[0]?.id ?? "";
        return { ...prev, agentProvider: val, agentModel: defaultModel };
      }
      if (key === "agentWhisperProvider") {
        const defaultModel = DEFAULT_WHISPER_MODELS[val]?.[0]?.id ?? "";
        return { ...prev, agentWhisperProvider: val, agentWhisperModel: defaultModel };
      }
      return { ...prev, [key]: val };
    });
  };

  const handleSandboxSend = async () => {
    if (!sandboxInput.trim() || sandboxLoading) return;
    const userMsg = sandboxInput.trim();
    setSandboxInput("");
    const updatedHistory = [...sandboxMessages, { role: "user", content: userMsg }];
    setSandboxMessages(updatedHistory);
    setSandboxLoading(true);
    try {
      const history = sandboxMessages.map((m) => ({ role: m.role, content: m.content }));
      const { data } = await api.post("/agent/sandbox", { message: userMsg, history });
      setSandboxMessages([...updatedHistory, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setSandboxMessages([...updatedHistory, { role: "assistant", content: "Erro ao contactar o agente. Verifique a API Key nas configurações." }]);
    } finally {
      setSandboxLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Normaliza os números do admin antes de persistir: o usuário digita só
      // DDD + número e o "55" é incluído por trás (ticket #22 / request 2026-06-28).
      const normalizedValues = {
        ...values,
        secretaryAdminNumbers: normalizeAdminNumbers(values.secretaryAdminNumbers),
      };
      await Promise.all(
        SETTING_KEYS.map((key) => update({ key, value: normalizedValues[key] ?? "" }))
      );

      // Após salvar, re-busca os settings do backend e atualiza o estado local.
      // Isso garante que o nome/personalidade exibidos em todas as abas reflitam
      // o valor persistido, evitando a situação onde "Sofia" reaparecia após
      // navegação entre abas (o componente era remontado com prop desatualizado).
      const freshSettings = await getAll();
      if (Array.isArray(freshSettings)) {
        const mapped = {};
        SETTING_KEYS.forEach((key) => {
          const found = freshSettings.find((s) => s.key === key);
          if (found) mapped[key] = found.value;
        });
        setValues((prev) => ({ ...prev, ...mapped }));
      }

      toast.success("Configurações do agente salvas!");
    } catch (err) {
      console.error("[AgentSettings] handleSave failed:", err?.response?.data || err?.message || err);
      toast.error("Erro ao salvar configurações.");
    } finally {
      setSaving(false);
    }
  };

  const activeLlmModels = llmModels.length > 0 ? llmModels : (DEFAULT_LLM_MODELS[values.agentProvider] ?? []);

  return (
    <div className={classes.root}>
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        indicatorColor="primary"
        textColor="primary"
        variant="scrollable"
        scrollButtons="auto"
        className={classes.tabsRoot}
      >
        {isSuper && <Tab label="Provedor" value={0} className={classes.tab} />}
        <Tab label="Personalidade" value={1} className={classes.tab} />
        <Tab label="Conhecimento" value={2} className={classes.tab} />
        <Tab label="Secretária IA" value={4} className={classes.tab} />
        <Tab label="Sandbox" value={5} className={classes.tab} />
      </Tabs>

      {/* Tab 0 — Provedor */}
      <TabPanel value={activeTab} index={0}>
        <Paper className={classes.paper} elevation={1}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <FormControl variant="outlined" size="small" className={classes.field}>
                <InputLabel>Provedor</InputLabel>
                <Select value={values.agentProvider} onChange={handleChange("agentProvider")} label="Provedor">
                  {PROVIDERS.map((p) => (
                    <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
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
                value={values.agentApiKey}
                onChange={handleChange("agentApiKey")}
                placeholder="sk-..."
              />
              <p className={classes.hint}>A chave nunca é exibida após salva. Cole a nova para substituir.</p>
            </Grid>
            <Grid item xs={12}>
              <div className={classes.modelRow}>
                <FormControl variant="outlined" size="small" style={{ flex: 1 }}>
                  <InputLabel>Modelo</InputLabel>
                  <Select
                    value={values.agentModel}
                    onChange={handleChange("agentModel")}
                    label="Modelo"
                    disabled={fetchingLlm}
                  >
                    {activeLlmModels.map((m) => (
                      <MenuItem key={m.id} value={m.id}>{m.label || m.id}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Tooltip title="Buscar modelos atualizados do provedor">
                  <span>
                    <IconButton
                      size="small"
                      className={classes.refreshBtn}
                      onClick={handleRefreshLlm}
                      disabled={fetchingLlm || !values.agentApiKey}
                    >
                      {fetchingLlm ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
              </div>
              <p className={classes.hint}>
                Clique em ↻ para carregar modelos atualizados direto do provedor (requer API Key salva ou preenchida acima).
              </p>
            </Grid>
          </Grid>
        </Paper>
      </TabPanel>

      {/* Tab 1 — Personalidade */}
      <TabPanel value={activeTab} index={1}>
        <Paper className={classes.paper} elevation={1}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                className={classes.field}
                label="Nome do Agente"
                variant="outlined"
                size="small"
                value={values.agentName}
                onChange={handleChange("agentName")}
                placeholder="Ex: Luna, Max, Ana..."
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                className={classes.field}
                label="Nome do Negócio"
                variant="outlined"
                size="small"
                value={values.agentBusinessName}
                onChange={handleChange("agentBusinessName")}
                placeholder="Ex: Barbearia do João"
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl variant="outlined" size="small" className={classes.field}>
                <InputLabel>Personalidade</InputLabel>
                <Select value={values.agentPersonality} onChange={handleChange("agentPersonality")} label="Personalidade">
                  {PERSONALITIES.map((p) => (
                    <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                className={classes.field}
                label="Tom de Voz / Instruções Personalizadas"
                variant="outlined"
                size="small"
                multiline
                minRows={4}
                value={values.agentInstructions}
                onChange={handleChange("agentInstructions")}
                placeholder={
                  "Descreva como o agente deve se comportar, o tom de voz e regras específicas do seu negócio.\n" +
                  "Ex: Sempre chame a cliente pelo primeiro nome. Mencione nosso programa de fidelidade ao final de cada conversa. Quando a cliente perguntar sobre preço de pacote, destaque o desconto em relação ao preço avulso."
                }
              />
              <p className={classes.hint}>
                Este texto é enviado diretamente ao agente como instruções prioritárias. Quanto mais específico, melhor o comportamento.
              </p>
            </Grid>
          </Grid>
        </Paper>
      </TabPanel>

      {/* Tab 2 — Conhecimento */}
      <TabPanel value={activeTab} index={2}>
        <Paper className={classes.paper} elevation={1}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                className={classes.field}
                label="Horário de Atendimento"
                variant="outlined"
                size="small"
                multiline
                minRows={3}
                value={values.agentHours}
                onChange={handleChange("agentHours")}
                placeholder="Seg-Sex: 9h-19h&#10;Sáb: 9h-17h&#10;Dom: fechado"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                className={classes.field}
                label="Perguntas Frequentes (FAQ)"
                variant="outlined"
                size="small"
                multiline
                minRows={4}
                value={values.agentFAQ}
                onChange={handleChange("agentFAQ")}
                placeholder="P: Aceitam cartão? R: Sim, todos os cartões e Pix.&#10;P: Precisa agendar? R: Sim, pelo WhatsApp."
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                className={classes.field}
                label="Restrições"
                variant="outlined"
                size="small"
                multiline
                minRows={3}
                value={values.agentRestrictions}
                onChange={handleChange("agentRestrictions")}
                placeholder="Nunca mencionar concorrentes. Não dar desconto sem aprovação..."
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                className={classes.field}
                label="WhatsApp do Proprietário (notificações)"
                variant="outlined"
                size="small"
                value={values.agentOwnerNumber}
                onChange={handleChange("agentOwnerNumber")}
                placeholder="5511999999999 (só números, com DDI)"
              />
              <p className={classes.hint}>O agente vai enviar alertas urgentes para este número.</p>
            </Grid>
          </Grid>
        </Paper>
      </TabPanel>

      {/* Tab 4 — Secretária IA */}
      <TabPanel value={activeTab} index={4}>
        <Paper className={classes.paper} elevation={1}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                className={classes.field}
                label="Números dos Admins — DDD + número (separados por vírgula)"
                value={values.secretaryAdminNumbers}
                onChange={handleChange("secretaryAdminNumbers")}
                placeholder="48988368758, 11999990002"
                helperText="Digite apenas DDD + número (ex: 48988368758). O código do país (+55) é adicionado automaticamente. Somente estes números são reconhecidos como admins da secretária."
                variant="outlined"
                size="small"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                className={classes.field}
                label="Alerta de espera (minutos, 0 = desativado)"
                value={values.secretaryAlertWaitMinutes}
                onChange={handleChange("secretaryAlertWaitMinutes")}
                type="number"
                inputProps={{ min: 0 }}
                helperText="Notifica canal secretária quando ticket aberto fica sem resposta por X minutos"
                variant="outlined"
                size="small"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl className={classes.field} variant="outlined" size="small">
                <InputLabel>Alerta de erro do agente</InputLabel>
                <Select
                  value={values.secretaryAlertAgentError}
                  onChange={handleChange("secretaryAlertAgentError")}
                  label="Alerta de erro do agente"
                >
                  <MenuItem value="disabled">Desativado</MenuItem>
                  <MenuItem value="enabled">Ativado — notifica quando agente falha</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                className={classes.field}
                label="Horário do briefing matinal (HH:MM)"
                value={values.secretaryBriefingTime}
                onChange={handleChange("secretaryBriefingTime")}
                placeholder="08:00"
                helperText="A secretária envia um resumo do dia neste horário (ex: 08:00). Deixe em branco para desativar."
                variant="outlined"
                size="small"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                className={classes.field}
                label="Meta de tempo de resposta (minutos)"
                value={values.secretaryResponseTimeGoal}
                onChange={handleChange("secretaryResponseTimeGoal")}
                type="number"
                inputProps={{ min: 1 }}
                helperText="Agentes acima deste tempo aparecem destacados no relatório de desempenho (padrão: 15 min)"
                variant="outlined"
                size="small"
              />
            </Grid>
          </Grid>
        </Paper>
      </TabPanel>

      {/* Tab 5 — Sandbox */}
      <TabPanel value={activeTab} index={5}>
        <Paper className={classes.paper} elevation={1}>
          <Typography variant="subtitle2" gutterBottom>
            Conversar com o agente em modo sandbox — sem afetar tickets reais.
          </Typography>
          <div className={classes.sandboxChat}>
            <div className={classes.sandboxMessages}>
              {sandboxMessages.length === 0 && (
                <Typography variant="body2" color="textSecondary" style={{ textAlign: "center", marginTop: 16 }}>
                  Envie uma mensagem para testar o agente com as configurações atuais.
                </Typography>
              )}
              {sandboxMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}
                >
                  <div className={`${classes.sandboxBubble} ${msg.role === "user" ? classes.sandboxUser : classes.sandboxAgent}`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {sandboxLoading && (
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div className={`${classes.sandboxBubble} ${classes.sandboxAgent}`}>
                    <CircularProgress size={14} />
                  </div>
                </div>
              )}
            </div>
            <div className={classes.sandboxInputRow}>
              <TextField
                fullWidth
                variant="outlined"
                size="small"
                placeholder="Digite uma mensagem..."
                value={sandboxInput}
                onChange={(e) => setSandboxInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSandboxSend(); } }}
                multiline
                maxRows={3}
                disabled={sandboxLoading}
              />
              <Button
                variant="contained"
                color="primary"
                onClick={handleSandboxSend}
                disabled={sandboxLoading || !sandboxInput.trim()}
              >
                Enviar
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => setSandboxMessages([])}
                disabled={sandboxLoading}
              >
                Limpar
              </Button>
            </div>
          </div>
        </Paper>
      </TabPanel>

      <Button
        className={classes.saveBtn}
        variant="contained"
        color="primary"
        onClick={handleSave}
        disabled={saving}
        startIcon={saving ? <CircularProgress size={16} /> : null}
      >
        {saving ? "Salvando..." : "Salvar Configurações do Agente"}
      </Button>
    </div>
  );
};

export default AgentSettings;
