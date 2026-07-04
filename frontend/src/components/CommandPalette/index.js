import React, { useState, useEffect, useCallback, useRef } from "react";
import { useHistory } from "react-router-dom";
import Dialog from "@material-ui/core/Dialog";
import DialogContent from "@material-ui/core/DialogContent";
import TextField from "@material-ui/core/TextField";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import ListItemIcon from "@material-ui/core/ListItemIcon";
import ListItemText from "@material-ui/core/ListItemText";
import Typography from "@material-ui/core/Typography";
import InputAdornment from "@material-ui/core/InputAdornment";
import { makeStyles } from "@material-ui/core/styles";
import DashboardIcon from "@material-ui/icons/Dashboard";
import HeadsetMicIcon from "@material-ui/icons/HeadsetMic";
import PeopleAltIcon from "@material-ui/icons/PeopleAlt";
import WifiIcon from "@material-ui/icons/Wifi";
import ScheduleIcon from "@material-ui/icons/Schedule";
import BarChartIcon from "@material-ui/icons/BarChart";
import SettingsIcon from "@material-ui/icons/Settings";
import AccountTreeIcon from "@material-ui/icons/AccountTree";
import GroupIcon from "@material-ui/icons/Group";
import SearchIcon from "@material-ui/icons/Search";
import AttachFileIcon from "@material-ui/icons/AttachFile";
import AnnouncementIcon from "@material-ui/icons/Announcement";
import ViewColumnIcon from "@material-ui/icons/ViewColumn";
import ChatIcon from "@material-ui/icons/Chat";
import AssessmentIcon from "@material-ui/icons/Assessment";
import SecurityIcon from "@material-ui/icons/Security";
import LocalOfferIcon from "@material-ui/icons/LocalOffer";

const NAV_ITEMS = [
  { label: "Dashboard", path: "/", icon: <DashboardIcon />, keywords: "inicio dashboard painel gestao" },
  { label: "Atendimentos", path: "/tickets", icon: <HeadsetMicIcon />, keywords: "tickets atendimento conversas dia a dia" },
  { label: "Contatos", path: "/contacts", icon: <PeopleAltIcon />, keywords: "contatos clientes dia a dia" },
  { label: "WhatsApp", path: "/connections", icon: <WifiIcon />, keywords: "conexoes whatsapp canal configuracoes" },
  { label: "Agendamentos", path: "/schedules", icon: <ScheduleIcon />, keywords: "agendamentos calendario dia a dia" },
  { label: "Kanban", path: "/kanban", icon: <ViewColumnIcon />, keywords: "kanban board dia a dia" },
  { label: "Chat Interno", path: "/chats", icon: <ChatIcon />, keywords: "chat interno mensagens avancado" },
  { label: "Atendentes", path: "/users", icon: <GroupIcon />, keywords: "usuarios atendentes agentes equipe configuracoes" },
  { label: "Filas de atendimento", path: "/queues", icon: <AccountTreeIcon />, keywords: "filas departamentos chatbot configuracoes" },
  { label: "Relatórios", path: "/relatorios", icon: <BarChartIcon />, keywords: "relatorios metricas gestao" },
  { label: "Configurações", path: "/settings", icon: <SettingsIcon />, keywords: "configuracoes settings agente ia" },
  { label: "Etiquetas", path: "/tags", icon: <LocalOfferIcon />, keywords: "tags etiquetas gestao" },
  { label: "Arquivos", path: "/files", icon: <AttachFileIcon />, keywords: "arquivos media avancado" },
  { label: "Anúncios", path: "/announcements", icon: <AnnouncementIcon />, keywords: "anuncios avisos informativos sistema" },
  { label: "Logs de Auditoria", path: "/logs", icon: <SecurityIcon />, keywords: "logs auditoria sistema admin" },
  { label: "Respostas Rápidas", path: "/quick-messages", icon: <AssessmentIcon />, keywords: "respostas rapidas atalhos avancado" },
  { label: "Campanhas", path: "/campaigns", icon: <AnnouncementIcon />, keywords: "campanhas disparo avancado" },
  { label: "Financeiro", path: "/financeiro", icon: <BarChartIcon />, keywords: "financeiro faturas pagamento avancado" },
];

const useStyles = makeStyles((theme) => ({
  dialog: {
    "& .MuiDialog-paper": {
      borderRadius: 12,
      width: 560,
      maxWidth: "95vw",
      maxHeight: "70vh",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    },
  },
  content: {
    padding: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  searchBox: {
    padding: theme.spacing(1.5, 2),
    borderBottom: `1px solid ${theme.palette.divider}`,
    "& .MuiOutlinedInput-notchedOutline": { border: "none" },
    "& .MuiInputBase-input": { fontSize: "1rem" },
  },
  list: {
    overflowY: "auto",
    flex: 1,
    padding: theme.spacing(0.5, 0),
  },
  item: {
    borderRadius: 6,
    margin: theme.spacing(0.25, 1),
    padding: theme.spacing(0.75, 1.5),
    cursor: "pointer",
    "&.Mui-selected": {
      backgroundColor: theme.palette.action.selected,
    },
    "&:hover": {
      backgroundColor: theme.palette.action.hover,
    },
  },
  itemIcon: {
    minWidth: 36,
    color: theme.palette.text.secondary,
    "& svg": { fontSize: 20 },
  },
  hint: {
    padding: theme.spacing(1, 2),
    borderTop: `1px solid ${theme.palette.divider}`,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.palette.background.default,
  },
  kbd: {
    background: theme.palette.action.selected,
    borderRadius: 4,
    padding: "1px 6px",
    fontSize: "0.7rem",
    fontFamily: "monospace",
    color: theme.palette.text.secondary,
  },
}));

const CommandPalette = () => {
  const classes = useStyles();
  const history = useHistory();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  const filtered = NAV_ITEMS.filter((item) => {
    if (!query) return true;
    const q = query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const haystack = (item.label + " " + item.keywords)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
    return haystack.includes(q);
  });

  const handleOpen = useCallback(() => {
    setOpen(true);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const handleNavigate = useCallback((path) => {
    handleClose();
    history.push(path);
  }, [handleClose, history]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        open ? handleClose() : handleOpen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleOpen, handleClose]);

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (filtered[selectedIndex]) handleNavigate(filtered[selectedIndex].path);
    } else if (e.key === "Escape") {
      handleClose();
    }
  };

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      className={classes.dialog}
      disableEnforceFocus
    >
      <DialogContent className={classes.content}>
        <TextField
          inputRef={inputRef}
          autoFocus
          fullWidth
          variant="outlined"
          size="small"
          placeholder="Ir para..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className={classes.searchBox}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" color="action" />
              </InputAdornment>
            ),
          }}
        />

        <List className={classes.list} disablePadding>
          {filtered.length === 0 && (
            <ListItem>
              <ListItemText
                secondary="Nenhuma página encontrada"
                secondaryTypographyProps={{ align: "center" }}
              />
            </ListItem>
          )}
          {filtered.map((item, idx) => (
            <ListItem
              key={item.path + item.label}
              button
              selected={idx === selectedIndex}
              className={classes.item}
              onClick={() => handleNavigate(item.path)}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <ListItemIcon className={classes.itemIcon}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} primaryTypographyProps={{ variant: "body2" }} />
            </ListItem>
          ))}
        </List>

        <div className={classes.hint}>
          <Typography variant="caption" color="textSecondary">
            <kbd className={classes.kbd}>↑↓</kbd> navegar &nbsp;
            <kbd className={classes.kbd}>↵</kbd> ir &nbsp;
            <kbd className={classes.kbd}>Esc</kbd> fechar
          </Typography>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CommandPalette;
