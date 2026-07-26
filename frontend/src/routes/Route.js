import React, { useContext } from "react";
import { Route as RouterRoute, Redirect } from "react-router-dom";

import { AuthContext } from "../context/Auth/AuthContext";
import BackdropLoading from "../components/BackdropLoading";

/**
 * @param isSuper - quando true, só o super admin (dono da plataforma) acessa;
 *   demais usuários são redirecionados para a home. Usado nos módulos de risco
 *   de banimento (Campanhas / API externa) enquanto operamos via Baileys.
 *   Defesa em profundidade: o bloqueio real é o middleware isSuper no backend.
 */
const Route = ({ component: Component, isPrivate = false, isSuper = false, ...rest }) => {
	const { isAuth, loading, user } = useContext(AuthContext);

	if (!isAuth && isPrivate) {
		return (
			<>
				{loading && <BackdropLoading />}
				<Redirect to={{ pathname: "/login", state: { from: rest.location } }} />
			</>
		);
	}

	// Aguarda o carregamento do usuário antes de decidir — sem isso, um super
	// admin recarregando a página seria expulso da rota durante o fetch inicial.
	if (isSuper && isAuth && !loading && !user?.super) {
		return <Redirect to={{ pathname: "/", state: { from: rest.location } }} />;
	}

	if (isAuth && !isPrivate) {
		return (
			<>
				{loading && <BackdropLoading />}
				<Redirect to={{ pathname: "/", state: { from: rest.location } }} />;
			</>
		);
	}

	return (
		<>
			{loading && <BackdropLoading />}
			<RouterRoute {...rest} component={Component} />
		</>
	);
};

export default Route;
