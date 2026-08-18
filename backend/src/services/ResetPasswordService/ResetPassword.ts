import { hash } from "bcryptjs";
import { Op } from "sequelize";
import User from "../../models/User";

const ResetPassword = async (
  email: string,
  token: string,
  password: string
) => {
  const user = await User.findOne({
    where: {
      email,
      resetPassword: {
        [Op.ne]: ""
      }
    }
  });

  if (!user) {
    return { status: 404, message: "Email não encontrado" };
  }

  if (user.resetPassword !== token) {
    return { status: 404, message: "Token não encontrado" };
  }

  // SEGURANÇA: custo elevado de 8 para 12 (padrão recomendado atual).
  const hashedPassword = await hash(password, 12);

  await user.update({
    passwordHash: hashedPassword,
    resetPassword: ""
  });

  return { status: 200, message: "Senha atualizada com sucesso" };
};

export default ResetPassword;
