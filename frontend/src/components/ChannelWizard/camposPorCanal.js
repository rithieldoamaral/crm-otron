/**
 * Definição dos campos de credencial de cada canal.
 *
 * Separado do componente de propósito (CLAUDE.md II.4): é DADO, não interface.
 * Manter aqui deixa a tela genérica e faz um canal novo ser questão de
 * acrescentar uma entrada, sem tocar em JSX.
 *
 * O campo `ondeEncontrar` é o coração da usabilidade desta etapa. Para quem não
 * é técnico, "Phone number ID" não significa nada; o caminho literal dentro do
 * painel do provedor significa. Cada texto aqui foi escrito para ser seguido
 * sem interpretação.
 */

export const CAMPOS_POR_CANAL = {
  cloud_api: [
    {
      nome: "__nome",
      rotulo: "Nome desta conexão",
      exemplo: "WhatsApp Oficial",
      ondeEncontrar:
        "É só um apelido para você identificar esta conexão dentro do CRM, caso tenha mais de um número. Ninguém de fora vê este nome.",
      obrigatorio: true
    },
    {
      nome: "phoneNumberId",
      rotulo: "ID do número",
      exemplo: "109876543210987",
      ondeEncontrar:
        'No painel da Meta (developers.facebook.com), abra seu app → WhatsApp → Configuração da API. O valor aparece logo abaixo do número, com o nome "Phone number ID".',
      obrigatorio: true
    },
    {
      nome: "wabaId",
      rotulo: "ID da conta comercial (WABA)",
      exemplo: "102938475610293",
      ondeEncontrar:
        'Na mesma tela de Configuração da API, um pouco abaixo: "WhatsApp Business Account ID". É ele que permite buscar suas mensagens pré-aprovadas.',
      obrigatorio: true
    },
    {
      nome: "accessToken",
      rotulo: "Token de acesso permanente",
      exemplo: "EAAG...",
      segredo: true,
      ondeEncontrar:
        'Crie em Configurações do Business → Usuários do sistema → seu usuário → "Gerar novo token". Marque as permissões whatsapp_business_messaging e whatsapp_business_management. Guarde: a Meta mostra o token uma única vez.',
      obrigatorio: true
    },
    {
      nome: "appSecret",
      rotulo: "Chave secreta do app (App Secret)",
      exemplo: "a1b2c3...",
      segredo: true,
      ondeEncontrar:
        'No seu app da Meta → Configurações → Básico → campo "Chave secreta do aplicativo", clicando em "Mostrar". Ela é o que nos permite confirmar que as mensagens recebidas vieram mesmo da Meta.',
      obrigatorio: true
    }
  ],

  twilio: [
    {
      nome: "__nome",
      rotulo: "Nome desta conexão",
      exemplo: "WhatsApp Oficial",
      ondeEncontrar:
        "É só um apelido para você identificar esta conexão dentro do CRM, caso tenha mais de um número. Ninguém de fora vê este nome.",
      obrigatorio: true
    },
    {
      nome: "accountSid",
      rotulo: "Account SID",
      exemplo: "AC1234567890abcdef",
      ondeEncontrar:
        'Na página inicial do painel da Twilio (console.twilio.com), no bloco "Account Info". Começa sempre com AC.',
      obrigatorio: true
    },
    {
      nome: "authToken",
      rotulo: "Auth Token",
      exemplo: "••••••••",
      segredo: true,
      ondeEncontrar:
        'No mesmo bloco "Account Info", logo abaixo do Account SID. Clique em "Show" para revelar.',
      obrigatorio: true
    },
    {
      nome: "fromNumber",
      rotulo: "Número do WhatsApp",
      exemplo: "+5548999999999",
      ondeEncontrar:
        "É o número que você habilitou para WhatsApp na Twilio. Digite com o código do país, começando por +55 no Brasil.",
      obrigatorio: true
    }
  ]
};

/** Rótulo amigável de cada canal, para títulos e mensagens. */
export const NOME_DO_CANAL = {
  baileys: "WhatsApp comum (QR Code)",
  cloud_api: "Oficial direto com a Meta",
  twilio: "Oficial via Twilio"
};
