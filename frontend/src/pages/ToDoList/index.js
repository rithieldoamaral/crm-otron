import React, { useState, useEffect } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import TextField from '@material-ui/core/TextField';
import Button from '@material-ui/core/Button';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemText from '@material-ui/core/ListItemText';
import ListItemSecondaryAction from '@material-ui/core/ListItemSecondaryAction';
import IconButton from '@material-ui/core/IconButton';
import Paper from '@material-ui/core/Paper';
import Typography from '@material-ui/core/Typography';
import DeleteIcon from '@material-ui/icons/Delete';
import EditIcon from '@material-ui/icons/Edit';
import InfoOutlinedIcon from '@material-ui/icons/InfoOutlined';

import MainContainer from '../../components/MainContainer';
import MainHeader from '../../components/MainHeader';
import Title from '../../components/Title';

const useStyles = makeStyles((theme) => ({
  // O aviso fica no topo, antes do campo, porque a dúvida "isso aqui conversa
  // com o agente de IA?" precisa ser respondida ANTES de o usuário escrever.
  aviso: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5, 2),
    marginBottom: theme.spacing(2),
    borderRadius: 6,
    borderLeft: `3px solid ${theme.palette.primary.main}`,
    backgroundColor: theme.mode === 'light' ? '#F4F2EC' : 'rgba(255,255,255,0.06)',
  },
  avisoIcone: {
    fontSize: 18,
    marginTop: 1,
    color: theme.palette.primary.main,
    flexShrink: 0,
  },
  inputContainer: {
    display: 'flex',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(2),
  },
  input: {
    flexGrow: 1,
  },
  listContainer: {
    padding: theme.spacing(1),
  },
  vazio: {
    padding: theme.spacing(5, 2),
    textAlign: 'center',
    color: theme.palette.text.secondary,
  },
}));

/**
 * Anotações internas do operador.
 *
 * ATENÇÃO — PERSISTÊNCIA: as anotações vivem no `localStorage` do navegador,
 * não no banco. Elas são por navegador, não por usuário: somem ao limpar os
 * dados do site e não acompanham quem troca de máquina. Por isso a tela avisa
 * isso explicitamente — prometer persistência que não existe seria pior que a
 * limitação em si. Migrar para o backend está registrado como tech debt em
 * `decisions_log.md` (2026-08-19).
 *
 * Nada aqui é lido pelos agentes de IA: não entra em prompt, contexto nem
 * base de conhecimento. É bloco de rascunho humano.
 */
const ToDoList = () => {
  const classes = useStyles();

  const [task, setTask] = useState('');
  const [tasks, setTasks] = useState([]);
  const [editIndex, setEditIndex] = useState(-1);

  useEffect(() => {
    const savedTasks = localStorage.getItem('tasks');
    if (savedTasks) {
      setTasks(JSON.parse(savedTasks));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('tasks', JSON.stringify(tasks));
  }, [tasks]);

  const handleTaskChange = (event) => {
    setTask(event.target.value);
  };

  const handleAddTask = () => {
    if (!task.trim()) {
      // Impede que o usuário crie uma anotação sem texto
      return;
    }

    const now = new Date();
    if (editIndex >= 0) {
      // Editar anotação existente
      const newTasks = [...tasks];
      newTasks[editIndex] = { text: task, updatedAt: now, createdAt: newTasks[editIndex].createdAt };
      setTasks(newTasks);
      setTask('');
      setEditIndex(-1);
    } else {
      // Adicionar nova anotação
      setTasks([...tasks, { text: task, createdAt: now, updatedAt: now }]);
      setTask('');
    }
  };

  const handleEditTask = (index) => {
    setTask(tasks[index].text);
    setEditIndex(index);
  };

  const handleDeleteTask = (index) => {
    const newTasks = [...tasks];
    newTasks.splice(index, 1);
    setTasks(newTasks);
  };

  // Ao voltar do localStorage a data é string, não Date — chamar
  // toLocaleString() direto devolvia o ISO cru na tela.
  const formatarData = (valor) => {
    const d = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  };

  return (
    <MainContainer>
      <MainHeader>
        <Title>Anotações</Title>
      </MainHeader>

      <Paper className={classes.aviso} elevation={0}>
        <InfoOutlinedIcon className={classes.avisoIcone} />
        <Typography variant="body2" component="div">
          Espaço de uso interno da equipe. <strong>Nada escrito aqui é lido pelos
          agentes de IA</strong> — não influencia respostas, contexto nem base de
          conhecimento.
          <br />
          As anotações ficam salvas neste navegador: não aparecem em outro
          computador e somem se os dados do site forem limpos.
        </Typography>
      </Paper>

      <div className={classes.inputContainer}>
        <TextField
          className={classes.input}
          label="Nova anotação"
          value={task}
          onChange={handleTaskChange}
          variant="outlined"
          size="small"
          onKeyPress={(e) => {
            if (e.key === 'Enter') handleAddTask();
          }}
        />
        <Button variant="contained" color="primary" onClick={handleAddTask}>
          {editIndex >= 0 ? 'Salvar' : 'Adicionar'}
        </Button>
      </div>

      <Paper className={classes.listContainer} variant="outlined">
        {tasks.length === 0 ? (
          <div className={classes.vazio}>
            <Typography variant="body2">
              Nenhuma anotação ainda. Escreva acima para começar.
            </Typography>
          </div>
        ) : (
          <List>
            {tasks.map((item, index) => (
              <ListItem key={index} divider>
                <ListItemText
                  primary={item.text}
                  secondary={formatarData(item.updatedAt)}
                />
                <ListItemSecondaryAction>
                  <IconButton onClick={() => handleEditTask(index)} size="small">
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton onClick={() => handleDeleteTask(index)} size="small">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </MainContainer>
  );
};

export default ToDoList;
