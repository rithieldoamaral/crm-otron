import React from "react";
import {
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Tooltip,
  makeStyles
} from "@material-ui/core";
import CheckCircleIcon from "@material-ui/icons/CheckCircle";
import WarningIcon from "@material-ui/icons/WarningRounded";
import FacebookIcon from "@material-ui/icons/Facebook";

/**
 * Etapa 1 do assistente — escolha do tipo de canal.
 *
 * REGRA DE ESCRITA DESTA TELA: zero jargão. Quem lê é dono de negócio, não
 * desenvolvedor. "API não-oficial", "Cloud API" e "BSP" não significam nada
 * para ele; "risco de bloqueio" e "custa poucos reais por mês" significam.
 *
 * Cada cartão diz o que a pessoa PRECISA TER EM MÃOS antes de começar. Sem
 * isso, ela descobre no meio do preenchimento que falta um dado e abandona —
 * que é o ponto onde assistentes de configuração costumam perder o usuário.
 */

const useStyles = makeStyles(theme => ({
  cartao: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    cursor: "pointer",
    border: "2px solid transparent",
    transition: "border-color .15s, box-shadow .15s",
    "&:hover": {
      borderColor: theme.palette.primary.main,
      boxShadow: theme.shadows[4]
    }
  },
  conteudo: { flexGrow: 1 },
  titulo: {
    fontSize: "1.05rem",
    fontWeight: 700,
    margin: "0 0 4px",
    color: theme.palette.primary.main
  },
  resumo: {
    fontSize: "0.85rem",
    color: theme.palette.text.secondary,
    margin: "0 0 12px"
  },
  linha: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    fontSize: "0.8rem",
    marginBottom: 6
  },
  bom: { color: theme.palette.success.main, fontSize: 16, flexShrink: 0 },
  atencao: { color: theme.palette.warning.main, fontSize: 16, flexShrink: 0 },
  paraQuem: {
    fontSize: "0.75rem",
    fontStyle: "italic",
    color: theme.palette.text.secondary,
    marginTop: 8
  },
  precisa: {
    marginTop: 12,
    padding: theme.spacing(1, 1.5),
    borderRadius: 4,
    backgroundColor:
      theme.palette.type === "light" ? "#F4F2EC" : "rgba(255,255,255,0.06)"
  },
  precisaTitulo: {
    fontSize: "0.7rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: theme.palette.text.secondary
  },
  precisaItem: { fontSize: "0.75rem", margin: "2px 0 0" }
}));

const CANAIS = [
  {
    tipo: "baileys",
    emoji: "📱",
    titulo: "WhatsApp comum (QR Code)",
    resumo: "Conecta lendo um QR code, como no WhatsApp Web.",
    bons: [
      "Grátis e funciona na hora",
      "Envia mensagem a qualquer momento, sem restrição de horário"
    ],
    atencoes: [
      "É uma conexão não-oficial: existe risco de bloqueio pelo WhatsApp"
    ],
    paraQuem: "Melhor para começar rápido e para atendimento de baixo volume.",
    precisa: ["O celular com o WhatsApp que você quer conectar"]
  },
  {
    tipo: "twilio",
    emoji: "🛡️",
    titulo: "Oficial via Twilio",
    resumo: "Conexão oficial da Meta, intermediada pela Twilio.",
    bons: [
      "Sem risco de bloqueio",
      "Começa custando poucos reais por mês",
      "Não exige empresa verificada na Meta"
    ],
    atencoes: [
      "Para iniciar conversa depois de 24h sem resposta do cliente, precisa de mensagem pré-aprovada"
    ],
    paraQuem: "Melhor para testar o canal oficial gastando pouco.",
    precisa: [
      "Conta na Twilio (twilio.com)",
      "Account SID e Auth Token, que ficam no painel deles",
      "Um número de WhatsApp habilitado na Twilio"
    ]
  },
  {
    tipo: "cloud_api",
    emoji: "🏢",
    titulo: "Oficial direto com a Meta",
    resumo: "Conexão oficial sem intermediário.",
    bons: ["Sem risco de bloqueio", "O menor custo por mensagem"],
    atencoes: [
      "Exige CNPJ verificado na Meta",
      "A configuração tem mais passos"
    ],
    paraQuem: "Melhor para volume alto, com a empresa já verificada.",
    precisa: [
      "Conta no Meta Business com empresa verificada",
      "ID do número (Phone number ID) e ID da conta (WABA ID)",
      "Token de acesso permanente e o App Secret"
    ]
  }
];

const EscolhaDoCanal = ({ onEscolher, embeddedSignupHabilitado = false }) => {
  const classes = useStyles();

  return (
    <Grid container spacing={2}>
      {CANAIS.map(canal => (
        <Grid item xs={12} md={4} key={canal.tipo}>
          <Card
            className={classes.cartao}
            onClick={() => onEscolher(canal.tipo)}
            elevation={1}
          >
            <CardContent className={classes.conteudo}>
              <h3 className={classes.titulo}>
                {canal.emoji} {canal.titulo}
              </h3>
              <p className={classes.resumo}>{canal.resumo}</p>

              {canal.bons.map(texto => (
                <div className={classes.linha} key={texto}>
                  <CheckCircleIcon className={classes.bom} />
                  <span>{texto}</span>
                </div>
              ))}

              {canal.atencoes.map(texto => (
                <div className={classes.linha} key={texto}>
                  <WarningIcon className={classes.atencao} />
                  <span>{texto}</span>
                </div>
              ))}

              <div className={classes.paraQuem}>{canal.paraQuem}</div>

              {/* O que ter em mãos ANTES de começar: evita o abandono no meio
                  do preenchimento por falta de um dado. */}
              <div className={classes.precisa}>
                <div className={classes.precisaTitulo}>
                  Você vai precisar de
                </div>
                {canal.precisa.map(item => (
                  <p className={classes.precisaItem} key={item}>
                    • {item}
                  </p>
                ))}
              </div>

              {/* Embedded Signup: construído de verdade, desligado por flag.
                  Ligar depois é trocar META_EMBEDDED_SIGNUP_ENABLED, não
                  escrever código. */}
              {canal.tipo === "cloud_api" && (
                <div style={{ marginTop: 12 }}>
                  <Tooltip
                    title={
                      embeddedSignupHabilitado
                        ? "Conectar pelo Facebook"
                        : "Disponível quando sua empresa estiver verificada na Meta e o app aprovado como Tech Provider."
                    }
                  >
                    <span>
                      <Button
                        fullWidth
                        size="small"
                        variant="outlined"
                        color="primary"
                        startIcon={<FacebookIcon />}
                        disabled={!embeddedSignupHabilitado}
                        onClick={e => {
                          e.stopPropagation();
                          onEscolher("cloud_api", { embedded: true });
                        }}
                      >
                        Conectar com Facebook
                      </Button>
                    </span>
                  </Tooltip>
                  {!embeddedSignupHabilitado && (
                    <Chip
                      size="small"
                      label="Em breve"
                      style={{ marginTop: 6 }}
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
};

export default EscolhaDoCanal;
