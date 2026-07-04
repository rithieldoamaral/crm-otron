import React, { useState, useEffect, useReducer, useCallback, useContext } from "react";
import { toast } from "react-toastify";
import { useHistory } from "react-router-dom";
import { makeStyles, useTheme } from "@material-ui/core/styles";
import Paper from "@material-ui/core/Paper";
import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";
import InputAdornment from "@material-ui/core/InputAdornment";
import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import Title from "../../components/Title";
import api from "../../services/api";
import { i18n } from "../../translate/i18n";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import ScheduleModal from "../../components/ScheduleModal";
import ConfirmationModal from "../../components/ConfirmationModal";
import ScheduleFilters from "../../components/Schedules/ScheduleFilters";
import ScheduleLegend from "../../components/Schedules/ScheduleLegend";
import EventLabel from "../../components/Schedules/EventLabel";
import toastError from "../../errors/toastError";
import moment from "moment";
import { SocketContext } from "../../context/Socket/SocketContext";
import { AuthContext } from "../../context/Auth/AuthContext";
import { Calendar, momentLocalizer } from "react-big-calendar";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import "moment/locale/pt-br";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";
import SearchIcon from "@material-ui/icons/Search";
import Box from "@material-ui/core/Box";
import CircularProgress from "@material-ui/core/CircularProgress";
import { getProfessionalColor } from "../../utils/professionalColors";

// Synthetic resource id para agendamentos sem profissional atribuído.
// react-big-calendar ignora eventos cujo resourceId não existe em `resources`,
// então precisamos de um "bucket" para legados.
const UNASSIGNED_RESOURCE_ID = "__unassigned__";

const useStyles = makeStyles((theme) => ({
  mainPaper: {
    flex: 1,
    padding: theme.spacing(2),
    overflowY: "scroll",
    ...theme.scrollbarStyles,
    borderRadius: 10,
    backgroundColor: theme.palette.background.paper,
    borderColor: theme.palette.divider,
  },
  searchField: {
    marginRight: theme.spacing(2),
    backgroundColor: theme.palette.background.paper,
    borderRadius: 4,
  },
  addButton: {
    borderRadius: 4,
    textTransform: "none",
    fontWeight: 500,
    boxShadow: "none",
    "&:hover": { boxShadow: "none" },
  },
  calendarContainer: {
    height: "calc(100vh - 260px)",
    marginTop: theme.spacing(2),
    "& .rbc-toolbar": {
      marginBottom: theme.spacing(2),
      color: theme.palette.text.primary,
      "& button": {
        color: theme.palette.text.primary,
        borderColor: theme.palette.divider,
        "&:hover": { backgroundColor: theme.palette.action.hover },
        "&.rbc-active": {
          backgroundColor: theme.palette.action.selected,
          boxShadow: "none",
        },
      },
    },
    "& .rbc-header": {
      color: theme.palette.text.primary,
      borderBottomColor: theme.palette.divider,
    },
    "& .rbc-off-range-bg": {
      backgroundColor: theme.palette.action.disabledBackground,
    },
    "& .rbc-event": {
      padding: "2px 5px",
      borderRadius: 4,
      color: "#fff",
      border: "none",
      "&:hover": { opacity: 0.9 },
    },
    "& .rbc-today": {
      backgroundColor: theme.palette.action.selected,
    },
    "& .rbc-time-view, & .rbc-month-view, & .rbc-time-header": {
      borderColor: theme.palette.divider,
    },
  },
  eventActions: {
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
  loadingContainer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: 100,
  },
}));

const defaultMessages = {
  date: "Data",
  time: "Hora",
  event: "Evento",
  allDay: "Dia Todo",
  week: "Semana",
  work_week: "Agendamentos",
  day: "Dia",
  month: "Mês",
  previous: "Anterior",
  next: "Próximo",
  yesterday: "Ontem",
  tomorrow: "Amanhã",
  today: "Hoje",
  agenda: "Agenda",
  noEventsInRange: "Não há agendamentos no período.",
  showMore: (total) => `+${total} mais`,
};

const localizer = momentLocalizer(moment);
const DnDCalendar = withDragAndDrop(Calendar);

const schedulesReducer = (state, action) => {
  switch (action.type) {
    case "LOAD_SCHEDULES": {
      const existingIds = new Set(state.map((s) => s.id));
      const newSchedules = action.payload.filter((s) => !existingIds.has(s.id));
      return [...state, ...newSchedules];
    }
    case "UPDATE_SCHEDULES": {
      const schedule = action.payload;
      const existing = state.find((s) => s.id === schedule.id);
      return existing
        ? state.map((s) => (s.id === schedule.id ? schedule : s))
        : [schedule, ...state];
    }
    case "DELETE_SCHEDULE":
      return state.filter((s) => s.id !== action.payload);
    case "RESET":
      return [];
    default:
      return state;
  }
};

const Schedules = () => {
  const classes = useStyles();
  const theme = useTheme();
  const history = useHistory();
  const { user } = useContext(AuthContext);
  const socketManager = useContext(SocketContext);

  const [state, setState] = useState({
    loading: false,
    pageNumber: 1,
    hasMore: false,
    searchParam: "",
    contactId: null,
    selectedSchedule: null,
    deletingSchedule: null,
    confirmModalOpen: false,
    scheduleModalOpen: false,
  });

  // Filtros
  const [professionals, setProfessionals] = useState([]);
  const [services, setServices] = useState([]);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState(null);
  const [selectedServiceId, setSelectedServiceId] = useState(null);
  const [currentView, setCurrentView] = useState("month");

  const [schedules, dispatch] = useReducer(schedulesReducer, []);

  // Carrega profissionais e serviços uma vez (para popular filtros e legenda)
  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        const [profsRes, servicesRes] = await Promise.all([
          api.get("/google-calendar/status"),
          api.get("/google-calendar/services"),
        ]);
        setProfessionals(profsRes.data || []);
        setServices(servicesRes.data || []);
      } catch (err) {
        // Silencioso: filtros ficam vazios se endpoints não responderem
      }
    };
    loadFilterOptions();
  }, []);

  const fetchSchedules = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, loading: true }));

      const params = {
        searchParam: state.searchParam,
        pageNumber: state.pageNumber,
      };
      if (selectedProfessionalId) params.professionalId = selectedProfessionalId;
      if (selectedServiceId) params.serviceId = selectedServiceId;

      const { data } = await api.get("/schedules/", { params });

      dispatch({ type: "LOAD_SCHEDULES", payload: data.schedules });
      setState((prev) => ({
        ...prev,
        hasMore: data.hasMore,
        loading: false,
      }));
    } catch (err) {
      toastError(err);
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [state.searchParam, state.pageNumber, selectedProfessionalId, selectedServiceId]);

  // Quando os filtros mudam, resetamos a lista antes de refetch para não
  // acumular resultados filtrados+não-filtrados na mesma memória.
  useEffect(() => {
    dispatch({ type: "RESET" });
    setState((prev) => ({ ...prev, pageNumber: 1 }));
  }, [selectedProfessionalId, selectedServiceId]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchSchedules();
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [fetchSchedules]);

  useEffect(() => {
    const socket = socketManager.getSocket(user.companyId);

    const handleScheduleEvent = (data) => {
      if (data.action === "update" || data.action === "create") {
        dispatch({ type: "UPDATE_SCHEDULES", payload: data.schedule });
      }
      if (data.action === "delete") {
        dispatch({ type: "DELETE_SCHEDULE", payload: data.scheduleId });
      }
    };

    socket.on(`company${user.companyId}-schedule`, handleScheduleEvent);
    return () => {
      socket.off(`company${user.companyId}-schedule`, handleScheduleEvent);
    };
  }, [socketManager, user.companyId]);

  const updateState = (updates) => setState((prev) => ({ ...prev, ...updates }));

  const handleSearch = (event) => {
    updateState({ searchParam: event.target.value.toLowerCase(), pageNumber: 1 });
    dispatch({ type: "RESET" });
  };

  const handleOpenScheduleModal = () => {
    updateState({ selectedSchedule: null, scheduleModalOpen: true });
  };

  const handleCloseScheduleModal = () => {
    updateState({ selectedSchedule: null, scheduleModalOpen: false, contactId: null });
  };

  const handleEditSchedule = (schedule) => {
    updateState({ selectedSchedule: schedule, scheduleModalOpen: true });
  };

  const handleDeleteSchedule = async (scheduleId) => {
    try {
      await api.delete(`/schedules/${scheduleId}`);
      toast.success(i18n.t("schedules.toasts.deleted"));
      updateState({
        confirmModalOpen: false,
        deletingSchedule: null,
        searchParam: "",
        pageNumber: 1,
      });
      dispatch({ type: "RESET" });
      await fetchSchedules();
    } catch (err) {
      toastError(err);
    }
  };

  const handleScroll = (e) => {
    if (!state.hasMore || state.loading) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - (scrollTop + 100) < clientHeight) {
      setState((prev) => ({ ...prev, pageNumber: prev.pageNumber + 1 }));
    }
  };

  // Resources para day/week view: 1 coluna por profissional.
  // Se filtro de profissional está ativo, mostra só aquele; senão, todos + "Sem profissional".
  const resources = React.useMemo(() => {
    const base = selectedProfessionalId
      ? professionals.filter((p) => p.userId === selectedProfessionalId)
      : professionals;

    const list = base.map((p) => ({ id: p.userId, name: p.name }));
    // Só adiciona o bucket "Sem profissional" se não há filtro ativo
    if (!selectedProfessionalId) {
      list.push({ id: UNASSIGNED_RESOURCE_ID, name: "Sem profissional" });
    }
    return list;
  }, [professionals, selectedProfessionalId]);

  const handleRequestDelete = React.useCallback(
    (schedule) => updateState({ confirmModalOpen: true, deletingSchedule: schedule }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Converte schedules em eventos do react-big-calendar.
  // end = start + service.durationMinutes (se houver) ou 30min default.
  // Bug #26 (Round 10): filtra CANCELADO antes de renderizar — proteção em
  // tempo real: quando o bot cancela via socket, UPDATE_SCHEDULES coloca o
  // schedule com status=CANCELADO no estado local; sem este filtro ele ainda
  // apareceria no calendário até o próximo refresh (quando ListService já
  // excluiria via query). Com o filtro, some imediatamente.
  const events = React.useMemo(() => {
    return schedules.filter((schedule) => schedule.status !== "CANCELADO").map((schedule) => {
      const start = new Date(schedule.sendAt);
      const durationMin = schedule.service?.durationMinutes || 30;
      const end = new Date(start.getTime() + durationMin * 60 * 1000);
      return {
        title: (
          <EventLabel
            schedule={schedule}
            onEdit={handleEditSchedule}
            onDelete={handleRequestDelete}
          />
        ),
        start,
        end,
        allDay: false,
        resourceId: schedule.professionalId || UNASSIGNED_RESOURCE_ID,
        resource: { schedule },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, handleRequestDelete]);

  const eventPropGetter = (event) => {
    const profId = event.resource?.schedule?.professionalId;
    return {
      style: {
        backgroundColor: getProfessionalColor(profId),
      },
    };
  };

  // Resources só fazem sentido em day/week. Em month/agenda, passar resources
  // pode distorcer layout, então só passamos quando a view é day ou week.
  const shouldUseResources = currentView === "day" || currentView === "week";

  const handleEventDrop = useCallback(async ({ event, start }) => {
    const schedule = event.resource?.schedule;
    if (!schedule) return;
    try {
      await api.put(`/schedules/${schedule.id}`, { sendAt: start.toISOString() });
      toast.success("Agendamento reagendado");
    } catch (err) {
      toastError(err);
    }
  }, []);

  return (
    <MainContainer>
      <ConfirmationModal
        title={state.deletingSchedule && `${i18n.t("schedules.confirmationModal.deleteTitle")}`}
        open={state.confirmModalOpen}
        onClose={() => updateState({ confirmModalOpen: false })}
        onConfirm={() => handleDeleteSchedule(state.deletingSchedule?.id)}
      >
        {i18n.t("schedules.confirmationModal.deleteMessage")}
      </ConfirmationModal>

      <ScheduleModal
        open={state.scheduleModalOpen}
        onClose={handleCloseScheduleModal}
        reload={fetchSchedules}
        aria-labelledby="form-dialog-title"
        scheduleId={state.selectedSchedule?.id}
        contactId={state.contactId}
      />

      <MainHeader>
        <Title>{i18n.t("schedules.title")} ({schedules.length})</Title>
        <MainHeaderButtonsWrapper>
          <TextField
            className={classes.searchField}
            placeholder={i18n.t("contacts.searchPlaceholder")}
            variant="outlined"
            size="small"
            value={state.searchParam}
            onChange={handleSearch}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color={theme.palette.mode === "dark" ? "disabled" : "action"} />
                </InputAdornment>
              ),
            }}
          />
          <Button
            className={classes.addButton}
            variant="contained"
            color="primary"
            onClick={handleOpenScheduleModal}
          >
            {i18n.t("schedules.buttons.add")}
          </Button>
        </MainHeaderButtonsWrapper>
      </MainHeader>

      <Paper className={classes.mainPaper} variant="outlined" onScroll={handleScroll}>
        <ScheduleFilters
          professionals={professionals}
          services={services}
          selectedProfessionalId={selectedProfessionalId}
          selectedServiceId={selectedServiceId}
          onProfessionalChange={setSelectedProfessionalId}
          onServiceChange={setSelectedServiceId}
        />
        <ScheduleLegend professionals={professionals} />

        {state.loading && schedules.length === 0 ? (
          <Box className={classes.loadingContainer}>
            <CircularProgress />
          </Box>
        ) : (
          <div className={classes.calendarContainer}>
            <DnDCalendar
              messages={defaultMessages}
              formats={{
                agendaDateFormat: "DD/MM ddd",
                weekdayFormat: "dddd",
                timeGutterFormat: "HH:mm",
              }}
              localizer={localizer}
              events={events}
              startAccessor="start"
              endAccessor="end"
              defaultView="month"
              view={currentView}
              onView={setCurrentView}
              views={["month", "week", "day", "agenda"]}
              culture="pt-BR"
              style={{ height: "100%" }}
              eventPropGetter={eventPropGetter}
              resources={shouldUseResources ? resources : undefined}
              resourceIdAccessor="id"
              resourceTitleAccessor="name"
              onEventDrop={handleEventDrop}
              resizable={false}
            />
          </div>
        )}
      </Paper>
    </MainContainer>
  );
};

export default Schedules;
