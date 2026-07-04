import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import FormControl from "@material-ui/core/FormControl";
import InputLabel from "@material-ui/core/InputLabel";
import Select from "@material-ui/core/Select";
import MenuItem from "@material-ui/core/MenuItem";

/**
 * ScheduleFilters — dropdowns para filtrar agendamentos por profissional e serviço.
 *
 * Why: com múltiplos profissionais e serviços, o calendário unificado fica ilegível.
 * Filtros permitem focar num recorte específico (ex: agenda da Ana, só cortes).
 *
 * How to apply: coloque no topo da página Schedules, passe listas vindas dos endpoints
 * /google-calendar/status (profissionais) e /google-calendar/services (serviços).
 */

const useStyles = makeStyles((theme) => ({
  filterBar: {
    display: "flex",
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
    flexWrap: "wrap",
  },
  select: {
    minWidth: 200,
  },
}));

const ScheduleFilters = ({
  professionals,
  services,
  selectedProfessionalId,
  selectedServiceId,
  onProfessionalChange,
  onServiceChange,
}) => {
  const classes = useStyles();

  return (
    <div className={classes.filterBar}>
      <FormControl variant="outlined" size="small" className={classes.select}>
        <InputLabel>Profissional</InputLabel>
        <Select
          label="Profissional"
          value={selectedProfessionalId || ""}
          onChange={(e) => onProfessionalChange(e.target.value || null)}
        >
          <MenuItem value="">Todos</MenuItem>
          {professionals.map((p) => (
            <MenuItem key={p.userId} value={p.userId}>
              {p.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl variant="outlined" size="small" className={classes.select}>
        <InputLabel>Serviço</InputLabel>
        <Select
          label="Serviço"
          value={selectedServiceId || ""}
          onChange={(e) => onServiceChange(e.target.value || null)}
        >
          <MenuItem value="">Todos</MenuItem>
          {services.map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.name} ({s.durationMinutes}min)
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </div>
  );
};

export default ScheduleFilters;
