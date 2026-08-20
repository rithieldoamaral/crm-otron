import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import { FiShield } from "react-icons/fi";

const useStyles = makeStyles((theme) => ({
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    marginLeft: 6,
    padding: "1px 5px",
    borderRadius: 4,
    // Cor de ativação do manual da marca (#BDF23C). O manual define essa cor
    // como "ativação, dado" — exatamente a função aqui: sinalizar o que exige
    // atenção. Contraste alto sobre o verde-petróleo e sobre fundo claro.
    backgroundColor: theme.palette.ativacao.main,
    color: theme.palette.ativacao.contrastText,
    fontSize: "0.6rem",
    fontWeight: 700,
    letterSpacing: "0.04em",
    lineHeight: 1.4,
    verticalAlign: "middle",
    flexShrink: 0,
  },
  rotulo: {
    display: "inline-flex",
    alignItems: "center",
  },
}));

/**
 * Selo "SA" — marca visualmente o que só o superadmin enxerga.
 *
 * ATENÇÃO: isto é SINALIZAÇÃO VISUAL, não controle de acesso. Quem bloqueia
 * de fato é o middleware `isSuper` no backend (CLAUDE.md XV.1 — esconder no
 * frontend não é proteger). Exibir ou omitir este selo não altera permissão
 * nenhuma; ele existe para o operador entender de relance por que aquele item
 * não aparece para os clientes dele.
 *
 * @param {string} [titulo] - Texto acessível do selo.
 *
 * @example
 * <Tab label={<ComSelo>Empresas</ComSelo>} />
 */
const SuperAdminBadge = ({ titulo = "Somente superadmin" }) => {
  const classes = useStyles();

  return (
    <span className={classes.badge} title={titulo} aria-label={titulo}>
      <FiShield size={9} />
      SA
    </span>
  );
};

/**
 * Envolve um rótulo acrescentando o selo "SA" ao lado.
 * Útil em `<Tab label={...} />`, onde só há espaço para um nó.
 */
export const ComSelo = ({ children }) => {
  const classes = useStyles();

  return (
    <span className={classes.rotulo}>
      {children}
      <SuperAdminBadge />
    </span>
  );
};

export default SuperAdminBadge;
