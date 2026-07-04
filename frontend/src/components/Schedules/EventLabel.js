import React from "react";
import Tooltip from "@material-ui/core/Tooltip";
import EditIcon from "@material-ui/icons/Edit";
import DeleteOutlineIcon from "@material-ui/icons/DeleteOutline";
import { makeStyles } from "@material-ui/core/styles";

/**
 * EventLabel — conteúdo visual de um evento no calendário (nome do contato + ações).
 *
 * Why: quando definido inline no render da página Schedules, React cria novo componente
 * a cada re-render, quebrando reconciliation e causando flicker. Extraído + memoizado,
 * só re-renderiza se o `schedule` mudar.
 *
 * How to apply: passe como conteúdo do `title` em eventos do react-big-calendar.
 */

const useStyles = makeStyles((theme) => ({
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  label: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actions: {
    display: "flex",
    gap: theme.spacing(0.5),
    "& svg": {
      fontSize: 16,
      cursor: "pointer",
      opacity: 0.85,
      color: "#fff",
      "&:hover": { opacity: 1 },
    },
  },
}));

const EventLabel = React.memo(function EventLabel({ schedule, onEdit, onDelete }) {
  const classes = useStyles();
  const contactName = schedule.contact?.name || "—";
  const serviceName = schedule.service?.name;

  return (
    <div className={classes.root}>
      <Tooltip title={contactName} placement="top">
        <span className={classes.label}>
          {contactName}
          {serviceName ? ` · ${serviceName}` : ""}
        </span>
      </Tooltip>
      <div className={classes.actions}>
        <Tooltip title="Editar" placement="top">
          <EditIcon onClick={() => onEdit(schedule)} />
        </Tooltip>
        <Tooltip title="Excluir" placement="top">
          <DeleteOutlineIcon onClick={() => onDelete(schedule)} />
        </Tooltip>
      </div>
    </div>
  );
});

export default EventLabel;
