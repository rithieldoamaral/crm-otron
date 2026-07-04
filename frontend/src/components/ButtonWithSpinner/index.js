import React from "react";

import { makeStyles } from "@material-ui/core/styles";
import { CircularProgress, Button } from "@material-ui/core";

const useStyles = makeStyles(theme => ({
	button: {
		position: "relative",
	},

	buttonProgress: {
		// Blue Steel — alinhado à paleta principal do theme (App.js)
		color: "#4682B4",
		position: "absolute",
		top: "50%",
		left: "50%",
		marginTop: -12,
		marginLeft: -12,
	},
}));

const ButtonWithSpinner = ({ loading, children, ...rest }) => {
	const classes = useStyles();

	return (
		<Button className={classes.button} disabled={loading} {...rest}>
			{children}
			{loading && (
				<CircularProgress size={24} className={classes.buttonProgress} />
			)}
		</Button>
	);
};

export default ButtonWithSpinner;
