import React, { useState, useEffect } from "react";

import "react-toastify/dist/ReactToastify.css";
import { QueryClient, QueryClientProvider } from "react-query";
import lightBackground from '../src/assets/wa-background-light.png';
import darkBackground from '../src/assets/wa-background-dark.jpg';
import { ptBR } from "@material-ui/core/locale";
import { createTheme, ThemeProvider } from "@material-ui/core/styles";
import { useMediaQuery } from "@material-ui/core";
import ColorModeContext from "./layout/themeContext";
import { SocketContext, SocketManager } from './context/Socket/SocketContext';

import Routes from "./routes";

const queryClient = new QueryClient();

const App = () => {
    const [locale, setLocale] = useState();

    const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
    const preferredTheme = window.localStorage.getItem("preferredTheme");
    const [mode, setMode] = useState(preferredTheme ? preferredTheme : prefersDarkMode ? "dark" : "light");

    const colorMode = React.useMemo(
        () => ({
            toggleColorMode: () => {
                setMode((prevMode) => (prevMode === "light" ? "dark" : "light"));
            },
        }),
        []
    );

    // Paleta institucional Otron — manual da marca v1.0 (agosto/2026).
    //
    // Cores oficiais do manual:
    //   #123739 Verde-petróleo — estrutura, texto
    //   #BDF23C Lima          — ativação, dado
    //   #F4F2EC Papel         — fundo de bloco
    //   #3E4A48 Grafite       — texto corrido
    //
    // `dark` e `light` NÃO estão no manual: são derivados do verde-petróleo
    // mantendo matiz (183°) e saturação (52%) e variando só a luminosidade.
    // Servem ao gradiente e aos estados de hover, que precisam de degrau
    // tonal sem inventar uma cor fora da identidade.
    const OTRON = {
        main: "#123739",  // hsl(183, 52%, 15%) — verde-petróleo do manual
        dark: "#0B2223",  // hsl(183, 52%,  9%) — fim do gradiente
        light: "#1D5A5D", // hsl(183, 52%, 24%) — hover e acentos
        deep: "#0B2223",  // texto de maior peso em fundo claro
        lime: "#BDF23C",  // ativação: item ativo, indicador, badge
        paper: "#F4F2EC", // fundo de bloco
        graphite: "#3E4A48" // texto corrido
    };

    const theme = createTheme(
        {
            scrollbarStyles: {
                "&::-webkit-scrollbar": {
                    width: '8px',
                    height: '8px',
					borderRadius: "8px",
                },
                "&::-webkit-scrollbar-thumb": {
                    boxShadow: 'inset 0 0 6px rgba(0, 0, 0, 0.2)',
                    backgroundColor: OTRON.main,
					borderRadius: "8px",
                },
                "&::-webkit-scrollbar-thumb:hover": {
                    backgroundColor: OTRON.dark,
                },
            },
            scrollbarStylesSoft: {
                "&::-webkit-scrollbar": {
                    width: "8px",
					borderRadius: "8px",
                },
                "&::-webkit-scrollbar-thumb": {
                    backgroundColor: mode === "light" ? "#F3F3F3" : "#333333",
					borderRadius: "8px",
                },
            },
            palette: {
                type: mode,
                primary: { main: mode === "light" ? OTRON.main : "#FFFFFF", dark: OTRON.dark, light: OTRON.light },
                // Cor de ativação do manual da marca. Usada para o que o
                // usuário precisa localizar rápido: item de menu ativo,
                // indicador de aba e badge de superadmin. Fica legível tanto
                // sobre o verde-petróleo quanto sobre fundo claro.
                ativacao: { main: OTRON.lime, contrastText: OTRON.main },
                quicktags: { main: mode === "light" ? OTRON.main : OTRON.main },
				// contrastText explicito: o fundo do botao Sair e escuro nos DOIS
				// modos (verde-petroleo no claro, #333 no escuro), entao o texto e
				// branco sempre. O estilo antes lia `theme.palette.text.sair`, que
				// NUNCA existiu nesta paleta: a cor caia em undefined e o texto
				// herdava o escuro do tema.
				sair: { main: mode === "light" ? OTRON.main : "#333", contrastText: "#FFFFFF", dark: mode === "light" ? OTRON.dark : "#222" },
				vcard: { main: mode === "light" ? OTRON.main : "#666" },
                textPrimary: mode === "light" ? OTRON.main : "#FFFFFF",
                borderPrimary: mode === "light" ? OTRON.main : "#FFFFFF",
                dark: { main: mode === "light" ? "#333333" : "#F3F3F3" },
                light: { main: mode === "light" ? "#F3F3F3" : "#333333" },
                tabHeaderBackground: mode === "light" ? "#EEE" : "#666",
                ticketlist: mode === "light" ? "#fafafa" : "#333",
                optionsBackground: mode === "light" ? "#fafafa" : "#333",
				options: mode === "light" ? "#fafafa" : "#666",
				fontecor: mode === "light" ? OTRON.deep : "#fff",
                fancyBackground: mode === "light" ? "#fafafa" : "#333",
				bordabox: mode === "light" ? "#eee" : "#333",
				newmessagebox: mode === "light" ? "#eee" : "#333",
				inputdigita: mode === "light" ? "#fff" : "#666",
				contactdrawer: mode === "light" ? "#fff" : "#666",
				announcements: mode === "light" ? "#ededed" : "#333",
				login: mode === "light" ? "#fff" : "#1C1C1C",
				announcementspopover: mode === "light" ? "#fff" : "#666",
				chatlist: mode === "light" ? "#eee" : "#666",
				boxlist: mode === "light" ? "#ededed" : "#666",
				boxchatlist: mode === "light" ? "#ededed" : "#333",
                total: mode === "light" ? "#fff" : "#222",
                messageIcons: mode === "light" ? "grey" : "#F3F3F3",
                inputBackground: mode === "light" ? "#FFFFFF" : "#333",
                // Gradiente da barra superior: transição suave do azul-aço principal para o escuro,
                // dando profundidade sem ruído visual.
                barraSuperior: mode === "light" ? `linear-gradient(to right, ${OTRON.main}, ${OTRON.main}, ${OTRON.dark})` : "#666",
				boxticket: mode === "light" ? "#EEE" : "#666",
				campaigntab: mode === "light" ? "#ededed" : "#666",
				mediainput: mode === "light" ? "#ededed" : "#1c1c1c",
				contadordash: mode == "light" ? "#fff" : "#fff",
            },
            mode,
        },
        locale
    );

    useEffect(() => {
        const i18nlocale = localStorage.getItem("i18nextLng");
        const browserLocale =
            i18nlocale.substring(0, 2) + i18nlocale.substring(3, 5);

        if (browserLocale === "ptBR") {
            setLocale(ptBR);
        }
    }, []);

    useEffect(() => {
        window.localStorage.setItem("preferredTheme", mode);
    }, [mode]);



    return (
        <ColorModeContext.Provider value={{ colorMode }}>
            <ThemeProvider theme={theme}>
                <QueryClientProvider client={queryClient}>
                  <SocketContext.Provider value={SocketManager}>
                      <Routes />
                  </SocketContext.Provider>
                </QueryClientProvider>
            </ThemeProvider>
        </ColorModeContext.Provider>
    );
};

export default App;
