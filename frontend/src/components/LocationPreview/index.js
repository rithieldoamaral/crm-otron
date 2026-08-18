import React, { useEffect } from 'react';
import toastError from "../../errors/toastError";

import { Button, Divider, Typography} from "@material-ui/core";

const LocationPreview = ({ image, link, description }) => {
    useEffect(() => {}, [image, link, description]);

    const handleLocation = async() => {
        try {
            window.open(link);
        } catch (err) {
            toastError(err);
        }
    }

    return (
		<>
			<div style={{
				minWidth: "250px",
			}}>
				<div>
					<div style={{ float: "left" }}>
						<img src={image} alt="loc" onClick={handleLocation} style={{ width: "100px" }} />
					</div>
					{ description && (
					<div style={{ display: "flex", flexWrap: "wrap" }}>
						<Typography style={{ marginTop: "12px", marginLeft: "15px", marginRight: "15px", float: "left" }} variant="subtitle1" color="primary" gutterBottom>
							{/*
							  SEGURANÇA (2026-07-27 — CLAUDE.md XV.4): aqui havia
							  `dangerouslySetInnerHTML` com `description`, que vem de
							  `message.body.split('|')[2]` — ou seja, do corpo bruto de uma
							  mensagem recebida no WhatsApp. Qualquer pessoa que mandasse
							  mensagem para o número da empresa executava JavaScript na
							  sessão do atendente (XSS armazenado), com acesso ao token no
							  localStorage e a todas as conversas do tenant.

							  O único objetivo do HTML era virar quebra de linha. O
							  `white-space: pre-line` faz isso via CSS, sem interpretar
							  marcação: o texto é renderizado como texto.
							*/}
							<div style={{ whiteSpace: "pre-line" }}>
								{String(description).split("\\n").join("\n")}
							</div>
						</Typography>
					</div>
					)}
					<div style={{ display: "block", content: "", clear: "both" }}></div>
					<div>
						<Divider />
						<Button
							fullWidth
							color="primary"
							onClick={handleLocation}
							disabled={!link}
						>Visualizar</Button>
					</div>
				</div>
			</div>
		</>
	);

};

export default LocationPreview;