import React from "react";
import Chip from "@material-ui/core/Chip";
import { makeStyles } from "@material-ui/core/styles";
import { getProfessionalColor } from "../../utils/professionalColors";

/**
 * ScheduleLegend — chips coloridos identificando cada profissional no calendário.
 *
 * Why: sem legenda, cores isoladas nos eventos viram ruído. A legenda ensina
 * o mapeamento cor → profissional ao usuário em 2 segundos.
 *
 * How to apply: renderize abaixo dos filtros na página Schedules, passando a
 * lista completa de profissionais (mesmo os filtrados aparecem na legenda).
 */

const useStyles = makeStyles((theme) => ({
  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
  chip: {
    color: "#fff",
    fontWeight: 500,
  },
}));

const ScheduleLegend = ({ professionals }) => {
  const classes = useStyles();
  if (!professionals || professionals.length === 0) return null;

  return (
    <div className={classes.legend}>
      {professionals.map((p) => (
        <Chip
          key={p.userId}
          label={p.name}
          className={classes.chip}
          style={{ backgroundColor: getProfessionalColor(p.userId) }}
          size="small"
        />
      ))}
    </div>
  );
};

export default ScheduleLegend;
